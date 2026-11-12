// Правила косьбы и движения (шаг 1 плана).

import { describe, expect, it } from 'vitest';
import { createGame, step, type Game } from '../src/sim/game.ts';
import { STACK_RADIUS } from '../src/sim/gen.ts';
import { cloneTuning, DEFAULT_TUNING, DT, type Tuning } from '../src/sim/tuning.ts';

const EAST = 1; // ввод «направление 0»: вдоль +x
const WEST = 33; // направление 32: вдоль −x

/**
 * Сплошное поле без камней и голых пятен — чтобы проверять геометрию полосы.
 * Поле больше обычного, иначе герой за время замера упирается в край.
 */
function solidTuning(patch: Partial<Tuning> = {}): Tuning {
  return { ...cloneTuning(DEFAULT_TUNING), fieldSize: 64, coverage: 1.5, rockCount: 0, ...patch };
}

function run(g: Game, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(g, input);
}

/** Доля скошенных кустиков в прямоугольнике. */
function cutShare(g: Game, x0: number, x1: number, y0: number, y1: number): number {
  let total = 0;
  let cut = 0;
  const f = g.field;
  for (let i = 0; i < f.count; i++) {
    if (f.x[i]! < x0 || f.x[i]! > x1 || f.y[i]! < y0 || f.y[i]! > y1) continue;
    total++;
    if (f.hp[i] === 0) cut++;
  }
  expect(total).toBeGreaterThan(20);
  return cut / total;
}

describe('коса', () => {
  it('режет только внутри своего сектора', () => {
    const g = createGame(7, solidTuning());
    let checked = 0;
    for (let i = 0; i < 600; i++) {
      step(g, EAST);
      const s = g.swing;
      if (!s) continue;
      for (let k = 0; k < g.cutCount; k++) {
        const idx = g.cutIdx[k]!;
        const dx = g.field.x[idx]! - s.x;
        const dy = g.field.y[idx]! - s.y;
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(s.reach + 1e-6);
        // Направление 0 — вдоль +x: угол между кустиком и курсом не больше половины дуги.
        const angle = (Math.atan2(Math.abs(dy), dx) * 180) / Math.PI;
        expect(angle).toBeLessThanOrEqual(s.arcDeg / 2 + 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('бьёт не чаще заданного периода', () => {
    const g = createGame(7, solidTuning());
    let last = -1000;
    for (let i = 0; i < 600; i++) {
      step(g, EAST);
      if (g.swing) {
        expect(g.tick - last).toBeGreaterThanOrEqual(g.d.swingTicks);
        last = g.tick;
      }
    }
  });

  it('не машет впустую, когда травы в секторе нет', () => {
    const g = createGame(7, solidTuning());
    run(g, 0, 90); // стоит на голой площадке у стога
    expect(g.swings).toBe(0);
  });

  it('считает скошенное сено', () => {
    const g = createGame(7, solidTuning());
    run(g, EAST, 600);
    expect(g.cutTufts).toBeGreaterThan(100);
    expect(g.cutKg).toBeCloseTo(g.cutTufts * g.tuning.grassYield[0], 6);
    expect(g.field.standing).toBe(g.field.count - g.cutTufts);
  });
});

describe('шаг косаря', () => {
  it('оставляет сплошную полосу', () => {
    const g = createGame(7, solidTuning());
    const startX = g.hero.x;
    const laneY = g.hero.y;
    run(g, EAST, 300);
    expect(g.hero.x).toBeGreaterThan(startX + 8);
    // Сердцевина полосы: шире метра в каждую сторону от линии хода.
    const share = cutShare(g, startX + 3, g.hero.x - 0.3, laneY - 1.0, laneY + 1.0);
    expect(share).toBeGreaterThanOrEqual(0.98);
  });

  it('в траве идёт в темпе 0,55 радиуса за взмах', () => {
    const g = createGame(7, solidTuning());
    run(g, EAST, 90); // выйти с площадки и войти в ритм
    const x0 = g.hero.x;
    run(g, EAST, 240);
    const speed = (g.hero.x - x0) / (240 * DT);
    expect(speed).toBeGreaterThan(g.d.mowSpeed * 0.9);
    expect(speed).toBeLessThan(g.d.mowSpeed * 1.2);
  });

  it('по своей полосе назад бежит в полную силу', () => {
    const g = createGame(7, solidTuning());
    run(g, EAST, 300);
    run(g, WEST, 45);
    expect(g.hero.speed).toBeGreaterThanOrEqual(g.tuning.runSpeed * 0.95);
  });

  it('жёсткую траву прокашивает целиком, но идёт медленнее', () => {
    const g = createGame(7, solidTuning({ grassHp: [3, 3, 3] }));
    const startX = g.hero.x;
    const laneY = g.hero.y;
    run(g, EAST, 90);
    const x0 = g.hero.x;
    run(g, EAST, 600);
    const speed = (g.hero.x - x0) / (600 * DT);
    expect(speed).toBeLessThan((g.d.mowSpeed / 3) * 1.25);
    expect(speed).toBeGreaterThan((g.d.mowSpeed / 3) * 0.75);
    const share = cutShare(g, startX + 3, g.hero.x - 0.3, laneY - 0.9, laneY + 0.9);
    expect(share).toBeGreaterThanOrEqual(0.98);
  });
});

describe('препятствия и края', () => {
  it('сквозь стог пройти нельзя', () => {
    const g = createGame(7, solidTuning());
    // Герой стартует к «юго-востоку» от стога; направление 40 ведёт прямо на него.
    run(g, 41, 120);
    const dist = Math.hypot(g.hero.x - g.stackX, g.hero.y - g.stackY);
    expect(dist).toBeGreaterThanOrEqual(STACK_RADIUS + g.tuning.heroRadius - 1e-6);
  });

  it('за край поля выйти нельзя', () => {
    const g = createGame(7, solidTuning({ runSpeed: 30, stepFrac: 6 }));
    run(g, EAST, 900);
    expect(g.hero.x).toBeLessThanOrEqual(g.tuning.fieldSize - g.tuning.heroRadius + 1e-9);
    run(g, 17, 900); // направление 16: вдоль +y
    expect(g.hero.y).toBeLessThanOrEqual(g.tuning.fieldSize - g.tuning.heroRadius + 1e-9);
  });

  it('камни не проходятся насквозь', () => {
    const g = createGame(11);
    expect(g.rocks.length).toBeGreaterThan(0);
    const rock = g.rocks[0]!;
    // Ставим героя слева от камня и ведём прямо на него.
    g.hero.x = rock.x - rock.r - 1.5;
    g.hero.y = rock.y;
    run(g, EAST, 150);
    for (const r of g.rocks) {
      const dist = Math.hypot(g.hero.x - r.x, g.hero.y - r.y);
      expect(dist).toBeGreaterThanOrEqual(r.r + g.tuning.heroRadius - 1e-6);
    }
  });
});
