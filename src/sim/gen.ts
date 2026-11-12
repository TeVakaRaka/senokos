// Генерация поля дня из зерна: одно зерно — одно и то же поле у всех игроков.

import { buildField, GRASS_COUCH, GRASS_MEADOW, type Field } from './field.ts';
import { hash3, Rng, valueNoise } from './rng.ts';
import type { Tuning } from './tuning.ts';

export interface Rock {
  x: number;
  y: number;
  r: number;
}

export interface Level {
  field: Field;
  stackX: number;
  stackY: number;
  rocks: Rock[];
  heroX: number;
  heroY: number;
}

export const STACK_RADIUS = 1.3; // стог как препятствие, м

export function generateLevel(seed: number, t: Tuning): Level {
  const size = t.fieldSize;
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);

  // Стог — в средней части поля.
  const stackX = size / 2 + rng.range(-4, 4);
  const stackY = size / 2 + rng.range(-4, 4);

  // Герой стартует рядом со стогом, на голой площадке.
  const heroX = stackX + 1.9;
  const heroY = stackY + 1.9;

  // Камни: не у стога, не у края и не вплотную друг к другу.
  const rocks: Rock[] = [];
  for (let attempt = 0; attempt < t.rockCount * 20 && rocks.length < t.rockCount; attempt++) {
    const x = rng.range(2, size - 2);
    const y = rng.range(2, size - 2);
    const r = rng.range(0.45, 0.85);
    const ds = dist2(x, y, stackX, stackY);
    const keepOut = t.stackClearRadius + 2;
    if (ds < keepOut * keepOut) continue;
    let ok = true;
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
      if (dist2(x, y, stackX, stackY) < clear2) continue;

      let blocked = false;
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

  return { field: buildField(size, xs, ys, types, hps), stackX, stackY, rocks, heroX, heroY };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
