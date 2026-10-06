import type { CharacterId } from '@pastel/shared';

/**
 * Per-brawler face recipe: head proportions + eye style. Shared by the chibi builder and the
 * outfit fitter so glasses and hats sit on each character's own head shape.
 */
export type EyeStyle = 'bean' | 'button' | 'tough' | 'dot' | 'almond' | 'sparkle' | 'happy';

export interface Face {
  headR: number;
  /** head ellipsoid scale (x = width, y = height, z = depth) */
  headS: [number, number, number];
  eye: EyeStyle;
  eyeX: number;      // half the distance between the eyes
  eyeY: number;
  eyeScale: number;
  /** extra forward offset for eyes that must clear a face patch (Popo's white mask) */
  faceZ: number;
  mouth: 'smile' | 'o';
}

export const HEAD_Y = 0.86;

export const FACES: Record<CharacterId, Face> = {
  // bear: wide round head, round button eyes
  toto: { headR: 0.36, headS: [1.09, 0.95, 1], eye: 'button', eyeX: 0.135, eyeY: 0.875, eyeScale: 1, faceZ: 0, mouth: 'smile' },
  // bulldog: broad, squat head, small set-apart eyes under stubby determined brows
  boogie: { headR: 0.36, headS: [1.1, 0.9, 1], eye: 'tough', eyeX: 0.148, eyeY: 0.885, eyeScale: 0.95, faceZ: 0, mouth: 'smile' },
  // penguin: egg-shaped head, close-set shiny dot eyes
  popo: { headR: 0.36, headS: [1.0, 1.02, 1], eye: 'dot', eyeX: 0.112, eyeY: 0.885, eyeScale: 1, faceZ: 0.012, mouth: 'smile' },
  // fox: slimmer head, tilted almond eyes with a flick of lashes
  luna: { headR: 0.36, headS: [1.0, 0.97, 1], eye: 'almond', eyeX: 0.135, eyeY: 0.885, eyeScale: 1, faceZ: 0, mouth: 'smile' },
  // monkey: big sparkly anime eyes on a round, slightly wide head
  kiki: { headR: 0.36, headS: [1.08, 0.94, 1], eye: 'sparkle', eyeX: 0.135, eyeY: 0.875, eyeScale: 1.1, faceZ: 0, mouth: 'smile' },
  // octopus: big bulb head, happy ^^ eyes and a little "o" mouth
  mongle: { headR: 0.42, headS: [1.02, 1.02, 1], eye: 'happy', eyeX: 0.15, eyeY: 0.885, eyeScale: 1.15, faceZ: 0, mouth: 'o' },
};

/** z of the head's front surface at (x, y). */
export function headSurfaceZ(f: Face, x: number, y: number) {
  const [sx, sy, sz] = f.headS;
  const k = 1 - (x / (f.headR * sx)) ** 2 - ((y - HEAD_Y) / (f.headR * sy)) ** 2;
  return Math.sqrt(Math.max(0.02, k)) * f.headR * sz;
}

/** Eye centre used to fit eyewear (matches where the eye shapes are built). */
export function eyeAnchor(f: Face) {
  return { x: f.eyeX, y: f.eyeY, z: headSurfaceZ(f, f.eyeX, f.eyeY) + f.faceZ - 0.02, s: f.eyeScale };
}
