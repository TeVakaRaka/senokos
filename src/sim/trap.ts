// Капкан у стога. Покупается у своей будки за сено — раньше собаки, пока его нет. Срабатывает
// один раз, на первом же чужом, кто полезет в стог — красть или поджигать: тот застревает
// на несколько секунд. Стоит на месте, не косит, не гребёт и от ударов не закрыт.

import type { Kennel } from './dog.ts';
import type { Game, Player } from './game.ts';
import { DT } from './tuning.ts';

/** Сено в счёт капкана (у своей будки, стоя). Набралось — капкан взведён. */
export function buyTrap(g: Game, kennel: Kennel, p: Player): void {
  const t = g.tuning;
  let kg = t.unloadRate * DT;
  if (kg > p.load) kg = p.load;
  const room = t.trapKg - kennel.trapKg;
  if (kg > room) kg = room;
  p.load -= kg;
  if (p.load < 1e-9) p.load = 0;
  kennel.trapKg += kg;
  p.delivered += kg;
  p.kennelKg = kg;
  if (kennel.trapKg >= t.trapKg - 1e-9) {
    g.spentKg += kennel.trapKg;
    kennel.trapKg = 0;
    p.trap = true;
    p.trapSet = true;
  }
}

/** Капкан хозяина захлопнулся на том, кто полез в его стог. */
export function spring(g: Game, owner: Player, thief: Player): void {
  owner.trap = false;
  owner.caught = thief.id;
  thief.snare = g.snareTicks;
  thief.snaredBy = owner.id;
  thief.speed = 0;
}

/**
 * У стога игрока q (общего с его напарниками) взведён чей-то капкан? Возвращает хозяина
 * капкана или null. Напарники делят стог, поэтому капкан любого из них стережёт его весь.
 */
export function trapAt(g: Game, q: Player): Player | null {
  for (let k = 0; k < g.players.length; k++) {
    const m = g.players[k]!;
    if (m.trap && m.stackX === q.stackX && m.stackY === q.stackY) return m;
  }
  return null;
}
