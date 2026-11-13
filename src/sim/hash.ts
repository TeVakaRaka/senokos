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
    h = mixNumber(h, p.wound);
    h = mixNumber(h, p.crawl);
    h = mixNumber(h, p.down);
    h = mixNumber(h, p.still);
    h = mixNumber(h, p.armor);
    h = mixNumber(h, p.trap ? 1 : 0);
    h = mixNumber(h, p.snare);
    h = mixNumber(h, p.sharp);
    h = mixNumber(h, p.boots);
    h = mixNumber(h, p.matches ? 1 : 0);
    h = mixNumber(h, p.fire);
    h = mixNumber(h, p.burnt);
    h = mixNumber(h, p.fly);
    h = mixNumber(h, p.flyX);
    h = mixNumber(h, p.flyY);
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
    h = mixNumber(h, p.shotHits);
    h = mixNumber(h, p.shotDown);
    h = mixNumber(h, p.dogsKilled);
    h = mixNumber(h, p.dogCuts);
    h = mixNumber(h, p.dogBites);
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

  // Магазин, ружьё, будки, собаки.
  if (g.shop) {
    h = mixNumber(h, g.shop.kg);
    h = mixNumber(h, g.shop.sold ? 1 : 0);
    h = mixNumber(h, g.shop.stamp);
    for (let k = 0; k < g.shop.given.length; k++) {
      h = mixNumber(h, g.shop.given[k]!);
      h = mixNumber(h, g.shop.since[k]!);
      h = mixNumber(h, g.shop.ammoKg[k]!);
      h = mixNumber(h, g.shop.vestKg[k]!);
    }
  }
  if (g.gun) {
    h = mixNumber(h, 1000 + g.gun.holder);
    h = mixNumber(h, g.gun.x);
    h = mixNumber(h, g.gun.y);
    h = mixNumber(h, g.gun.cd);
    h = mixNumber(h, g.gun.ammo);
  }
  h = mixNumber(h, g.spentKg);
  for (let k = 0; k < g.kennels.length; k++) {
    h = mixNumber(h, g.kennels[k]!.kg);
    h = mixNumber(h, g.kennels[k]!.trapKg);
  }
  h = mixNumber(h, g.burntKg);
  h = mixNumber(h, g.bonusNext);
  for (let k = 0; k < g.bonuses.length; k++) {
    const b = g.bonuses[k]!;
    h = mixNumber(h, b.id);
    h = mixNumber(h, b.kind);
    h = mixNumber(h, b.x);
    h = mixNumber(h, b.y);
  }
  for (let k = 0; k < g.dogs.length; k++) {
    const dog = g.dogs[k];
    if (!dog) {
      h = mixNumber(h, -1);
      continue;
    }
    h = mixNumber(h, dog.x);
    h = mixNumber(h, dog.y);
    h = mixNumber(h, dog.fx);
    h = mixNumber(h, dog.fy);
    h = mixNumber(h, dog.speed);
    h = mixNumber(h, dog.target);
    h = mixNumber(h, dog.biteCd);
    h = mixNumber(h, dog.crawl);
    h = mixNumber(h, dog.shield);
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
