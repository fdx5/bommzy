import * as THREE from 'three';
import { ITEMS } from '@pastel/shared';
import { itemPreviewGeometry } from './chibi';
import { toonMaterial, outlineMaterial } from './toon';

/**
 * Shop thumbnails: every cosmetic is rendered once, on its own, with the game's toon look,
 * on a small offscreen renderer → PNG data URLs kept in memory.
 */
const cache = new Map<string, string>();
let warmed = false;

export function itemThumb(id: string) { return cache.get(id) ?? null; }

export function warmItemThumbs(size = 160) {
  if (warmed) return;
  warmed = true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    r.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#F2F6FF', '#A797D6', 1.5));
    const key = new THREE.DirectionalLight('#FFF4E2', 2.2);
    key.position.set(-1.5, 2.5, 3);
    scene.add(key);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    const mat = toonMaterial({ vertexColors: true, rim: 0.45, spec: 0.5, shadowTint: '#C9BCEB' });
    const box = new THREE.Box3(), sphere = new THREE.Sphere();
    for (const it of ITEMS) {
      const geo = itemPreviewGeometry(it.id);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      const ol = new THREE.Mesh(geo, outlineMaterial('#4A3B5C', 0.012, { lineArt: true }));
      scene.add(mesh, ol);
      box.setFromObject(mesh);
      box.getBoundingSphere(sphere);
      // eyewear faces the camera; everything else in a friendly 3/4 view
      const dir = it.slot === 'eyewear' ? new THREE.Vector3(0.18, 0.12, 1) : it.slot === 'shoes' ? new THREE.Vector3(0.9, 0.7, 1) : new THREE.Vector3(0.55, 0.45, 1);
      const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.05;
      cam.position.copy(sphere.center).addScaledVector(dir.normalize(), dist);
      cam.lookAt(sphere.center);
      r.render(scene, cam);
      cache.set(it.id, canvas.toDataURL('image/png'));
      scene.remove(mesh, ol);
      (ol.material as THREE.Material).dispose();
      geo.dispose();
    }
    mat.dispose();
    r.dispose();
    r.forceContextLoss();
  } catch {
    // thumbnails are cosmetic; the emoji fallback stays
  }
}
