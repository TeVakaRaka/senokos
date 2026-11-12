// Случайность симуляции: генератор mulberry32 от зерна и целочисленный хеш для шума.
// Math.random в симуляции запрещён — он разный при каждом запуске.

export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Целое 0 … 2³²−1. */
  u32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Число в [0, 1). */
  float(): number {
    return this.u32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** Целое 0 … n−1. */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
}

/** Хеш трёх целых в 0 … 2³²−1. */
export function hash3(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Гладкий шум в [0, 1): значения в узлах целой решётки, между ними — сглаженная интерполяция. */
export function valueNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash3(seed, ix, iy) / 4294967296;
  const b = hash3(seed, ix + 1, iy) / 4294967296;
  const c = hash3(seed, ix, iy + 1) / 4294967296;
  const d = hash3(seed, ix + 1, iy + 1) / 4294967296;
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}
