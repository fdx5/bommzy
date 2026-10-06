import * as THREE from 'three';

/** Global shader clock & wind shared by every material. */
export const globalUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.3) },
  uWindBoost: { value: 0 },
  /** xy = world x/z of up to 8 characters, z = strength. Grass bends away from them. */
  uPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
};

let gradient: THREE.DataTexture | null = null;
/**
 * 3-step toon ramp (105 / 190 / 255). Dark band stays bright: the purple tint comes from the hemisphere light.
 * 64 texels sampled linearly with narrow smoothstep transitions: band edges stay crisp but anti-aliased
 * instead of stair-stepping across curved surfaces.
 */
export function toonGradient() {
  if (gradient) return gradient;
  const N = 64, soft = 0.022;
  const ss = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N;
    const v = Math.round(105 + 85 * ss(0.25 - soft, 0.25 + soft, x) + 65 * ss(0.5 - soft, 0.5 + soft, x));
    data.set([v, v, v, 255], i * 4);
  }
  gradient = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.LinearFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const WIND_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 wIp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 wIp = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
#endif
  float wH = max(position.y - uWindBase, 0.0);
  float wAmt = uWind * (1.0 + uWindBoost * 2.5) * wH * wH;
  float wPh = uTime * 1.6 + wIp.x * 0.37 + wIp.z * 0.23;
  transformed.x += (sin(wPh) * 0.6 + uWindDir.x * uWindBoost) * wAmt;
  transformed.z += (cos(wPh * 0.8) * 0.4 + uWindDir.y * uWindBoost) * wAmt;
  #ifdef USE_PUSH
  vec3 wWorld = wIp + transformed;
  for (int i = 0; i < 8; i++) {
    vec2 dd = wWorld.xz - uPushers[i].xy;
    float dl = length(dd);
    float pk = (1.0 - smoothstep(0.15, 0.95, dl)) * uPushers[i].z;
    transformed.xz += (dd / max(dl, 0.001)) * pk * wH * 0.9;
    transformed.y -= pk * wH * 0.35;
  }
  #endif
  #ifdef USE_SQUASH
  // bush rustle when entered/left
  float wR = aRustle * sin(uTime * 28.0 + wIp.x) * 0.12 * wH;
  transformed.xz += normalize(position.xz + 0.001) * (wR + aRustle * 0.08);
  #endif
`;

const DITHER = /* glsl */ `
float pbBayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return (m[idx] + 0.5) / 16.0;
}
`;

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  rim?: number;
  rimColor?: THREE.ColorRepresentation;
  wind?: number;        // sway strength, 0 = off
  windBase?: number;    // local height where sway starts
  fade?: boolean;       // per-instance aFade dither transparency
  rustle?: boolean;     // per-instance aRustle (bushes)
  push?: boolean;       // bend away from characters (grass)
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  spec?: number;                          // toon specular "glossy dot"
  specMask?: boolean;                     // per-vertex aSpec attribute limits where the dot can appear
  shadowTint?: THREE.ColorRepresentation; // dark bands shift toward this hue instead of grey
}

export type ToonMaterial = THREE.MeshToonMaterial & { uniforms: { uFlash: { value: number }; uRim: { value: number }; uOpacityDither: { value: number } } };

export function toonMaterial(o: ToonOptions = {}): ToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: !!o.vertexColors,
    gradientMap: toonGradient(),
    map: o.map ?? null,
    emissive: o.emissive ?? 0x000000,
  }) as ToonMaterial;
  const uniforms = {
    uFlash: { value: 0 },
    uRim: { value: o.rim ?? 0.35 },
    uRimColor: { value: new THREE.Color(o.rimColor ?? 0xfff6ea) },
    uWind: { value: o.wind ?? 0 },
    uWindBase: { value: o.windBase ?? 0 },
    uOpacityDither: { value: 1 },
    uSpec: { value: o.spec ?? 0 },
    uShadowTint: { value: new THREE.Color(o.shadowTint ?? '#ffffff') },
  };
  mat.uniforms = uniforms as ToonMaterial['uniforms'];
  const defines: Record<string, string> = {};
  if (o.spec !== undefined || o.shadowTint !== undefined) defines.USE_TOONFX = '';
  if (o.specMask) defines.USE_SPECMASK = '';
  if (o.wind) defines.USE_WIND = '';
  if (o.fade) defines.USE_FADE = '';
  if (o.rustle) defines.USE_SQUASH = '';
  if (o.push) defines.USE_PUSH = '';
  mat.defines = defines;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, globalUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform float uWindBase; uniform vec2 uWindDir; uniform float uWindBoost;
        #ifdef USE_PUSH
        uniform vec3 uPushers[8];
        #endif
        #ifdef USE_FADE
        attribute float aFade; varying float vFade;
        #endif
        #ifdef USE_SQUASH
        attribute float aRustle;
        #endif
        #ifdef USE_SPECMASK
        attribute float aSpec; varying float vSpec;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_WIND
        ${WIND_VERTEX}
        #endif
        #ifdef USE_FADE
        vFade = aFade;
        #endif
        #ifdef USE_SPECMASK
        vSpec = aSpec;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlash; uniform float uRim; uniform vec3 uRimColor; uniform float uOpacityDither; uniform float uSpec; uniform vec3 uShadowTint;
        #ifdef USE_FADE
        varying float vFade;
        #endif
        #ifdef USE_SPECMASK
        varying float vSpec;
        #endif
        ${DITHER}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float pbFade = uOpacityDither;
        #ifdef USE_FADE
        pbFade *= vFade;
        #endif
        if (pbFade < 0.999 && pbBayer(gl_FragCoord.xy) > pbFade) discard;`)
      .replace('#include <opaque_fragment>', `
        vec3 pbV = normalize(vViewPosition);
        float pbNdV = saturate(dot(normal, pbV));
        #ifdef USE_TOONFX
          // lavender shadows: darker bands are tinted rather than greyed out
          float pbLum = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(0.001, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
          outgoingLight = mix(outgoingLight * uShadowTint, outgoingLight, smoothstep(0.5, 0.95, pbLum));
          float pbLit = 1.0;
          #if NUM_DIR_LIGHTS > 0
            vec3 pbL = directionalLights[0].direction;
            pbLit = smoothstep(-0.2, 0.4, dot(normal, pbL));
            float pbSpec = pow(saturate(dot(normal, normalize(pbL + pbV))), 80.0);
            float pbSpecK = uSpec;
            #ifdef USE_SPECMASK
            pbSpecK *= vSpec;
            #endif
            outgoingLight += vec3(1.0, 0.99, 0.96) * smoothstep(0.4, 0.48, pbSpec) * pbSpecK;
          #endif
          // crisp toon rim, strongest on the lit side
          float pbRim = smoothstep(0.6, 0.72, 1.0 - pbNdV) * (0.35 + 0.65 * pbLit);
        #else
          float pbRim = pow(1.0 - pbNdV, 3.0);
        #endif
        outgoingLight += uRimColor * pbRim * uRim;
        outgoingLight = mix(outgoingLight, vec3(1.0, 0.98, 0.96), uFlash);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `toon-${Object.keys(defines).join('-')}`;
  return mat;
}

/** Inverted-hull outline. Works with SkinnedMesh and InstancedMesh, mirrors wind sway & fade. */
export function outlineMaterial(color: THREE.ColorRepresentation, thickness = 0.022, o: { wind?: number; windBase?: number; fade?: boolean; lineArt?: boolean } = {}) {
  const defines: Record<string, string> = {};
  if (o.wind) defines.USE_WIND = '';
  if (o.fade) defines.USE_FADE = '';
  if (o.lineArt) defines.USE_LINEART = '';
  const mat = new THREE.ShaderMaterial({
    defines,
    vertexColors: !!o.lineArt,
    side: THREE.BackSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uColor: { value: new THREE.Color(color) }, uThickness: { value: thickness }, uWind: { value: o.wind ?? 0 }, uWindBase: { value: o.windBase ?? 0 }, uOpacityDither: { value: 1 } },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      #include <fog_pars_vertex>
      uniform float uThickness; uniform float uTime; uniform float uWind; uniform float uWindBase; uniform vec2 uWindDir; uniform float uWindBoost;
      #ifdef USE_FADE
      attribute float aFade; varying float vFade;
      #endif
      #ifdef USE_LINEART
      attribute float aOutline; attribute vec3 oNormal; varying vec3 vLineColor;
      #endif
      void main() {
        #include <beginnormal_vertex>
        #ifdef USE_LINEART
        objectNormal = oNormal;
        #endif
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #ifdef USE_WIND
        ${WIND_VERTEX.replace(/#ifdef USE_PUSH[\s\S]*?#endif/, '').replace(/#ifdef USE_SQUASH[\s\S]*?#endif/, '')}
        #endif
        #include <skinning_vertex>
        float olW = uThickness;
        #ifdef USE_LINEART
        olW *= aOutline;
        vLineColor = color;
        #endif
        transformed += normalize(objectNormal) * olW;
        #ifdef USE_FADE
        vFade = aFade;
        #endif
        #include <project_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uOpacityDither;
      #ifdef USE_FADE
      varying float vFade;
      #endif
      #ifdef USE_LINEART
      varying vec3 vLineColor;
      #endif
      ${DITHER}
      void main() {
        float f = uOpacityDither;
        #ifdef USE_FADE
        f *= vFade;
        #endif
        if (f < 0.999 && pbBayer(gl_FragCoord.xy) > f) discard;
        vec3 lc = uColor;
        #ifdef USE_LINEART
        // coloured line art: the part's own hue, deepened and pulled toward the base ink
        lc = mix(vLineColor * vec3(0.42, 0.38, 0.5), uColor, 0.35);
        #endif
        gl_FragColor = vec4(lc, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  // uTime etc. are shared objects so every outline animates in sync with its mesh
  Object.assign(mat.uniforms, globalUniforms);
  return mat;
}

/** Soft radial gradient used for blob shadows and glows. */
export function radialTexture(inner = 'rgba(80,60,120,0.55)', outer = 'rgba(80,60,120,0)', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.55, inner.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.6})`));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
