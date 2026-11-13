// Карта проходимости для поиска пути: сетка с шагом 0,5 м, клетка занята, если её центр
// ближе к препятствию, чем радиус косаря. Нужна боту (обходить заборы и реку) и генератору
// поля (проверить, что до всех стогов, будок и магазина можно дойти).

import type { Point } from './gen.ts';

export const NAV_STEP = 0.5;

/** Препятствие-капсула: отрезок с толщиной (забор, кусок реки). */
export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number; // полутолщина, м
  water: boolean; // вода (река) или забор
}

/** Круглое препятствие (стог, камень, магазин, будка). */
export interface Disc {
  x: number;
  y: number;
  r: number;
}

export interface Nav {
  cols: number;
  blocked: Uint8Array;
  // Рабочие буферы поиска — чтобы не заводить их на каждом запросе.
  prev: Int32Array;
  queue: Int32Array;
}

/** Расстояние от точки до отрезка (квадрат). */
export function segDist2(px: number, py: number, w: Wall): number {
  const dx = w.bx - w.ax;
  const dy = w.by - w.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((px - w.ax) * dx + (py - w.ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = w.ax + dx * t - px;
  const cy = w.ay + dy * t - py;
  return cx * cx + cy * cy;
}

/** Построить сетку: клетка занята, если тело радиуса body не помещается в её центре. */
export function buildNav(size: number, discs: readonly Disc[], walls: readonly Wall[], body: number): Nav {
  const cols = Math.ceil(size / NAV_STEP);
  const blocked = new Uint8Array(cols * cols);
  for (let cy = 0; cy < cols; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * NAV_STEP;
      const y = (cy + 0.5) * NAV_STEP;
      let hit = x < body || y < body || x > size - body || y > size - body;
      for (let i = 0; !hit && i < discs.length; i++) {
        const d = discs[i]!;
        const keep = d.r + body;
        const dx = x - d.x;
        const dy = y - d.y;
        if (dx * dx + dy * dy < keep * keep) hit = true;
      }
      for (let i = 0; !hit && i < walls.length; i++) {
        const w = walls[i]!;
        const keep = w.r + body;
        if (segDist2(x, y, w) < keep * keep) hit = true;
      }
      if (hit) blocked[cy * cols + cx] = 1;
    }
  }
  return { cols, blocked, prev: new Int32Array(cols * cols), queue: new Int32Array(cols * cols) };
}

function cellOf(nav: Nav, v: number): number {
  const c = Math.floor(v / NAV_STEP);
  return c < 0 ? 0 : c >= nav.cols ? nav.cols - 1 : c;
}

/** Номер клетки, в которой точка (x, y). */
export function cellIndex(nav: Nav, x: number, y: number): number {
  return cellOf(nav, y) * nav.cols + cellOf(nav, x);
}

/** Свободна ли точка (её клетка). */
export function free(nav: Nav, x: number, y: number): boolean {
  return nav.blocked[cellIndex(nav, x, y)] === 0;
}

/**
 * Прямой путь от A к B свободен? Последние stopShort метров не проверяются: цель может
 * стоять вплотную к препятствию (стог, магазин) — подойти к ней всё равно можно.
 */
export function lineClear(nav: Nav, ax: number, ay: number, bx: number, by: number, stopShort = 0): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const span = len - stopShort;
  if (span <= 0) return true;
  const steps = Math.ceil(span / (NAV_STEP * 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = (span * i) / steps / len;
    if (!free(nav, ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}

/** Ближайшая к клетке свободная клетка (поиск по кольцам) или −1. */
function nearestFree(nav: Nav, cell: number): number {
  if (nav.blocked[cell] === 0) return cell;
  const cols = nav.cols;
  const cx = cell % cols;
  const cy = (cell - cx) / cols;
  for (let ring = 1; ring < 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= cols) continue;
        if (nav.blocked[y * cols + x] === 0) return y * cols + x;
      }
    }
  }
  return -1;
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Поиск в ширину от start до goal (номера клеток). Возвращает число шагов пути или −1.
 * После успешного поиска путь читается по nav.prev от goal к start.
 */
function search(nav: Nav, start: number, goal: number): number {
  const cols = nav.cols;
  const prev = nav.prev;
  const queue = nav.queue;
  prev.fill(-1);
  prev[start] = start;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cell = queue[head++]!;
    if (cell === goal) return tail;
    const cx = cell % cols;
    const cy = (cell - cx) / cols;
    for (let k = 0; k < 8; k++) {
      const x = cx + NX[k]!;
      const y = cy + NY[k]!;
      if (x < 0 || y < 0 || x >= cols || y >= cols) continue;
      const next = y * cols + x;
      if (prev[next] !== -1 || nav.blocked[next] === 1) continue;
      // По диагонали — только если обе соседние клетки свободны: не срезать угол забора.
      if (k >= 4 && (nav.blocked[cy * cols + x] === 1 || nav.blocked[y * cols + cx] === 1)) continue;
      prev[next] = cell;
      queue[tail++] = next;
    }
  }
  return -1;
}

/** Можно ли дойти от одной точки до другой. */
export function reachable(nav: Nav, a: Point, b: Point): boolean {
  const start = nearestFree(nav, cellIndex(nav, a.x, a.y));
  const goal = nearestFree(nav, cellIndex(nav, b.x, b.y));
  if (start < 0 || goal < 0) return false;
  return search(nav, start, goal) >= 0;
}

/**
 * Куда идти, чтобы добраться от S до T в обход препятствий: самая дальняя точка пути,
 * до которой видно напрямую. Пишет её в out. Возвращает false, если дороги нет.
 */
export function waypoint(nav: Nav, sx: number, sy: number, tx: number, ty: number, out: Point): boolean {
  const start = nearestFree(nav, cellIndex(nav, sx, sy));
  const goal = nearestFree(nav, cellIndex(nav, tx, ty));
  if (start < 0 || goal < 0 || search(nav, start, goal) < 0) return false;
  const cols = nav.cols;
  // Идём от цели к началу; запоминаем самую дальнюю от начала клетку, видимую из S.
  let cell = goal;
  let best = goal;
  let guard = 0;
  while (cell !== start && guard++ < cols * cols) {
    const x = (cell % cols + 0.5) * NAV_STEP;
    const y = (Math.floor(cell / cols) + 0.5) * NAV_STEP;
    if (lineClear(nav, sx, sy, x, y)) {
      best = cell;
      break;
    }
    best = cell;
    cell = nav.prev[cell]!;
  }
  out.x = (best % cols + 0.5) * NAV_STEP;
  out.y = (Math.floor(best / cols) + 0.5) * NAV_STEP;
  return true;
}
