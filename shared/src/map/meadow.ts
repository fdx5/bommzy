import { buildMap, MAP_HALF } from './maps';

export { MAP_HALF };
/** Back-compat helper: the classic Pastel Meadow arena. */
export const buildMeadow = (seed = 7) => buildMap('meadow', seed);
