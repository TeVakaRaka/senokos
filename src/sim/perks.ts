// Перки: улучшения внутри забега. Опыт — сено, выгруженное в стог. На каждом пороге
// игра встаёт и предлагает 1 из 3 перков; выбор — отдельный ввод (CHOICE_BASE + номер карточки).

import { cosDeg } from './dmath.ts';
import type { Game } from './game.ts';
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

/** Числа, выведенные из набора баланса и уровней перков. */
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
  };
}

/** Сколько кг надо выгрузить в стог для перка номер level (с нуля). */
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

/** Набрал на перк — предложить выбор. Перки на максимуме не предлагаются. */
export function checkLevel(g: Game): void {
  while (g.offer === null && g.stacked >= levelThreshold(g.tuning, g.level)) {
    const offer = makeOffer(g);
    if (offer.length === 0) {
      g.level++; // всё уже на максимуме — порог засчитан без выбора
      continue;
    }
    g.offer = offer;
    g.leveled = true;
  }
}

function makeOffer(g: Game): number[] {
  const pool: number[] = [];
  for (let p = 0; p < PERK_COUNT; p++) {
    if (g.perks[p]! < g.tuning.perkMaxLevel) pool.push(p);
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
export function applyChoice(g: Game, index: number): boolean {
  const offer = g.offer;
  if (offer === null || index < 0 || index >= offer.length) return false;
  const perk = offer[index]!;
  g.perks[perk]!++;
  g.level++;
  g.offer = null;
  g.d = derive(g.tuning, g.perks);
  if (g.hero.swingCd > g.d.swingTicks) g.hero.swingCd = g.d.swingTicks;
  checkLevel(g); // если сена хватает и на следующий перк — сразу новое предложение
  return true;
}
