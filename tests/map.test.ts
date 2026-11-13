// Локации: луг, огороды с заборами, река с мостами.

import { describe, expect, it } from 'vitest';
import { autoplay } from '../src/sim/autoplay.ts';
import { dirFromVector } from '../src/sim/dirs.ts';
import { createGame, step, TOOL_RAKE, TOOL_SCYTHE, type Game, type Player, type Wall } from '../src/sim/game.ts';
import { mapFor, MAP_FENCES, MAP_MEADOW, MAP_RIVER, type Point } from '../src/sim/gen.ts';
import { reachable, segDist2 } from '../src/sim/nav.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';
import { EAST, place, run } from './util.ts';

const R = DEFAULT_TUNING.heroRadius;

/** Важные точки поля: стоги, будки, магазин. */
function keyPoints(g: Game): Point[] {
  const pts: Point[] = g.players.map((p) => ({ x: p.stackX, y: p.stackY }));
  for (const k of g.kennels) pts.push({ x: k.x, y: k.y });
  if (g.shop) pts.push({ x: g.shop.x, y: g.shop.y });
  return pts;
}

/** Длинный пролёт забора на огородах зерна 2: его середина и единичная нормаль к нему. */
function fenceOf(g: Game): { w: Wall; mx: number; my: number; nx: number; ny: number; tx: number; ty: number } {
  const w = g.walls.find((x) => !x.water && Math.hypot(x.bx - x.ax, x.by - x.ay) > 3)!;
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
  const tx = (w.bx - w.ax) / len;
  const ty = (w.by - w.ay) / len;
  return { w, mx: (w.ax + w.bx) / 2, my: (w.ay + w.by) / 2, nx: -ty, ny: tx, tx, ty };
}

/** Ввод «идти к точке» для игрока (как палец, направленный на неё). */
function toward(g: Game, id: number, x: number, y: number): number {
  const p = g.players[id]!;
  const turn = Math.atan2(y - p.y, x - p.x) / (Math.PI * 2);
  return (((Math.round(turn * 64) % 64) + 64) % 64) + 1;
}

describe('локации', () => {
  it('в одиночку всегда луг; на нескольких локацию выбирает зерно', () => {
    for (let seed = 1; seed < 10; seed++) expect(mapFor(seed, 1)).toBe(MAP_MEADOW);
    const seen = new Set<number>();
    for (let seed = 1; seed < 10; seed++) seen.add(mapFor(seed, 2));
    expect([...seen].sort()).toEqual([MAP_MEADOW, MAP_FENCES, MAP_RIVER]);
    for (let seed = 1; seed < 10; seed++) seen.add(mapFor(seed, 4));
    expect([...seen].sort()).toEqual([MAP_MEADOW, MAP_FENCES, MAP_RIVER]);
    expect(createGame(5).walls).toEqual([]);
    expect(createGame(7, DEFAULT_TUNING, 2, MAP_MEADOW).walls).toEqual([]);
  });

  it('втроём реки не бывает: один оказался бы на своём берегу один, со всей его травой', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 40; seed++) seen.add(mapFor(seed, 3));
    expect([...seen].sort()).toEqual([MAP_MEADOW, MAP_FENCES]);
    for (let seed = 1; seed < 12; seed++) expect(createGame(seed, DEFAULT_TUNING, 3).river).toBeNull();
  });

  for (const map of [MAP_FENCES, MAP_RIVER]) {
    for (const players of [2, 3, 4]) {
      it(`${map === MAP_FENCES ? 'огороды' : 'река'}, игроков ${players}: до всех стогов, будок и магазина можно дойти`, () => {
        for (const seed of [1, 2, 3, 4, 5]) {
          const g = createGame(seed, DEFAULT_TUNING, players, map);
          expect(g.walls.length).toBeGreaterThan(map === MAP_RIVER ? 8 : 4);
          const pts = keyPoints(g);
          for (const p of pts) expect(reachable(g.nav, pts[0]!, p)).toBe(true);
          // Ни забор, ни вода не задевают стоги, будки, магазин и старты.
          for (const w of g.walls) {
            for (const p of [...pts, ...g.players.map((q) => ({ x: q.x, y: q.y }))]) {
              expect(Math.sqrt(segDist2(p.x, p.y, w)) - w.r).toBeGreaterThan(2.4);
            }
          }
        }
      });
    }
  }

  it('река: трава не растёт в воде и на мостах', () => {
    const g = createGame(3, DEFAULT_TUNING, 2, MAP_RIVER);
    const river = g.river!;
    for (let i = 0; i < g.field.count; i++) {
      const x = g.field.x[i]!;
      const y = g.field.y[i]!;
      // Ближайшая точка оси реки — через её отрезки.
      let best = Infinity;
      for (let k = 0; k + 1 < river.points.length; k++) {
        const a = river.points[k]!;
        const b = river.points[k + 1]!;
        best = Math.min(best, segDist2(x, y, { ax: a.x, ay: a.y, bx: b.x, by: b.y, r: 0, water: true }));
      }
      expect(Math.sqrt(best)).toBeGreaterThan(river.half + 0.2);
    }
  });

  it('река: вброд не перейти — косарь останавливается у берега', () => {
    const g = createGame(3, DEFAULT_TUNING, 2, MAP_RIVER);
    const p = g.players[0]!;
    const river = g.river!;
    const bridge = river.bridges[0]!;
    // Идём на восток посередине между мостами.
    const y = (bridge.y + river.bridges[1]!.y) / 2;
    place(p, g.tuning.fieldSize / 2 - 6, y);
    p.tool = TOOL_RAKE;
    run(g, EAST, 120);
    expect(p.x).toBeLessThan(g.tuning.fieldSize / 2 - river.half - R + 1.4); // у западного берега
  });

  it('река: по мосту переходит на другой берег', () => {
    const g = createGame(3, DEFAULT_TUNING, 2, MAP_RIVER);
    const p = g.players[0]!;
    const bridge = g.river!.bridges[0]!;
    place(p, bridge.x - 5, bridge.y);
    p.tool = TOOL_RAKE;
    run(g, EAST, 70);
    expect(p.x).toBeGreaterThan(bridge.x + 3);
  });

  it('река: на среднем мосту ларёк, обойти его можно и сверху, и снизу', () => {
    const g = createGame(3, DEFAULT_TUNING, 2, MAP_RIVER);
    const shop = g.shop!;
    const mid = g.river!.bridges[1]!;
    expect(mid.x).toBeCloseTo(shop.x, 6);
    expect(mid.y).toBeCloseTo(shop.y, 6);
    for (const side of [-1, 1]) {
      const p = g.players[0]!;
      place(p, shop.x - 5, shop.y + side * 2.6);
      p.tool = TOOL_RAKE;
      run(g, EAST, 75);
      expect(p.x).toBeGreaterThan(shop.x + 3);
    }
  });

  it('забор не пройти: упёрся — стоит по свою сторону', () => {
    const g = createGame(2, DEFAULT_TUNING, 2, MAP_FENCES);
    const p = g.players[0]!;
    p.tool = TOOL_RAKE;
    // Любой пролёт забора: встаём в двух метрах сбоку и идём на него.
    const w = g.walls.find((x) => !x.water && Math.hypot(x.bx - x.ax, x.by - x.ay) > 3)!;
    const mx = (w.ax + w.bx) / 2;
    const my = (w.ay + w.by) / 2;
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const nx = -(w.by - w.ay) / len;
    const ny = (w.bx - w.ax) / len;
    place(p, mx + nx * 2, my + ny * 2);
    for (let i = 0; i < 90; i++) step(g, toward(g, 0, mx - nx * 3, my - ny * 3));
    // По-прежнему с той же стороны забора.
    expect((p.x - mx) * nx + (p.y - my) * ny).toBeGreaterThan(0);
    expect(Math.sqrt(segDist2(p.x, p.y, w))).toBeGreaterThanOrEqual(w.r + R - 1e-6);
  });

  it('отброшенный выстрелом не пролетает сквозь забор', () => {
    const g = createGame(2, DEFAULT_TUNING, 2, MAP_FENCES);
    const [a, b] = g.players;
    const w = g.walls.find((x) => !x.water && Math.hypot(x.bx - x.ax, x.by - x.ay) > 3)!;
    const mx = (w.ax + w.bx) / 2;
    const my = (w.ay + w.by) / 2;
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const nx = -(w.by - w.ay) / len;
    const ny = (w.bx - w.ax) / len;
    // Б стоит в метре от забора, А стреляет в него в сторону забора.
    place(b!, mx + nx * 1, my + ny * 1);
    place(a!, mx + nx * 2.6, my + ny * 2.6);
    a!.tool = TOOL_SCYTHE; // ружьё стреляет только с косой в руках
    a!.dir = toward(g, 0, b!.x, b!.y) - 1;
    g.shop!.sold = true;
    g.gun = { holder: 0, x: 0, y: 0, cd: 0 };
    step(g, [0, 0]);
    expect(b!.down).toBeGreaterThan(0);
    run(g, [0, 0], g.flyTicks + 2);
    expect((b!.x - mx) * nx + (b!.y - my) * ny).toBeGreaterThan(0); // остался по эту сторону
  });

  it('забор прикрывает: коса через него не достаёт', () => {
    const g = createGame(2, DEFAULT_TUNING, 2, MAP_FENCES);
    const [a, b] = g.players as [Player, Player];
    const f = fenceOf(g);
    // По разные стороны забора, в 1,6 м друг от друга: А лицом к Б и машет косой.
    place(a, f.mx + f.nx * 0.8, f.my + f.ny * 0.8);
    place(b, f.mx - f.nx * 0.8, f.my - f.ny * 0.8);
    a.tool = TOOL_SCYTHE;
    b.tool = TOOL_RAKE;
    a.dir = dirFromVector(b.x - a.x, b.y - a.y);
    for (let i = 0; i < 45; i++) {
      step(g, [0, 0]);
      expect(b.woundedBy).toBe(-1);
    }
    expect(b.wound).toBe(0);
    // Те же 1,6 м, но по одну сторону забора — достаёт.
    place(b, a.x + f.tx * 1.6, a.y + f.ty * 1.6);
    a.dir = dirFromVector(b.x - a.x, b.y - a.y);
    let hit = false;
    for (let i = 0; i < 45 && !hit; i++) {
      step(g, [0, 0]);
      if (b.woundedBy === 0) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('забор прикрывает: ружьё через него не стреляет', () => {
    const g = createGame(2, DEFAULT_TUNING, 2, MAP_FENCES);
    const [a, b] = g.players as [Player, Player];
    const f = fenceOf(g);
    place(a, f.mx + f.nx * 0.8, f.my + f.ny * 0.8);
    place(b, f.mx - f.nx * 0.8, f.my - f.ny * 0.8);
    a.tool = TOOL_SCYTHE;
    a.dir = dirFromVector(b.x - a.x, b.y - a.y);
    g.shop!.sold = true;
    g.gun = { holder: 0, x: 0, y: 0, cd: 0 };
    for (let i = 0; i < 30; i++) step(g, [0, 0]);
    expect(a.shotHits).toBe(0);
    expect(b.down).toBe(0);
    expect(g.gun.cd).toBe(0); // и заряд не потрачен
    place(b, a.x + f.tx * 1.6, a.y + f.ty * 1.6);
    a.dir = dirFromVector(b.x - a.x, b.y - a.y);
    step(g, [0, 0]);
    expect(b.down).toBeGreaterThan(0);
  });

  it('забор прикрывает и от собаки: сквозь него она не кусает', () => {
    // Сторожевой круг и поводок — на всё поле, чтобы собака пошла на чужого у любого забора.
    const g = createGame(2, { ...DEFAULT_TUNING, dogGuard: 1000, dogLeash: 1000 }, 2, MAP_FENCES);
    const [, b] = g.players as [Player, Player];
    const f = fenceOf(g);
    const x = f.mx + f.nx * 0.45;
    const y = f.my + f.ny * 0.45;
    g.dogs[0] = { owner: 0, x, y, px: x, py: y, fx: -f.nx, fy: -f.ny, speed: 0, target: -1, biteCd: 0, crawl: 0, shield: 0, bit: -1, hurtBy: -1 };
    place(b, f.mx - f.nx * 0.5, f.my - f.ny * 0.5); // вплотную, но за забором
    b.tool = TOOL_RAKE;
    for (let i = 0; i < 60; i++) {
      step(g, [0, 0]);
      expect(b.bitBy).toBe(-1);
    }
    expect(g.dogs[0]!.target).toBe(1); // хочет, да не может
    place(b, g.dogs[0]!.x + f.tx * 0.9, g.dogs[0]!.y + f.ty * 0.9); // вышел из-за забора
    let bitten = false;
    for (let i = 0; i < 30 && !bitten; i++) {
      step(g, [0, 0]);
      if (b.bitBy === 0) bitten = true;
    }
    expect(bitten).toBe(true);
  });

  it('боты на огородах и у реки возят сено и не застревают', () => {
    for (const seed of [1, 2]) {
      // Зерно 1 — огороды, 2 — река.
      const { game } = autoplay(seed, Infinity, DEFAULT_TUNING, 2);
      expect(game.map).toBe(mapFor(seed, 2));
      for (const p of game.players) expect(p.stacked + p.stolen).toBeGreaterThan(15);
    }
  });

  it('двое по разные стороны реки', () => {
    const g = createGame(3, DEFAULT_TUNING, 2, MAP_RIVER);
    const c = g.tuning.fieldSize / 2;
    const [a, b] = g.players;
    expect(Math.sign(a!.stackX - c)).not.toBe(Math.sign(b!.stackX - c));
    const g4 = createGame(3, DEFAULT_TUNING, 4, MAP_RIVER);
    for (const p of g4.players) expect(Math.abs(p.stackX - g4.tuning.fieldSize / 2)).toBeGreaterThan(6);
  });

  it('река: от одного игрока до другого дорога есть — через мост', () => {
    const g = createGame(3, DEFAULT_TUNING, 2, MAP_RIVER);
    const [a, b] = g.players;
    expect(reachable(g.nav, { x: a!.x, y: a!.y }, { x: b!.x, y: b!.y })).toBe(true);
  });
});
