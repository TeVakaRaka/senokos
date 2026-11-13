// Генерация поля дня из зерна: одно зерно — одно и то же поле у всех игроков.
//
// В игре на нескольких поле бывает трёх видов (локации):
//   луг      — открытое поле с камнями;
//   огороды  — заборы и загоны с проходами: есть за чем прятаться и где срезать путь;
//   река     — поперёк поля течёт река, перейти можно только по мостам; ларёк стоит
//              на широком мосту посередине.

import { cosDeg, sinDeg } from './dmath.ts';
import { buildField, GRASS_COUCH, GRASS_MEADOW, type Field } from './field.ts';
import { buildNav, reachable, segDist2, type Disc, type Wall } from './nav.ts';
import { hash3, Rng, valueNoise } from './rng.ts';
import type { Tuning } from './tuning.ts';

export type { Wall } from './nav.ts';

export interface Rock {
  x: number;
  y: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Мост через реку: середина, направление поперёк реки, ширина прохода и длина настила. */
export interface Bridge {
  x: number;
  y: number;
  ux: number; // куда ведёт мост (единичный вектор поперёк реки)
  uy: number;
  width: number; // ширина прохода вдоль реки, м
  length: number; // длина настила поперёк реки, м
}

/** Река для картинки: осевая линия и полуширина. */
export interface River {
  points: Point[];
  half: number;
  bridges: Bridge[];
}

export const MAP_MEADOW = 0;
export const MAP_FENCES = 1;
export const MAP_RIVER = 2;
export const MAP_COUNT = 3;

export interface Level {
  field: Field;
  map: number; // вид поля: MAP_*
  stacks: Point[]; // стог каждого игрока
  starts: Point[]; // где игрок появляется
  rocks: Rock[];
  shop: Point | null; // магазин в центре поля (в игре на одного его нет)
  kennels: Point[]; // будка у стога каждого игрока (в игре на одного их нет)
  walls: Wall[]; // заборы и вода: непроходимые отрезки с толщиной
  river: River | null;
}

export const STACK_RADIUS = 1.3; // стог как препятствие, м
export const SHOP_RADIUS = 1.4; // магазин как препятствие, м
export const KENNEL_RADIUS = 0.55; // будка как препятствие, м
export const FENCE_RADIUS = 0.12; // полутолщина забора, м
const SHOP_CLEAR = 4.2; // голая площадка вокруг магазина, м
const KENNEL_CLEAR = 2.2; // голая площадка вокруг будки, м
const KENNEL_OFFSET = 5.5; // будка стоит сбоку от стога, на таком расстоянии от него, м
const RIVER_HALF = 1.4; // полуширина реки, м
const BRIDGE_WIDTH = 2.8; // ширина обычного моста, м
const CENTER_BRIDGE = 7.5; // ширина моста с ларьком, м

/**
 * Сторона поля для заданного числа игроков. Один — как задано набором чисел. Несколько —
 * площадь растёт вместе с числом игроков (на каждого — столько же, сколько в игре вдвоём),
 * и всё это ещё в scale раз больше: с магазином посередине и вчетвером должно быть просторно.
 */
export function fieldSizeFor(base: number, playerCount: number, scale = 1): number {
  if (playerCount <= 1) return base;
  return Math.round(base * Math.sqrt(playerCount / 2) * scale);
}

/** Какое поле выпадает этому зерну (в игре на одного — всегда луг; втроём — без реки). */
export function mapFor(seed: number, playerCount: number): number {
  if (playerCount <= 1) return MAP_MEADOW;
  // Втроём реку не даём: двое оказались бы на одном берегу, а третий — один на другом,
  // со всей его травой.
  if (playerCount === 3) return (seed >>> 0) % 2 === 0 ? MAP_MEADOW : MAP_FENCES;
  return (seed >>> 0) % MAP_COUNT;
}

/** Ось реки: x в зависимости от y; посередине поля проходит ровно через центр. */
function riverX(size: number, y: number): number {
  return size / 2 + 1.3 * sinDeg(((y - size / 2) / size) * 360);
}

export function generateLevel(seed: number, t: Tuning, playerCount = 1, mapOverride = -1): Level {
  const size = t.fieldSize;
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const map = mapOverride >= 0 ? mapOverride : mapFor(seed, playerCount);

  // Стоги. Один игрок — стог в средней части поля. Несколько — по кругу вокруг центра,
  // друг напротив друга. У реки круг повёрнут так, чтобы ни один стог не встал у воды.
  const stacks: Point[] = [];
  if (playerCount <= 1) {
    const x = size / 2 + rng.range(-4, 4);
    const y = size / 2 + rng.range(-4, 4);
    stacks.push({ x, y });
  } else {
    const ring = size * 0.25;
    const base = map === MAP_RIVER && playerCount === 4 ? 135 : 180;
    for (let i = 0; i < playerCount; i++) {
      const angle = base + (360 * i) / playerCount;
      stacks.push({
        x: size / 2 + cosDeg(angle) * ring + rng.range(-1, 1),
        y: size / 2 + sinDeg(angle) * ring + rng.range(-2.5, 2.5),
      });
    }
  }

  // У реки стоги — не ближе 6,5 м к её оси: место для стога, старта и будки на своём берегу.
  if (map === MAP_RIVER) {
    for (const s of stacks) {
      const rx = riverX(size, s.y);
      if (Math.abs(s.x - rx) < 6.5) s.x = rx + (s.x >= rx ? 6.5 : -6.5);
    }
  }

  // Игрок стартует рядом со своим стогом, на голой площадке.
  const starts: Point[] = stacks.map((s) => ({ x: s.x + 1.9, y: s.y + 1.9 }));

  // Магазин — в центре поля. Будка — сбоку от своего стога (поперёк направления на центр):
  // так к ней можно подойти от магазина, не задев стог, иначе тюк ушёл бы в стог по дороге.
  // У реки из двух сторон берётся та, что дальше от воды.
  const shop: Point | null = playerCount > 1 ? { x: size / 2, y: size / 2 } : null;
  const kennels: Point[] = [];
  if (shop) {
    for (const s of stacks) {
      const dx = s.x - shop.x;
      const dy = s.y - shop.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 1e-6 ? dx / len : -1;
      const uy = len > 1e-6 ? dy / len : 0;
      let kx = s.x - uy * KENNEL_OFFSET;
      let ky = s.y + ux * KENNEL_OFFSET;
      if (map === MAP_RIVER) {
        const ox = s.x + uy * KENNEL_OFFSET;
        const oy = s.y - ux * KENNEL_OFFSET;
        if (Math.abs(ox - riverX(size, oy)) > Math.abs(kx - riverX(size, ky))) {
          kx = ox;
          ky = oy;
        }
      }
      kennels.push({ x: clamp(kx, 1.2, size - 1.2), y: clamp(ky, 1.2, size - 1.2) });
    }
  }

  // Чего нельзя загораживать: стоги, старты, будки, магазин.
  const keep: Point[] = [...stacks, ...starts, ...kennels];
  if (shop) keep.push(shop);

  // Заборы или река.
  let walls: Wall[] = [];
  let river: River | null = null;
  if (map === MAP_RIVER && shop) {
    river = buildRiver(size);
    walls = riverWalls(size, river);
  } else if (map === MAP_FENCES && shop) {
    walls = placeFences(rng, size, stacks, kennels, shop, keep, t.heroRadius);
  }

  // Камни: не у стогов, магазина, будок, заборов и воды, не у края и не вплотную друг к другу.
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
    if (shop && dist2(x, y, shop.x, shop.y) < (SHOP_CLEAR + 1) * (SHOP_CLEAR + 1)) continue;
    for (const k of kennels) {
      if (dist2(x, y, k.x, k.y) < (KENNEL_CLEAR + 1) * (KENNEL_CLEAR + 1)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const w of walls) {
      const keepW = w.r + r + 1.6;
      if (segDist2(x, y, w) < keepW * keepW) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (river && Math.abs(x - riverX(size, y)) < RIVER_HALF + r + 1.6) continue; // и под мостами
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
      if (shop && dist2(x, y, shop.x, shop.y) < SHOP_CLEAR * SHOP_CLEAR) continue;
      for (const k of kennels) {
        if (dist2(x, y, k.x, k.y) < KENNEL_CLEAR * KENNEL_CLEAR) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (const w of walls) {
        const keepW = w.r + 0.25;
        if (segDist2(x, y, w) < keepW * keepW) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      // В воде и на мостах трава не растёт.
      if (river && Math.abs(x - riverX(size, y)) < RIVER_HALF + 0.35) continue;
      for (const rock of rocks) {
        const keepR = rock.r + 0.25;
        if (dist2(x, y, rock.x, rock.y) < keepR * keepR) {
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

  return { field: buildField(size, xs, ys, types, hps), map, stacks, starts, rocks, shop, kennels, walls, river };
}

/** Река с тремя мостами: широким посередине (на нём ларёк) и двумя узкими ближе к краям. */
function buildRiver(size: number): River {
  const points: Point[] = [];
  for (let y = -2; y <= size + 2 + 1e-9; y += 1.5) points.push({ x: riverX(size, y), y });
  const c = size / 2;
  const bridges: Bridge[] = [];
  for (const [y, width] of [
    [c - size * 0.33, BRIDGE_WIDTH],
    [c, CENTER_BRIDGE],
    [c + size * 0.33, BRIDGE_WIDTH],
  ] as const) {
    // Поперёк реки: перпендикуляр к её оси в этом месте.
    const tx = riverX(size, y + 0.5) - riverX(size, y - 0.5);
    const len = Math.sqrt(tx * tx + 1);
    bridges.push({ x: riverX(size, y), y, ux: 1 / len, uy: -tx / len, width, length: RIVER_HALF * 2 + 1.2 });
  }
  return { points, half: RIVER_HALF, bridges };
}

/**
 * Вода как препятствие: осевая линия реки, разрезанная мостами. Каждый кусок — капсула
 * с полушириной реки; концы кусков стоят так, что проход по мосту ровно нужной ширины.
 */
function riverWalls(size: number, river: River): Wall[] {
  const gaps = river.bridges.map((b) => [b.y - b.width / 2 - river.half, b.y + b.width / 2 + river.half] as const);
  const walls: Wall[] = [];
  let y0 = -2;
  const pieces: [number, number][] = [];
  for (const [g0, g1] of gaps) {
    pieces.push([y0, g0]);
    y0 = g1;
  }
  pieces.push([y0, size + 2]);
  for (const [a, b] of pieces) {
    if (b - a < 1e-6) continue;
    const steps = Math.max(1, Math.ceil((b - a) / 1.5));
    for (let i = 0; i < steps; i++) {
      const ya = a + ((b - a) * i) / steps;
      const yb = a + ((b - a) * (i + 1)) / steps;
      walls.push({ ax: riverX(size, ya), ay: ya, bx: riverX(size, yb), by: yb, r: river.half, water: true });
    }
  }
  return walls;
}

/**
 * Заборы: прямые пролёты, углы и загоны с проходом. Ставятся так, чтобы не загородить
 * стоги, будки и магазин и чтобы между заборами оставался проход. После каждого забора
 * проверяется, что до всех стогов, будок и магазина можно дойти, иначе забор убирается.
 */
function placeFences(
  rng: Rng,
  size: number,
  stacks: Point[],
  kennels: Point[],
  shop: Point,
  keep: Point[],
  body: number,
): Wall[] {
  const walls: Wall[] = [];
  const discs: Disc[] = [
    ...stacks.map((s) => ({ x: s.x, y: s.y, r: STACK_RADIUS })),
    ...kennels.map((k) => ({ x: k.x, y: k.y, r: KENNEL_RADIUS })),
    { x: shop.x, y: shop.y, r: SHOP_RADIUS },
  ];
  const want = 7 + rng.int(4);
  let placed = 0;
  for (let attempt = 0; attempt < want * 25 && placed < want; attempt++) {
    const cx = rng.range(3, size - 3);
    const cy = rng.range(3, size - 3);
    const kind = rng.int(10);
    const piece: Wall[] = [];
    if (kind < 5) {
      // Прямой пролёт.
      const len = rng.range(5, 10);
      const dir = [0, 90, 45, 135][rng.int(4)]!;
      const dx = (cosDeg(dir) * len) / 2;
      const dy = (sinDeg(dir) * len) / 2;
      piece.push(fence(cx - dx, cy - dy, cx + dx, cy + dy));
    } else if (kind < 8) {
      // Угол: два пролёта из одной точки.
      const a = rng.range(4, 7);
      const b = rng.range(4, 7);
      const sx = rng.int(2) === 0 ? 1 : -1;
      const sy = rng.int(2) === 0 ? 1 : -1;
      piece.push(fence(cx, cy, cx + a * sx, cy), fence(cx, cy, cx, cy + b * sy));
    } else {
      // Загон (огород) с проходом в одной из сторон.
      const w = rng.range(5, 7);
      const h = rng.range(4.5, 6.5);
      const x0 = cx - w / 2;
      const y0 = cy - h / 2;
      const x1 = cx + w / 2;
      const y1 = cy + h / 2;
      const gapSide = rng.int(4);
      const gap = 2.4;
      const sides: [number, number, number, number][] = [
        [x0, y0, x1, y0],
        [x1, y0, x1, y1],
        [x1, y1, x0, y1],
        [x0, y1, x0, y0],
      ];
      sides.forEach(([ax, ay, bx, by], i) => {
        if (i !== gapSide) {
          piece.push(fence(ax, ay, bx, by));
          return;
        }
        // Сторона с проходом — два куска по краям.
        const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const half = (len - gap) / 2;
        piece.push(fence(ax, ay, ax + ux * half, ay + uy * half));
        piece.push(fence(bx - ux * half, by - uy * half, bx, by));
      });
    }

    // Не у края, не у стогов, будок и магазина, не вплотную к другим заборам.
    let ok = true;
    for (const w of piece) {
      if (Math.min(w.ax, w.bx) < 1.5 || Math.max(w.ax, w.bx) > size - 1.5) ok = false;
      if (Math.min(w.ay, w.by) < 1.5 || Math.max(w.ay, w.by) > size - 1.5) ok = false;
      for (const p of keep) {
        if (segDist2(p.x, p.y, w) < 4.6 * 4.6) ok = false;
      }
      for (const other of walls) {
        if (wallGap(w, other) < 1.8) ok = false;
      }
      if (!ok) break;
    }
    if (!ok) continue;

    // Проверить, что всё по-прежнему достижимо.
    const trial = [...walls, ...piece];
    const nav = buildNav(size, discs, trial, body + 0.05);
    let connected = true;
    for (let i = 1; i < keep.length && connected; i++) connected = reachable(nav, keep[0]!, keep[i]!);
    if (!connected) continue;
    walls.push(...piece);
    placed++;
  }
  return walls;
}

function fence(ax: number, ay: number, bx: number, by: number): Wall {
  return { ax, ay, bx, by, r: FENCE_RADIUS, water: false };
}

/** Примерное наименьшее расстояние между двумя отрезками (по точкам через 0,5 м). */
function wallGap(a: Wall, b: Wall): number {
  const len = Math.sqrt((a.bx - a.ax) * (a.bx - a.ax) + (a.by - a.ay) * (a.by - a.ay));
  const steps = Math.max(1, Math.ceil(len / 0.5));
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const x = a.ax + ((a.bx - a.ax) * i) / steps;
    const y = a.ay + ((a.by - a.ay) * i) / steps;
    const d2 = segDist2(x, y, b);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best) - a.r - b.r;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
