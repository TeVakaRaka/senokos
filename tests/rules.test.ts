// Правила косьбы и движения.

import { describe, expect, it } from 'vitest';
import { createGame, type Game } from '../src/sim/game.ts';
import { STACK_RADIUS } from '../src/sim/gen.ts';
import { DT } from '../src/sim/tuning.ts';
import { EAST, me, NORTH, place, run, solid, WEST } from './util.ts';

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
    const g = createGame(7, solid());
    const p = me(g);
    let checked = 0;
    for (let i = 0; i < 600; i++) {
      run(g, EAST, 1);
      const s = p.swing;
      if (!s) continue;
      for (let k = p.cutFrom; k < p.cutTo; k++) {
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
    const g = createGame(7, solid());
    const p = me(g);
    let last = -1000;
    for (let i = 0; i < 600; i++) {
      run(g, EAST, 1);
      if (p.swing) {
        expect(g.tick - last).toBeGreaterThanOrEqual(p.d.swingTicks);
        last = g.tick;
      }
    }
  });

  it('не машет впустую, когда травы в секторе нет', () => {
    const g = createGame(7, solid());
    run(g, 0, 90); // стоит на голой площадке у стога
    expect(me(g).swings).toBe(0);
  });

  it('считает скошенное сено', () => {
    const g = createGame(7, solid());
    const p = me(g);
    run(g, EAST, 600);
    expect(p.cutTufts).toBeGreaterThan(100);
    expect(p.cutKg).toBeCloseTo(p.cutTufts * g.tuning.grassYield[0], 6);
    expect(g.field.standing).toBe(g.field.count - p.cutTufts);
  });
});

describe('шаг косаря', () => {
  it('оставляет сплошную полосу', () => {
    const g = createGame(7, solid());
    const p = me(g);
    const startX = p.x;
    const laneY = p.y;
    run(g, EAST, 300);
    expect(p.x).toBeGreaterThan(startX + 8);
    // Сердцевина полосы: шире метра в каждую сторону от линии хода.
    const share = cutShare(g, startX + 3, p.x - 0.3, laneY - 1.0, laneY + 1.0);
    expect(share).toBeGreaterThanOrEqual(0.98);
  });

  it('в траве идёт в темпе 0,55 радиуса за взмах', () => {
    const g = createGame(7, solid());
    const p = me(g);
    run(g, EAST, 90); // выйти с площадки и войти в ритм
    const x0 = p.x;
    run(g, EAST, 240);
    const speed = (p.x - x0) / (240 * DT);
    expect(speed).toBeGreaterThan(p.d.mowSpeed * 0.9);
    expect(speed).toBeLessThan(p.d.mowSpeed * 1.2);
  });

  it('по своей полосе назад бежит, а не идёт шагом косаря', () => {
    const g = createGame(7, solid());
    run(g, EAST, 300);
    run(g, WEST, 45);
    // С косой в руках бег чуть медленнее, чем с граблями.
    expect(me(g).speed).toBeGreaterThanOrEqual(g.tuning.runSpeed * g.tuning.scytheSpeed * 0.95);
  });

  it('жёсткую траву прокашивает целиком, но идёт медленнее', () => {
    const g = createGame(7, solid({ grassHp: [3, 3, 3] }));
    const p = me(g);
    const startX = p.x;
    const laneY = p.y;
    run(g, EAST, 90);
    const x0 = p.x;
    run(g, EAST, 600);
    const speed = (p.x - x0) / (600 * DT);
    expect(speed).toBeLessThan((p.d.mowSpeed / 3) * 1.25);
    expect(speed).toBeGreaterThan((p.d.mowSpeed / 3) * 0.75);
    const share = cutShare(g, startX + 3, p.x - 0.3, laneY - 0.9, laneY + 0.9);
    expect(share).toBeGreaterThanOrEqual(0.98);
  });
});

describe('препятствия и края', () => {
  it('сквозь стог пройти нельзя', () => {
    const g = createGame(7, solid());
    const p = me(g);
    // Игрок стартует к «юго-востоку» от стога; направление 40 ведёт прямо на него.
    run(g, 41, 120);
    const dist = Math.hypot(p.x - p.stackX, p.y - p.stackY);
    expect(dist).toBeGreaterThanOrEqual(STACK_RADIUS + g.tuning.heroRadius - 1e-6);
  });

  it('за край поля выйти нельзя', () => {
    const g = createGame(7, solid({ runSpeed: 30, stepFrac: 6 }));
    const p = me(g);
    run(g, EAST, 900);
    expect(p.x).toBeLessThanOrEqual(g.tuning.fieldSize - g.tuning.heroRadius + 1e-9);
    run(g, NORTH, 900);
    expect(p.y).toBeLessThanOrEqual(g.tuning.fieldSize - g.tuning.heroRadius + 1e-9);
  });

  it('камни не проходятся насквозь', () => {
    const g = createGame(11);
    const p = me(g);
    expect(g.rocks.length).toBeGreaterThan(0);
    const rock = g.rocks[0]!;
    // Ставим игрока слева от камня и ведём прямо на него.
    place(p, rock.x - rock.r - 1.5, rock.y);
    run(g, EAST, 150);
    for (const r of g.rocks) {
      const dist = Math.hypot(p.x - r.x, p.y - r.y);
      expect(dist).toBeGreaterThanOrEqual(r.r + g.tuning.heroRadius - 1e-6);
    }
  });
});
