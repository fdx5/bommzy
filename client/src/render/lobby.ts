import * as THREE from 'three';
import { CHARACTERS, CHAR_BY_ID, type CharacterId } from '@pastel/shared';
import { ChibiModel } from './chibi';
import { toonMaterial, outlineMaterial, radialTexture } from './toon';
import { VFX, SHAPE } from './vfx';

/** Lobby / title showcase: pastel stage, rotating hero, cloud backdrop. */
export class LobbyScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private hero: ChibiModel | null = null;
  private heroId: CharacterId | null = null;
  private heroSkin = '';
  private crowd: ChibiModel[] = [];
  private platform: THREE.Group;
  private vfx: VFX;
  private time = 0;
  private spin = 0;
  private spinV = 0;
  private dragX: number | null = null;
  private jumpT = 1;
  mode: 'title' | 'lobby' = 'title';

  constructor() {
    const s = this.scene;
    s.background = this.gradientTexture();
    s.add(new THREE.HemisphereLight('#E2F0FF', '#A797D6', 1.2));
    const key = new THREE.DirectionalLight('#FFF1DC', 2.0);
    key.position.set(-3, 6, 5);
    s.add(key);
    const rim = new THREE.DirectionalLight('#FFD6EC', 1.4);
    rim.position.set(4, 3, -5);
    s.add(rim);

    this.platform = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.32, 40), toonMaterial({ color: '#A8E6CF' }));
    top.position.y = -0.16;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 8, 48).rotateX(Math.PI / 2), toonMaterial({ color: '#FFF5BA' }));
    ring.position.y = 0.02;
    const ol = new THREE.Mesh(top.geometry, outlineMaterial('#5E8F7E', 0.04));
    ol.position.copy(top.position);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false }));
    shadow.position.y = 0.012;
    this.platform.add(top, ol, ring, shadow);
    s.add(this.platform);

    // floating décor: soft clouds and pastel cubes
    const cloudGeo = new THREE.IcosahedronGeometry(1, 2);
    const cm = toonMaterial({ color: '#FFFFFF', rim: 0.6 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Mesh(cloudGeo, cm);
      const a = (i / 14) * Math.PI * 2;
      c.position.set(Math.cos(a) * (9 + (i % 3) * 3), -1.5 + (i % 4) * 0.8, Math.sin(a) * 6 - 9);
      c.scale.set(1.6 + (i % 3), 0.9, 1.2);
      c.userData.f = 0.2 + (i % 5) * 0.07;
      s.add(c);
    }
    this.vfx = new VFX(s, 300);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private gradientTexture() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#B5DEFF'); grd.addColorStop(0.55, '#FFE3F0'); grd.addColorStop(1, '#FFF5DA');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    const portrait = h > w;
    this.camera.fov = portrait ? 46 : 32;
    this.camera.position.set(0, 1.55, portrait ? 6.2 : 5.2);
    this.camera.lookAt(0, 0.72, 0);
    this.camera.updateProjectionMatrix();
  }

  setHero(id: CharacterId, palette: string[]) {
    const key = palette.join();
    if (this.heroId === id && this.heroSkin === key) return;
    if (this.hero) { this.platform.remove(this.hero.group); this.hero.dispose(); }
    this.hero = new ChibiModel(id, palette);
    this.hero.group.scale.setScalar(1.35);
    this.platform.add(this.hero.group);
    this.heroId = id; this.heroSkin = key;
    this.hero.triggerSuper();
    this.vfx.starPop(0, 1.2, 0, palette.slice(0, 3));
  }

  setMode(mode: 'title' | 'lobby') {
    this.mode = mode;
    if (mode === 'title' && !this.crowd.length) {
      CHARACTERS.forEach((c, i) => {
        const m = new ChibiModel(c.id, c.colorPalette);
        const a = (i / CHARACTERS.length) * Math.PI * 2;
        m.group.position.set(Math.cos(a) * 2.6, 0, Math.sin(a) * 1.4 - 1.2);
        this.scene.add(m.group);
        this.crowd.push(m);
      });
    }
    for (const m of this.crowd) m.group.visible = mode === 'title';
    this.platform.visible = mode === 'lobby';
  }

  /** Tap the hero → happy hop with hearts. */
  poke() {
    if (!this.hero) return;
    this.jumpT = 0;
    this.hero.triggerJump();
    this.vfx.hearts(0, 0);
    this.vfx.emit(0, 2.1, 0, { count: 6, color: ['#FF9EBB', '#FFC8DD'], speed: [0.5, 1.5], up: [1, 2.5], life: [0.8, 1.2], size: [0.18, 0.28], shape: SHAPE.heart, drag: 1.5 });
  }

  dragStart(x: number) { this.dragX = x; }
  dragMove(x: number) { if (this.dragX === null) return; this.spinV = (x - this.dragX) * 0.012 / 0.016; this.spin += (x - this.dragX) * 0.012; this.dragX = x; }
  dragEnd() { this.dragX = null; }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const o of this.scene.children) if (o.userData.f) o.position.y += Math.sin(t * o.userData.f * 3) * 0.002;
    if (this.mode === 'title') {
      this.crowd.forEach((m, i) => {
        const a = (i / this.crowd.length) * Math.PI * 2 + t * 0.25;
        m.group.position.set(Math.cos(a) * 2.6, 0, Math.sin(a) * 1.3 - 1.0);
        m.victory = Math.sin(t * 0.7 + i) > 0.6;
        m.update({ dt, time: t + i, speed: m.victory ? 0 : 0.55, facing: -a + Math.PI });
      });
    }
    if (this.hero && this.mode === 'lobby') {
      if (this.dragX === null) { this.spinV *= Math.exp(-dt * 3); this.spin += this.spinV * dt; this.spin += (Math.sin(t * 0.5) * 0.35 - this.spin) * dt * 0.8; }
      this.jumpT = Math.min(1, this.jumpT + dt * 2.2);
      this.hero.group.position.y = Math.sin(this.jumpT * Math.PI) * 0.5;
      this.hero.victory = this.jumpT < 1;
      this.hero.update({ dt, time: t, speed: 0, facing: this.spin });
      this.platform.rotation.y = 0;
    }
    if (Math.random() < dt * 3) this.vfx.sparkle((Math.random() - 0.5) * 6, Math.random() * 3, -1 - Math.random() * 2, '#FFFFFF', 1, 0.2);
    this.vfx.update(dt);
  }
}

/** Renders a transparent portrait per character (default skin) with a temporary offscreen renderer. */
export function renderPortraits(size = 256): Record<CharacterId, string> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#E2F0FF', '#A797D6', 1.25));
  const key = new THREE.DirectionalLight('#FFF1DC', 2.3);
  key.position.set(-2, 4, 5);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0.9, 1.25, 3.1);
  cam.lookAt(0, 0.68, 0);
  const out = {} as Record<CharacterId, string>;
  for (const c of CHARACTERS) {
    const m = new ChibiModel(c.id, CHAR_BY_ID[c.id].colorPalette);
    for (let k = 0; k < 40; k++) m.update({ dt: 0.016, time: 1.2, speed: 0, facing: 0.35 });
    scene.add(m.group);
    r.render(scene, cam);
    out[c.id] = canvas.toDataURL('image/png');
    scene.remove(m.group);
    m.dispose();
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}
