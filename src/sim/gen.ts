// Генерация поля дня из зерна: одно зерно — одно и то же поле у всех игроков.

import { cosDeg, sinDeg } from './dmath.ts';
import { buildField, GRASS_COUCH, GRASS_MEADOW, type Field } from './field.ts';
import { hash3, Rng, valueNoise } from './rng.ts';
import type { Tuning } from './tuning.ts';

export interface Rock {
  x: number;
  y: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Level {
  field: Field;
  stacks: Point[]; // стог каждого игрока
  starts: Point[]; // где игрок появляется
  rocks: Rock[];
}

export const STACK_RADIUS = 1.3; // стог как препятствие, м

/**
 * Сторона поля для заданного числа игроков. Один или двое — как задано набором чисел;
 * дальше площадь растёт вместе с числом игроков (на каждого — столько же, сколько в игре вдвоём).
 */
export function fieldSizeFor(base: number, playerCount: number): number {
  if (playerCount <= 2) return base;
  return Math.round((base * Math.sqrt(playerCount / 2)) / 2) * 2;
}

export function generateLevel(seed: number, t: Tuning, playerCount = 1): Level {
  const size = t.fieldSize;
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);

  // Стоги. Один игрок — стог в средней части поля. Несколько — по кругу вокруг центра,
  // друг напротив друга.
  const stacks: Point[] = [];
  if (playerCount <= 1) {
    const x = size / 2 + rng.range(-4, 4);
    const y = size / 2 + rng.range(-4, 4);
    stacks.push({ x, y });
  } else {
    const ring = size * 0.25;
    for (let i = 0; i < playerCount; i++) {
      const angle = 180 + (360 * i) / playerCount;
      stacks.push({
        x: size / 2 + cosDeg(angle) * ring + rng.range(-1, 1),
        y: size / 2 + sinDeg(angle) * ring + rng.range(-2.5, 2.5),
      });
    }
  }

  // Игрок стартует рядом со своим стогом, на голой площадке.
  const starts: Point[] = stacks.map((s) => ({ x: s.x + 1.9, y: s.y + 1.9 }));

  // Камни: не у стогов, не у края и не вплотную друг к другу.
  const rocks: Rock[] = [];
  const keepOut = t.stackClearRadius + 2;
  for (let attempt = 0; attempt < t.rockCount * 20 && rocks.length < t.rockCount; attempt++) {
    const x = rng.range(2, size - 2);
    const y = rng.range(2, size - 2);
    const r = rng.range(0.45, 0.85);
    let ok = true;
    for (const s of stacks) {
      if (dist2(x, y, s.x, s.y) < keepOut * keepOut) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const other of rocks) {
      if (dist2(x, y, other.x, other.y) < 9) {
        ok = false;
        break;
      }
    }
    if (ok) rocks.push({ x, y, r });
  }

  // Кустики: сетка со случайным сдвигом, прореженная шумом (пятна голой земли).
  const xs: number[] = [];
  const ys: number[] = [];
  const types: number[] = [];
  const hps: number[] = [];
  const n = Math.floor(size / t.tuftSpacing);
  const threshold = 0.5 - (t.coverage - 0.5) * 0.6;
  const seedCover = (seed + 101) >>> 0;
  const seedDetail = (seed + 202) >>> 0;
  const seedType = (seed + 303) >>> 0;
  const seedJitter = (seed + 404) >>> 0;
  const clear2 = t.stackClearRadius * t.stackClearRadius;

  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const jx = (hash3(seedJitter, gx, gy) / 4294967296 - 0.5) * 2 * t.tuftJitter;
      const jy = (hash3(seedJitter, gx + 7919, gy + 104729) / 4294967296 - 0.5) * 2 * t.tuftJitter;
      const x = (gx + 0.5) * t.tuftSpacing + jx;
      const y = (gy + 0.5) * t.tuftSpacing + jy;
      if (x < 0.3 || y < 0.3 || x > size - 0.3 || y > size - 0.3) continue;

      const cover = 0.65 * valueNoise(seedCover, x / 7, y / 7) + 0.35 * valueNoise(seedDetail, x / 2.6, y / 2.6);
      if (cover < threshold) continue;

      let blocked = false;
      for (const s of stacks) {
        if (dist2(x, y, s.x, s.y) < clear2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (const rock of rocks) {
        const keep = rock.r + 0.25;
        if (dist2(x, y, rock.x, rock.y) < keep * keep) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      let type = GRASS_MEADOW;
      if (t.grassTypes >= 2 && valueNoise(seedType, x / 5, y / 5) > 0.62) type = GRASS_COUCH;

      xs.push(x);
      ys.push(y);
      types.push(type);
      hps.push(t.grassHp[type]!);
    }
  }

  return { field: buildField(size, xs, ys, types, hps), stacks, starts, rocks };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
