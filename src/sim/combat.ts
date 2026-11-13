// Удары и их последствия: рана, подрезанные ноги, выбитое из тюка сено, выстрел, укус.
// Здесь же — что игрок может делать в своём состоянии (косить, грести, бить).

import type { Game, Player } from './game.ts';

/** Что у косаря в руках. Работает только это; оба сразу — после «синтеза» улучшений. */
export const TOOL_SCYTHE = 0;
export const TOOL_RAKE = 1;

/** Только что ранен: пока действует передышка, он бежит, а не косит и не бьёт. */
export function fleeing(p: Player): boolean {
  return p.wound > 0 && p.shield > 0 && p.crawl === 0;
}

/** На ногах: не ползёт и не лежит после выстрела. */
export function onFeet(p: Player): boolean {
  return p.crawl === 0 && p.down === 0;
}

/** Работает ли сейчас коса у игрока. */
export function scytheActive(p: Player): boolean {
  return onFeet(p) && p.toolCd === 0 && !fleeing(p) && (p.tool === TOOL_SCYTHE || p.d.combo);
}

/** Работают ли сейчас грабли у игрока. */
export function rakeActive(p: Player): boolean {
  return onFeet(p) && p.toolCd === 0 && (p.tool === TOOL_RAKE || p.d.combo);
}

/** Ружьё у этого игрока. */
export function holdsGun(g: Game, p: Player): boolean {
  return g.gun !== null && g.gun.holder === p.id;
}

/** Уронить тюк целиком на землю там, где стоит игрок. */
export function dropLoad(g: Game, q: Player): void {
  if (q.load <= 0) return;
  g.drops.push({ id: g.nextDropId++, x: q.x, y: q.y, kg: q.load });
  q.load = 0;
}

/** Уронить ружьё, если оно у игрока: ляжет там, где он стоит, подобрать может любой. */
export function dropGun(g: Game, q: Player): void {
  const gun = g.gun;
  if (!gun || gun.holder !== q.id) return;
  gun.holder = -1;
  gun.x = q.x;
  gun.y = q.y;
  q.lostGun = true;
}

/**
 * Рана: раненого какое-то время нельзя ударить снова, и он бежит рывком — может уйти.
 * Но пока рана не зажила, следующий удар подрежет ему ноги.
 */
function wound(g: Game, q: Player): void {
  q.wound = g.woundTicks;
  if (q.shield < g.graceTicks) q.shield = g.graceTicks;
  q.needAhead = 0;
}

/** Подрезанные ноги: какое-то время ползёт, роняет тюк и ружьё. */
function cripple(g: Game, q: Player): void {
  q.wound = 0;
  q.crawl = g.crawlTicks;
  q.shield = g.crawlTicks + g.shieldTicks;
  q.hurt++;
  q.speed = 0;
  q.needAhead = 0;
  dropLoad(g, q);
  dropGun(g, q);
}

/** Удар косой по ногам: первый ранит, второй — пока рана не зажила — подрезает. */
export function hitLegs(g: Game, attacker: Player, q: Player): void {
  if (q.wound > 0 || g.woundTicks === 0) {
    cripple(g, q);
    q.hitBy = attacker.id;
    attacker.hits++;
  } else {
    wound(g, q);
    q.woundedBy = attacker.id;
  }
}

/**
 * Укус собаки, которая стоит в (fromX, fromY). Собака вырывает тюк: он падает в её сторону,
 * в полутора метрах — укушенный не подхватит его на бегу. Первый укус ранит, второй
 * подрезает ноги.
 */
export function biteLegs(g: Game, owner: number, q: Player, fromX: number, fromY: number): void {
  if (q.load > 0) {
    const dx = fromX - q.x;
    const dy = fromY - q.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dist > 1e-6 ? dx / dist : 0;
    const uy = dist > 1e-6 ? dy / dist : 0;
    dropAt(g, q.x + ux * 1.6, q.y + uy * 1.6, q.load);
    q.load = 0;
  }
  if (q.wound > 0 || g.woundTicks === 0) cripple(g, q);
  else wound(g, q);
  q.bitBy = owner;
}

/**
 * Удар по тому, кого прикрывает тюк: часть сена вылетает из тюка и падает со стороны
 * ударившего (тот подберёт её на ходу, если в его тюке есть место). Сам соперник цел
 * и, полегчав, бежит быстрее.
 */
export function knockHay(g: Game, attacker: Player, q: Player, dist: number): void {
  const t = g.tuning;
  const kg = q.load < t.hitHay ? q.load : t.hitHay;
  q.load -= kg;
  if (q.load < 1e-9) q.load = 0;
  q.lostKg += kg;
  q.lostBy = attacker.id;
  attacker.knocked += kg;
  // Сено ложится в полутора метрах от хозяина в сторону ударившего (но не дальше него самого).
  const fly = dist < 1.6 ? dist : 1.6;
  const ux = dist > 1e-6 ? (attacker.x - q.x) / dist : 0;
  const uy = dist > 1e-6 ? (attacker.y - q.y) / dist : 0;
  dropAt(g, q.x + ux * fly, q.y + uy * fly, kg);
}

/** Положить сено на землю в точке (x, y), не дальше края поля. */
function dropAt(g: Game, x: number, y: number, kg: number): void {
  const hi = g.tuning.fieldSize - 0.4;
  const cx = x < 0.4 ? 0.4 : x > hi ? hi : x;
  const cy = y < 0.4 ? 0.4 : y > hi ? hi : y;
  g.drops.push({ id: g.nextDropId++, x: cx, y: cy, kg });
}

/**
 * Выстрел: подстреленный роняет тюк (и ружьё, если было), отлетает на несколько метров
 * в сторону выстрела и долго лежит. Тюк от выстрела не спасает. (ux, uy) — куда летит.
 */
export function knockDown(g: Game, shooter: Player, q: Player, ux: number, uy: number): void {
  dropLoad(g, q);
  dropGun(g, q);
  q.wound = 0;
  q.crawl = 0;
  q.fly = g.flyTicks;
  q.flyX = (ux * g.tuning.gunKnockback) / g.flyTicks;
  q.flyY = (uy * g.tuning.gunKnockback) / g.flyTicks;
  q.down = g.flyTicks + g.downTicks;
  q.shield = q.down + g.shieldTicks;
  q.speed = 0;
  q.needAhead = 0;
  q.shotBy = shooter.id;
  q.shotDown++;
  shooter.shotHits++;
}
