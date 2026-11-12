// Общие помощники тестов.

import { INPUT_SWAP, step, TOOL_RAKE, TOOL_SCYTHE, type Game, type Player } from '../src/sim/game.ts';
import { dropsKg, groundKg } from '../src/sim/hay.ts';
import { cloneTuning, DEFAULT_TUNING, type Tuning } from '../src/sim/tuning.ts';

export const EAST = 1; // ввод «направление 0»: вдоль +x
export const NORTH = 17; // направление 16: вдоль +y
export const WEST = 33; // направление 32: вдоль −x

/** Сплошное большое поле без камней, голых пятен и вчерашнего покоса. */
export function solid(patch: Partial<Tuning> = {}): Tuning {
  return { ...cloneTuning(DEFAULT_TUNING), fieldSize: 64, coverage: 1.5, rockCount: 0, yesterdayKg: 0, ...patch };
}

/** Голое поле: ни травы, ни камней. Удобно проверять движение и PvP без косьбы. */
export function bare(patch: Partial<Tuning> = {}): Tuning {
  return solid({ coverage: 0, ...patch });
}

export function me(g: Game): Player {
  return g.players[0]!;
}

/** Шаги с вводом первого игрока (остальные стоят). */
export function run(g: Game, input: number | readonly number[], ticks: number): void {
  for (let i = 0; i < ticks; i++) step(g, input);
}

export function place(p: Player, x: number, y: number): void {
  p.x = x;
  p.y = y;
  p.px = x;
  p.py = y;
}

/** Увести игрока из зоны выгрузки у своего стога (он стартует прямо в ней). */
export function farFromStack(p: Player): void {
  place(p, p.stackX + 9, p.stackY);
}

/** Взять в руки нужный инструмент и дождаться конца смены. */
export function useTool(g: Game, tool: number, id = 0): void {
  const p = g.players[id]!;
  if (p.tool === tool) return;
  const inputs = g.players.map((_, i) => (i === id ? INPUT_SWAP : 0));
  step(g, inputs);
  for (let i = 0; i < g.swapTicks; i++) step(g, 0);
}

export function useRake(g: Game, id = 0): void {
  useTool(g, TOOL_RAKE, id);
}

export function useScythe(g: Game, id = 0): void {
  useTool(g, TOOL_SCYTHE, id);
}

/** Положить на кустик сухое сено, будто его скосили давно. */
export function layDryHay(g: Game, i: number, kg: number): void {
  const f = g.field;
  if (f.hp[i] !== 0) f.standing--;
  f.hp[i] = 0;
  f.hay[i] = kg;
  f.cutTick[i] = g.tick - g.dryTicks;
}

/** Кустик на расстоянии от min до max от точки. */
export function tuftAtDistance(g: Game, x: number, y: number, min: number, max: number): number {
  const f = g.field;
  for (let i = 0; i < f.count; i++) {
    const d = Math.hypot(f.x[i]! - x, f.y[i]! - y);
    if (d >= min && d <= max) return i;
  }
  throw new Error('нет кустика на нужном расстоянии');
}

/** Всё сено в игре: на земле, в упавших тюках, в тюках игроков и в стогах. */
export function totalKg(g: Game): number {
  let kg = groundKg(g) + dropsKg(g);
  for (const p of g.players) kg += p.load + p.stacked;
  return kg;
}
