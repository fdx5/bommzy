export type QualityLevel = 'low' | 'medium' | 'high';

export interface Quality {
  level: QualityLevel;
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  post: boolean;      // bloom + grading pass
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
    shadowSize: level === 'high' ? 2048 : 1024,
    post: level === 'high',
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
