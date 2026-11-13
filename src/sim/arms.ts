// Ларёк в центре поля и ружьё.
//
// В ларёк все сдают сено в общий котёл; цена — столько-то килограммов на каждого игрока.
// Сдать можно, только остановившись у прилавка и чуть постояв: на ходу тюк в ларёк не уходит. Когда котёл
// полон, ружьё получает тот, кто сдал больше всех (при равенстве — кто раньше набрал своё).
// Оно одно на весь день.
//
// Ружьё стреляет само, вперёд по ходу, пока в руках коса: с граблями оно за спиной и молчит.
// Бьёт ближайшего перед стволом — соперника или чужую собаку (её — чуть дальше, чем достаёт
// коса: от косы собака уворачивается, от ружья нет); забор от выстрела закрывает.
// Подстреленный отлетает и долго лежит, чужая собака погибает. Кому подрезали ноги, тот
// роняет ружьё — подобрать его может любой.

import { holdsGun, knockDown, onFeet, scytheActive } from './combat.ts';
import { DIR_X, DIR_Y } from './dirs.ts';
import { DOG_RADIUS, killDog } from './dog.ts';
import type { Game, Player } from './game.ts';
import { DT } from './tuning.ts';
import { fenced } from './world.ts';

export interface Shop {
  x: number;
  y: number;
  kg: number; // сколько сена уже сдано
  given: number[]; // кто сколько сдал
  since: number[]; // номер последней досыпки игрока (0 — не сдавал): кто раньше набрал своё
  stamp: number; // сколько раз в ларёк досыпали
  sold: boolean; // ружьё уже вышло
}

export interface Gun {
  holder: number; // у кого ружьё; −1 — лежит на земле в (x, y)
  x: number;
  y: number;
  cd: number; // шагов до следующего выстрела
}

export interface ShotEvent {
  x: number; // откуда стрелял
  y: number;
  dir: number; // куда смотрел
  reach: number; // дальность выстрела, м
  victim: number; // кого подстрелил (номер игрока) или −1
  dog: number; // чью собаку застрелил или −1
  tx: number; // куда попал
  ty: number;
}

/** Кто сдал в ларёк больше всех (−1 — никто не сдавал). При равенстве — кто раньше набрал своё. */
export function shopLeader(shop: Shop): number {
  let best = -1;
  for (let k = 0; k < shop.given.length; k++) {
    const kg = shop.given[k]!;
    if (kg <= 0) continue;
    if (best < 0 || kg > shop.given[best]! || (kg === shop.given[best]! && shop.since[k]! < shop.since[best]!)) best = k;
  }
  return best;
}

/**
 * Сено в ларёк: игрок остановился у прилавка с тюком и постоял четверть секунды. На ходу
 * сено не уходит — иначе тюк пропадал бы у каждого, кто бежит через центр поля; не уходит
 * и за миг, пока палец перехватывает джойстик. Котёл полон — ружьё получает тот, кто сдал
 * больше всех, где бы он в этот миг ни был.
 */
export function giveShop(g: Game, p: Player): boolean {
  const shop = g.shop;
  if (!shop || shop.sold || p.load <= 0 || p.still < g.dwellTicks) return false;
  const t = g.tuning;
  const dx = p.x - shop.x;
  const dy = p.y - shop.y;
  if (dx * dx + dy * dy > t.shopReach * t.shopReach) return false;
  let kg = t.unloadRate * DT;
  if (kg > p.load) kg = p.load;
  const room = g.shopKg - shop.kg;
  if (kg > room) kg = room;
  p.load -= kg;
  if (p.load < 1e-9) p.load = 0;
  shop.kg += kg;
  shop.given[p.id] = shop.given[p.id]! + kg;
  shop.stamp++;
  shop.since[p.id] = shop.stamp;
  p.delivered += kg;
  p.shopKg = kg;
  if (shop.kg >= g.shopKg - 1e-9) {
    shop.kg = g.shopKg;
    shop.sold = true;
    const winner = g.players[shopLeader(shop)]!;
    g.gun = { holder: winner.id, x: winner.x, y: winner.y, cd: 0 };
    winner.gotGun = true;
  }
  return true;
}

/** Ружьё лежит на земле — кто прошёл рядом, тот и поднял. */
export function pickGun(g: Game, p: Player): void {
  const gun = g.gun;
  if (!gun || gun.holder >= 0 || !onFeet(p)) return;
  const r = g.tuning.dropRadius;
  const dx = gun.x - p.x;
  const dy = gun.y - p.y;
  if (dx * dx + dy * dy > r * r) return;
  gun.holder = p.id;
  p.gotGun = true;
}

/**
 * Выстрел, если ружьё готово, в руках коса и перед стволом кто-то есть. Бьёт ближайшего
 * в конусе: соперника или чужую собаку. Дальность — как у косы; сквозь забор не бьёт.
 */
export function shoot(g: Game, p: Player): void {
  const gun = g.gun;
  if (!gun || !holdsGun(g, p) || gun.cd > 0) return;
  // С граблями ружьё за спиной: стреляет только тот, у кого в руках коса (и кто не бежит
  // после раны и не меняет инструмент).
  if (!scytheActive(p)) return;
  const t = g.tuning;
  const reach = p.d.reach + t.heroRadius;
  const fx = DIR_X[p.dir]!;
  const fy = DIR_Y[p.dir]!;
  let victim = -1;
  let dogOwner = -1;
  let bestD2 = Infinity;

  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (q === p || q.shield > 0 || q.down > 0) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach || d2 >= bestD2) continue;
    const dist = Math.sqrt(d2);
    if (dist > 0.5 && dx * fx + dy * fy < g.gunCos * dist) continue;
    if (fenced(g, p.x, p.y, q.x, q.y)) continue;
    victim = k;
    bestD2 = d2;
  }
  // Собака держится от косы чуть дальше удара — а ружьё достаёт её и там: от косы она
  // уходит сама, от ружья нет.
  const dogReach = p.d.reach + DOG_RADIUS + t.gunDogExtra;
  for (let k = 0; k < g.dogs.length; k++) {
    const dog = g.dogs[k];
    if (!dog || dog.owner === p.id) continue;
    const dx = dog.x - p.x;
    const dy = dog.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > dogReach * dogReach || d2 >= bestD2) continue;
    const dist = Math.sqrt(d2);
    if (dist > 0.5 && dx * fx + dy * fy < g.gunCos * dist) continue;
    if (fenced(g, p.x, p.y, dog.x, dog.y)) continue;
    victim = -1;
    dogOwner = k;
    bestD2 = d2;
  }
  if (victim < 0 && dogOwner < 0) return;

  gun.cd = g.gunTicks;
  if (victim >= 0) {
    const q = g.players[victim]!;
    const dist = Math.sqrt(bestD2);
    const ux = dist > 1e-6 ? (q.x - p.x) / dist : fx;
    const uy = dist > 1e-6 ? (q.y - p.y) / dist : fy;
    p.shot = { x: p.x, y: p.y, dir: p.dir, reach, victim, dog: -1, tx: q.x, ty: q.y };
    knockDown(g, p, q, ux, uy);
  } else {
    const dog = g.dogs[dogOwner]!;
    p.shot = { x: p.x, y: p.y, dir: p.dir, reach, victim: -1, dog: dogOwner, tx: dog.x, ty: dog.y };
    killDog(g, p, dogOwner);
  }
}
