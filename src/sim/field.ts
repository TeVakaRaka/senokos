// Поле: кустики травы в плоских массивах и сетка для быстрого поиска соседей.
// Кустики не двигаются, поэтому сетка строится один раз.
//
// Жизнь кустика: стоит (hp > 0) → скошен и лежит на месте, сохнет (hp = 0, hay > 0) →
// сгребён граблями (hp = 0, hay = 0).

export const GRASS_MEADOW = 0; // луговая
export const GRASS_COUCH = 1; // пырей
export const GRASS_SEDGE = 2; // осока

export interface Field {
  size: number; // сторона поля, м
  count: number; // сколько кустиков всего
  x: Float32Array;
  y: Float32Array;
  type: Uint8Array;
  hp: Uint8Array; // сколько ударов осталось; 0 — скошен
  hay: Float64Array; // сколько сена лежит на месте кустика, кг (0 — стоит или сгребён)
  cutTick: Int32Array; // шаг, на котором скошен (сохнет от этого момента)
  standing: number; // сколько ещё стоит

  // Сетка поиска: ячейка 1×1 м, кустики одной ячейки лежат подряд в cellItems.
  cols: number;
  cellStart: Int32Array; // длина cols*cols + 1
  cellItems: Int32Array; // длина count
}

export function buildField(
  size: number,
  xs: number[],
  ys: number[],
  types: number[],
  hps: number[],
): Field {
  const count = xs.length;
  const cols = Math.ceil(size);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const type = new Uint8Array(count);
  const hp = new Uint8Array(count);
  const hay = new Float64Array(count);
  const cutTick = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = xs[i]!;
    y[i] = ys[i]!;
    type[i] = types[i]!;
    hp[i] = hps[i]!;
  }

  const cellStart = new Int32Array(cols * cols + 1);
  const cellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const c = cellIndex(cols, x[i]!, y[i]!);
    cellOf[i] = c;
    cellStart[c + 1]!++;
  }
  for (let c = 0; c < cols * cols; c++) cellStart[c + 1]! += cellStart[c]!;
  const cursor = cellStart.slice(0, cols * cols);
  const cellItems = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const c = cellOf[i]!;
    cellItems[cursor[c]!] = i;
    cursor[c]!++;
  }

  return { size, count, x, y, type, hp, hay, cutTick, standing: count, cols, cellStart, cellItems };
}

export function cellCoord(cols: number, v: number): number {
  const c = Math.floor(v);
  return c < 0 ? 0 : c >= cols ? cols - 1 : c;
}

export function cellIndex(cols: number, x: number, y: number): number {
  return cellCoord(cols, y) * cols + cellCoord(cols, x);
}

/** Есть ли стоячий кустик ближе r к точке. */
export function standingWithin(f: Field, px: number, py: number, r: number): boolean {
  const r2 = r * r;
  const c0 = cellCoord(f.cols, px - r);
  const c1 = cellCoord(f.cols, px + r);
  const r0 = cellCoord(f.cols, py - r);
  const r1 = cellCoord(f.cols, py + r);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const cell = cy * f.cols + cx;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        if (f.hp[i] === 0) continue;
        const dx = f.x[i]! - px;
        const dy = f.y[i]! - py;
        if (dx * dx + dy * dy <= r2) return true;
      }
    }
  }
  return false;
}

/** Есть ли стоячий кустик в прямоугольнике. */
export function standingInRect(f: Field, x0: number, x1: number, y0: number, y1: number): boolean {
  if (x1 < x0 || y1 < y0) return false;
  const c0 = cellCoord(f.cols, x0);
  const c1 = cellCoord(f.cols, x1);
  const r0 = cellCoord(f.cols, y0);
  const r1 = cellCoord(f.cols, y1);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const cell = cy * f.cols + cx;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        if (f.hp[i] === 0) continue;
        const x = f.x[i]!;
        const y = f.y[i]!;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
      }
    }
  }
  return false;
}

/** Индекс ближайшего стоячего кустика или −1. */
export function nearestStanding(f: Field, px: number, py: number): number {
  if (f.standing === 0) return -1;
  return nearestTuft(f, px, py, Infinity, (i) => f.hp[i] !== 0);
}

/**
 * Индекс ближайшего кустика, для которого accept(i) верно, не дальше maxDist; иначе −1.
 * Ищет кольцами ячеек от точки наружу.
 */
export function nearestTuft(f: Field, px: number, py: number, maxDist: number, accept: (i: number) => boolean): number {
  const hx = cellCoord(f.cols, px);
  const hy = cellCoord(f.cols, py);
  let best = -1;
  let bestD2 = maxDist === Infinity ? Infinity : maxDist * maxDist;
  const maxRing = maxDist === Infinity ? f.cols : Math.min(f.cols, Math.ceil(maxDist) + 1);
  for (let ring = 0; ring < maxRing; ring++) {
    // Кольцо на расстоянии ring ячеек не может дать кустик ближе (ring − 1) метров.
    if (best >= 0) {
      const lower = ring - 1;
      if (lower > 0 && lower * lower > bestD2) break;
    }
    const y0 = hy - ring;
    const y1 = hy + ring;
    const x0 = hx - ring;
    const x1 = hx + ring;
    for (let cy = y0; cy <= y1; cy++) {
      if (cy < 0 || cy >= f.cols) continue;
      const edgeRow = cy === y0 || cy === y1;
      const stepX = edgeRow ? 1 : x1 - x0 === 0 ? 1 : x1 - x0;
      for (let cx = x0; cx <= x1; cx += stepX) {
        if (cx < 0 || cx >= f.cols) continue;
        const cell = cy * f.cols + cx;
        const end = f.cellStart[cell + 1]!;
        for (let k = f.cellStart[cell]!; k < end; k++) {
          const i = f.cellItems[k]!;
          if (!accept(i)) continue;
          const dx = f.x[i]! - px;
          const dy = f.y[i]! - py;
          const d2 = dx * dx + dy * dy;
          // При равенстве побеждает меньший индекс — порядок обхода не влияет на ответ.
          if (d2 < bestD2 || (d2 === bestD2 && i < best)) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
  }
  return best;
}
