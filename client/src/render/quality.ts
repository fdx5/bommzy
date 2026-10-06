export type QualityLevel = 'low' | 'medium' | 'high';

export interface Quality {
  level: QualityLevel;
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  post: boolean;      // post-processing composer (grading pass)
  bloom: boolean;     // bloom inside the composer (high only)
  sharpen: number;    // grade-pass unsharp amount, 0 = off
  anisotropy: number; // ground texture filtering
  msaa: boolean;
  particles: number;  // particle pool size
}

const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

export function makeQuality(level: QualityLevel): Quality {
  const mobile = isMobile();
  const dpr = window.devicePixelRatio || 1;
  const cap = level === 'low' ? 1 : level === 'medium' ? (mobile ? 1.5 : 1.75) : mobile ? 1.75 : 2;
  return {
    level,
    pixelRatio: Math.min(dpr, cap),
    shadows: level !== 'low',
    // desktop medium GPUs handle the bigger map easily; it removes most shadow stair-stepping
    shadowSize: level === 'high' || (level === 'medium' && !mobile) ? 2048 : 1024,
    // grading is a single cheap full-screen pass, so desktop medium gets it too (bloom stays high-only)
    post: level === 'high' || (level === 'medium' && !mobile),
    bloom: level === 'high',
    sharpen: level === 'high' ? 0.35 : level === 'medium' ? 0.2 : 0,
    anisotropy: level === 'low' ? 1 : level === 'medium' ? 8 : 16,
    msaa: level !== 'low',
    particles: level === 'low' ? 600 : level === 'medium' ? 1200 : 2000,
  };
}

/** Initial guess before the in-game FPS probe refines it. */
export function guessQuality(): QualityLevel {
  const mobile = isMobile();
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (mobile) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export { isMobile };
