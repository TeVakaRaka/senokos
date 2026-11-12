// 64 направления движения. Ввод игрока за шаг — один байт:
// 0 — палец не касается экрана, 1..64 — номер направления + 1.

import { cosDeg, sinDeg } from './dmath.ts';

export const DIR_COUNT = 64;
export const DIR_STEP_DEG = 360 / DIR_COUNT; // 5,625° — точное двоичное число

export const DIR_X = new Float64Array(DIR_COUNT);
export const DIR_Y = new Float64Array(DIR_COUNT);

for (let i = 0; i < DIR_COUNT; i++) {
  DIR_X[i] = cosDeg(i * DIR_STEP_DEG);
  DIR_Y[i] = sinDeg(i * DIR_STEP_DEG);
}

/**
 * Ближайшее из 64 направлений к вектору (x, y).
 * Нужна только боту внутри симуляции; интерфейс считает направление сам,
 * ему можно пользоваться Math.atan2.
 */
export function dirFromVector(x: number, y: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < DIR_COUNT; i++) {
    const d = x * DIR_X[i]! + y * DIR_Y[i]!;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}
