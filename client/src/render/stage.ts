import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeQuality, type Quality, type QualityLevel } from './quality';
import { globalUniforms } from './toon';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.0 }, uVignette: { value: 0.22 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color('#FFE6F3') } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uSat; uniform float uVignette; uniform float uFlash; uniform vec3 uFlashColor; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      // pastel lift: raise shadows toward lavender instead of black
      c.rgb = mix(c.rgb, c.rgb * 0.95 + vec3(0.02, 0.014, 0.035), 0.5);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      float edge = smoothstep(0.25, 0.75, length(d) * 1.4);
      c.rgb = mix(c.rgb, uFlashColor * 1.2, uFlash * edge);
      gl_FragColor = c;
    }`,
};

/** Owns the WebGL renderer, the camera rig and post-processing. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
  scene: THREE.Scene = new THREE.Scene();
  viewCamera: THREE.PerspectiveCamera = this.camera;
  quality: Quality;
  private composer?: EffectComposer;
  private renderPass?: RenderPass;
  private bloom?: UnrealBloomPass;
  private grade?: ShaderPass;
  // camera rig
  private focus = new THREE.Vector3();
  private shakeAmp = 0;
  private kickOff = new THREE.Vector3();
  private zoomPunch = 0;
  private flash = 0;
  private satBoost = 0;
  readonly pitch = THREE.MathUtils.degToRad(55);
  private baseDist = 25;
  contextLost = false;

  constructor(readonly canvas: HTMLCanvasElement, level: QualityLevel) {
    this.quality = makeQuality(level);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.msaa && !this.quality.post, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
    this.setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(level: QualityLevel) {
    if (level === this.quality.level) return;
    this.quality = makeQuality(level);
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.setupPost();
    this.resize();
  }

  private setupPost() {
    this.composer?.dispose();
    this.composer = undefined;
    if (!this.quality.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.viewCamera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.45, 0.93);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** Switch what is rendered (game scene + rig camera, or the lobby showcase). */
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera = this.camera) {
    this.scene = scene;
    this.viewCamera = camera;
    if (this.renderPass) { this.renderPass.scene = scene; this.renderPass.camera = camera; }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    if (this.viewCamera !== this.camera) { this.viewCamera.aspect = w / h; this.viewCamera.updateProjectionMatrix(); }
    // keep ~22m horizontally visible on narrow screens, ~17m vertically on wide ones
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const byV = 17 / (2 * Math.tan(vFov / 2));
    const byH = 22 / (2 * Math.tan(hFov / 2));
    this.baseDist = Math.max(byV, byH, 22);
    this.camera.updateProjectionMatrix();
  }

  /** Directional camera recoil: pushes the view opposite to `dx,dz` (shot direction). */
  kick(dx: number, dz: number, amount: number) { this.kickOff.x -= dx * amount; this.kickOff.z -= dz * amount; this.kickOff.clampLength(0, 0.6); }
  shake(amount: number) { this.shakeAmp = Math.min(0.6, this.shakeAmp + amount); }
  punch(amount: number) { this.zoomPunch = Math.min(0.2, this.zoomPunch + amount); }
  screenFlash(amount: number, color = '#FFE6F3') { this.flash = Math.min(1, this.flash + amount); if (this.grade) (this.grade.uniforms.uFlashColor.value as THREE.Color).set(color); }
  saturate(amount: number) { this.satBoost = Math.min(0.6, this.satBoost + amount); }

  /** Smooth follow with a 2m look-ahead. `snap` jumps instantly (spawn / spectate switch). */
  follow(target: THREE.Vector3, lead: THREE.Vector2, dt: number, snap = false) {
    const goal = new THREE.Vector3(target.x + lead.x, 0, target.z + lead.y);
    if (snap) this.focus.copy(goal); else this.focus.lerp(goal, 1 - Math.exp(-dt * 7));
    const dist = this.baseDist * (1 - this.zoomPunch);
    const off = new THREE.Vector3(0, Math.sin(this.pitch) * dist, Math.cos(this.pitch) * dist);
    this.camera.position.copy(this.focus).add(off);
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp;
    }
    this.camera.position.add(this.kickOff);
    this.camera.lookAt(this.focus.x + this.kickOff.x, 0, this.focus.z - 0.6 + this.kickOff.z);
    this.kickOff.multiplyScalar(Math.exp(-dt * 14));
    this.shakeAmp *= Math.exp(-dt * 12);
    this.zoomPunch *= Math.exp(-dt * 6);
  }

  get focusPoint() { return this.focus; }

  render(dt: number) {
    if (this.contextLost) return;
    globalUniforms.uTime.value += dt;
    this.flash *= Math.exp(-dt * 7);
    this.satBoost *= Math.exp(-dt * 5);
    if (this.composer && this.grade) {
      this.grade.uniforms.uFlash.value = this.flash;
      this.grade.uniforms.uSat.value = 1.08 + this.satBoost;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.viewCamera);
    }
  }

  /** Compile every material up-front so the first shot doesn't hitch. */
  warmup(scene: THREE.Scene) {
    this.renderer.compile(scene, this.viewCamera);
  }
}
