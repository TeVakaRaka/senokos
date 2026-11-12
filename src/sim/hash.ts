// Хеш состояния забега (FNV-1a, 32 бита). Два устройства с одинаковыми зерном и вводом
// обязаны получить одинаковый хеш — так сервер позже проверит честность результата.

import type { Game } from './game.ts';
import { tuningValues, type Tuning } from './tuning.ts';

const f64 = new Float64Array(1);
const bytes = new Uint8Array(f64.buffer);

function mixByte(h: number, b: number): number {
  return Math.imul(h ^ b, 0x01000193) >>> 0;
}

function mixNumber(h: number, v: number): number {
  // NaN в разных движках хранится разными битами, поэтому в состоянии его быть не должно.
  if (v !== v) throw new Error('NaN в состоянии симуляции');
  f64[0] = v;
  for (let i = 0; i < 8; i++) h = mixByte(h, bytes[i]!);
  return h;
}

export function hashGame(g: Game): number {
  let h = 0x811c9dc5;
  h = mixNumber(h, g.tick);
  h = mixNumber(h, g.over ? 1 : 0);
  h = mixNumber(h, g.rng.state);
  const hero = g.hero;
  h = mixNumber(h, hero.x);
  h = mixNumber(h, hero.y);
  h = mixNumber(h, hero.dir);
  h = mixNumber(h, hero.speed);
  h = mixNumber(h, hero.swingCd);
  h = mixNumber(h, hero.load);
  h = mixNumber(h, g.swings);
  h = mixNumber(h, g.cutTufts);
  h = mixNumber(h, g.cutKg);
  h = mixNumber(h, g.stacked);
  h = mixNumber(h, g.level);
  for (let i = 0; i < g.perks.length; i++) h = mixNumber(h, g.perks[i]!);
  if (g.offer) for (let i = 0; i < g.offer.length; i++) h = mixNumber(h, 100 + g.offer[i]!);
  h = mixNumber(h, g.nextPileId);
  h = mixNumber(h, g.piles.length);
  for (let i = 0; i < g.piles.length; i++) {
    const p = g.piles[i]!;
    h = mixNumber(h, p.id);
    h = mixNumber(h, p.x);
    h = mixNumber(h, p.y);
    h = mixNumber(h, p.mass);
    h = mixNumber(h, p.dry);
  }
  h = mixNumber(h, g.field.standing);
  const hp = g.field.hp;
  for (let i = 0; i < hp.length; i++) h = mixByte(h, hp[i]!);
  return h >>> 0;
}

export function hashTuning(t: Tuning): number {
  let h = 0x811c9dc5;
  const values = tuningValues(t);
  for (let i = 0; i < values.length; i++) h = mixNumber(h, values[i]!);
  return h >>> 0;
}

export function hex8(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
