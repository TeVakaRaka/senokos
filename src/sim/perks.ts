// Улучшения внутри забега. Опыт — сено, привезённое в свой стог. На каждом пороге игра
// встаёт и предлагает 1 из 3 улучшений; выбор — отдельный ввод (CHOICE_BASE + номер карточки).

import { cosDeg } from './dmath.ts';
import type { Game, Player } from './game.ts';
import { DT, TICK_RATE, type Tuning } from './tuning.ts';

export const PERK_ARC = 0; // шире дуга
export const PERK_REACH = 1; // длиннее коса
export const PERK_RATE = 2; // чаще взмах
export const PERK_CARRY = 3; // больше тюк
export const PERK_RAKE = 4; // шире грабли
export const PERK_COUNT = 5;

/** Ввод 65, 66, 67 — выбор первой, второй или третьей карточки. */
export const CHOICE_BASE = 65;
export const OFFER_SIZE = 3;

/** Числа, выведенные из набора баланса и уровней улучшений. */
export interface Derived {
  reach: number;
  reach2: number;
  arcDeg: number;
  arcCos: number; // косинус половины дуги взмаха
  probeCos: number; // косинус половины узкого сектора «прямо по курсу»
  swingTicks: number;
  damage: number;
  mowSpeed: number; // шаг косаря, м/с
  carryCap: number; // вместимость тюка, кг
  rakeRadius: number; // ширина граблей, м
  /** «Синтез»: коса и грабли на максимуме работают вместе, менять инструмент не нужно. */
  combo: boolean;
}

export function derive(t: Tuning, perks: readonly number[]): Derived {
  const reach = t.reach + perks[PERK_REACH]! * t.reachPerLevel;
  const arcDeg = Math.min(360, t.arcDeg + perks[PERK_ARC]! * t.arcPerLevel);
  // Степень — через умножение: Math.pow в разных движках даёт разные последние знаки.
  let period = t.swingPeriod;
  for (let i = 0; i < perks[PERK_RATE]!; i++) period *= 1 - t.ratePerLevel;
  const swingTicks = Math.max(1, Math.round(period * TICK_RATE));
  return {
    reach,
    reach2: reach * reach,
    arcDeg,
    arcCos: cosDeg(arcDeg / 2),
    probeCos: cosDeg(t.probeDeg),
    swingTicks,
    damage: Math.max(1, Math.round(t.damage)),
    mowSpeed: (t.stepFrac * reach) / (swingTicks * DT),
    carryCap: t.carryCap + perks[PERK_CARRY]! * t.carryPerLevel,
    rakeRadius: t.rakeRadius + perks[PERK_RAKE]! * t.rakePerLevel,
    combo: perks[PERK_REACH]! >= t.perkMaxLevel && perks[PERK_RAKE]! >= t.perkMaxLevel,
  };
}

/** Сколько кг надо привезти в стог для улучшения номер level (с нуля). */
export function levelThreshold(t: Tuning, level: number): number {
  const list = t.levelKg;
  if (level < list.length) return list[level]!;
  // После списка пороги растут с шагом, который каждый раз прибавляет по 4 кг.
  let last = list[list.length - 1]!;
  let gap = list.length >= 2 ? last - list[list.length - 2]! : 20;
  for (let i = list.length; i <= level; i++) {
    gap += 4;
    last += gap;
  }
  return last;
}

/** Набрал на улучшение — предложить выбор. Улучшения на максимуме не предлагаются. */
export function checkLevel(g: Game, p: Player): void {
  while (p.offer === null && p.delivered >= levelThreshold(g.tuning, p.level)) {
    const offer = makeOffer(g, p);
    if (offer.length === 0) {
      p.level++; // всё уже на максимуме — порог засчитан без выбора
      continue;
    }
    p.offer = offer;
    p.leveled = true;
  }
}

function makeOffer(g: Game, p: Player): number[] {
  const pool: number[] = [];
  for (let k = 0; k < PERK_COUNT; k++) {
    if (p.perks[k]! < g.tuning.perkMaxLevel) pool.push(k);
  }
  // Частичная перетасовка Фишера — Йетса генератором забега.
  const take = Math.min(OFFER_SIZE, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + g.rng.int(pool.length - i);
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, take);
}

/** Применить выбор карточки index из текущего предложения. Возвращает false, если выбора нет. */
export function applyChoice(g: Game, p: Player, index: number): boolean {
  const offer = p.offer;
  if (offer === null || index < 0 || index >= offer.length) return false;
  const perk = offer[index]!;
  p.perks[perk]!++;
  p.level++;
  p.offer = null;
  p.d = derive(g.tuning, p.perks);
  if (p.swingCd > p.d.swingTicks) p.swingCd = p.d.swingTicks;
  if (p.d.combo) p.toolCd = 0;
  checkLevel(g, p); // если сена хватает и на следующее улучшение — сразу новое предложение
  return true;
}
