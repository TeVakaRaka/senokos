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

  h = mixNumber(h, g.players.length);
  for (let k = 0; k < g.players.length; k++) {
    const p = g.players[k]!;
    h = mixNumber(h, p.x);
    h = mixNumber(h, p.y);
    h = mixNumber(h, p.dir);
    h = mixNumber(h, p.speed);
    h = mixNumber(h, p.swingCd);
    h = mixNumber(h, p.load);
    h = mixNumber(h, p.tool);
    h = mixNumber(h, p.toolCd);
    h = mixNumber(h, p.crawl);
    h = mixNumber(h, p.shield);
    h = mixNumber(h, p.stacked);
    h = mixNumber(h, p.delivered);
    h = mixNumber(h, p.level);
    for (let i = 0; i < p.perks.length; i++) h = mixNumber(h, p.perks[i]!);
    if (p.offer) for (let i = 0; i < p.offer.length; i++) h = mixNumber(h, 100 + p.offer[i]!);
    h = mixNumber(h, p.swings);
    h = mixNumber(h, p.cutTufts);
    h = mixNumber(h, p.cutKg);
    h = mixNumber(h, p.hits);
    h = mixNumber(h, p.hurt);
    h = mixNumber(h, p.stolen);
    h = mixNumber(h, p.knocked);
    h = mixNumber(h, p.robbed);
  }

  h = mixNumber(h, g.nextDropId);
  h = mixNumber(h, g.drops.length);
  for (let k = 0; k < g.drops.length; k++) {
    const d = g.drops[k]!;
    h = mixNumber(h, d.id);
    h = mixNumber(h, d.x);
    h = mixNumber(h, d.y);
    h = mixNumber(h, d.kg);
  }

  const f = g.field;
  h = mixNumber(h, f.standing);
  for (let i = 0; i < f.count; i++) {
    h = mixByte(h, f.hp[i]!);
    // Лежащее сено и момент покоса — только у скошенных кустиков.
    if (f.hp[i] === 0) {
      h = mixNumber(h, f.hay[i]!);
      h = mixNumber(h, f.cutTick[i]!);
    }
  }
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
