// Собака-сторож. Покупается в будке у своего стога за сено (сдать его можно, только
// остановившись у будки). Сидит у будки; когда чужой подходит к стогу или к ней самой,
// бросается на него и кусает: укушенный роняет тюк, первый укус ранит, второй подрезает
// ноги. Дальше поводка от стога не гонится, сквозь забор не кусает.
//
// Собака умная: к тому, у кого в руках коса (а ружьё стреляет только с косой), она не лезет
// в лоб — обходит по кругу, чуть дальше удара, и бросается со спины. Косой ей можно
// подрезать ноги — тогда она какое-то время ползает; ружьё её убивает.

import { biteLegs, onFeet, scytheActive } from './combat.ts';
import { DIR_X, DIR_Y } from './dirs.ts';
import type { Game, Player } from './game.ts';
import { KENNEL_RADIUS } from './gen.ts';
import { DT } from './tuning.ts';
import { collide, fenced, type Spot } from './world.ts';

export const DOG_RADIUS = 0.3;
const BITE_EXTRA = 0.35; // кусает, когда до края тела цели меньше этого, м
const BEHIND = 0.85; // заходит на столько метров за спину цели
const RETURN_SPEED = 3.5; // к будке возвращается не спеша, м/с
const CRAWL_SHARE = 0.25; // с подрезанными ногами ползёт во столько раз медленнее
const ORBIT_GAP = 0.45; // обходит по кругу на столько метров дальше удара цели
const ORBIT_SLACK = 0.2; // подпустив ближе круга на столько, уже не обходит, а отходит, м
const ORBIT_LEAD = 2.5; // по кругу целится на столько метров вперёд

/** Будка у стога игрока: копит сено, пока не наберётся на собаку. */
export interface Kennel {
  x: number;
  y: number;
  kg: number;
}

export interface Dog {
  owner: number;
  x: number;
  y: number;
  px: number; // позиция на прошлом шаге — для плавной картинки
  py: number;
  fx: number; // куда смотрит (единичный вектор)
  fy: number;
  speed: number; // м/с
  target: number; // за кем гонится (номер игрока) или −1
  biteCd: number; // шагов до следующего укуса
  crawl: number; // шагов ещё ползать с подрезанными ногами
  shield: number; // шагов, пока её нельзя подрезать снова

  // События последнего шага — для картинки и звука. В хеш не входят.
  bit: number; // кого укусила на этом шаге или −1
  hurtBy: number; // кто подрезал ей ноги на этом шаге или −1
}

const spot: Spot = { x: 0, y: 0 };

/** Где собака сидит, когда сторожить не от кого: у будки, со стороны стога. */
function postOf(g: Game, owner: number): Spot {
  const k = g.kennels[owner]!;
  const p = g.players[owner]!;
  const dx = p.stackX - k.x;
  const dy = p.stackY - k.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const off = KENNEL_RADIUS + DOG_RADIUS + 0.35;
  return len > 1e-6 ? { x: k.x + (dx / len) * off, y: k.y + (dy / len) * off } : { x: k.x + off, y: k.y };
}

/** Сено в будку: игрок остановился у своей будки с тюком и чуть постоял. Набралось — появляется собака. */
export function giveKennel(g: Game, p: Player): boolean {
  const kennel = g.kennels[p.id];
  if (!kennel || g.dogs[p.id] || p.load <= 0 || p.still < g.dwellTicks) return false;
  const t = g.tuning;
  const dx = p.x - kennel.x;
  const dy = p.y - kennel.y;
  if (dx * dx + dy * dy > t.kennelReach * t.kennelReach) return false;
  let kg = t.unloadRate * DT;
  if (kg > p.load) kg = p.load;
  const room = t.dogKg - kennel.kg;
  if (kg > room) kg = room;
  p.load -= kg;
  if (p.load < 1e-9) p.load = 0;
  kennel.kg += kg;
  p.delivered += kg;
  p.kennelKg = kg;
  if (kennel.kg >= t.dogKg - 1e-9) {
    g.spentKg += kennel.kg;
    kennel.kg = 0;
    spawnDog(g, p.id);
    p.dogBorn = true;
  }
  return true;
}

function spawnDog(g: Game, owner: number): void {
  const post = postOf(g, owner);
  const p = g.players[owner]!;
  const dx = p.stackX - post.x;
  const dy = p.stackY - post.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  g.dogs[owner] = {
    owner,
    x: post.x,
    y: post.y,
    px: post.x,
    py: post.y,
    fx: len > 1e-6 ? dx / len : 1,
    fy: len > 1e-6 ? dy / len : 0,
    speed: 0,
    target: -1,
    biteCd: 0,
    crawl: 0,
    shield: 0,
    bit: -1,
    hurtBy: -1,
  };
}

/** Коса подрезала собаке ноги: ползает и не кусает. */
export function cutDog(g: Game, attacker: Player, dog: Dog): void {
  dog.crawl = g.dogCrawlTicks;
  dog.shield = g.dogCrawlTicks + g.dogShieldTicks;
  dog.target = -1;
  dog.speed = 0;
  dog.hurtBy = attacker.id;
  attacker.dogCuts++;
  g.players[dog.owner]!.dogHurt = true;
}

/** Ружьё убило собаку. Хозяин может купить новую. */
export function killDog(g: Game, shooter: Player, owner: number): void {
  g.dogs[owner] = null;
  shooter.dogsKilled++;
  g.players[owner]!.dogDied = true;
}

/** Все собаки делают шаг: кто первый — чередуется, как у игроков. */
export function stepDogs(g: Game): void {
  const n = g.dogs.length;
  if (n === 0) return;
  const first = g.tick % n;
  for (let k = 0; k < n; k++) {
    const dog = g.dogs[(first + k) % n];
    if (dog) stepDog(g, dog);
  }
}

function stepDog(g: Game, dog: Dog): void {
  dog.px = dog.x;
  dog.py = dog.y;
  if (dog.biteCd > 0) dog.biteCd--;
  if (dog.crawl > 0) dog.crawl--;
  if (dog.shield > 0) dog.shield--;
  const t = g.tuning;
  const owner = g.players[dog.owner]!;

  if (dog.crawl > 0) {
    dog.target = -1;
    const post = postOf(g, dog.owner);
    goTo(g, dog, post.x, post.y, t.dogSpeed * CRAWL_SHARE);
    return;
  }

  // За кем гнаться: прежняя цель, пока она не ушла за поводок, иначе — чужой у стога
  // или тот, кто подошёл к ней самой.
  let q = dog.target >= 0 ? g.players[dog.target]! : null;
  if (q && !(onFeet(q) && near(q, owner.stackX, owner.stackY, t.dogLeash))) q = null;
  if (!q) q = intruder(g, dog, owner);
  dog.target = q ? q.id : -1;

  // Под косу не лезет, кто бы её ни держал: если стоит перед косарём ближе круга обхода —
  // отходит быстрее, чем тот идёт, забирая вбок, к его спине. Это важнее погони и дороги домой.
  const menace = threat(g, dog, owner);
  if (menace) {
    const mx = dog.x - menace.x;
    const my = dog.y - menace.y;
    const md = Math.sqrt(mx * mx + my * my);
    const ux = md > 1e-6 ? mx / md : 1;
    const uy = md > 1e-6 ? my / md : 0;
    const side = -uy * DIR_X[menace.dir]! + ux * DIR_Y[menace.dir]! <= 0 ? 1 : -1;
    goTo(g, dog, dog.x + (ux * 0.8 - uy * side * 0.6) * 3, dog.y + (uy * 0.8 + ux * side * 0.6) * 3, t.dogSpeed);
    return;
  }

  if (!q) {
    const post = postOf(g, dog.owner);
    goTo(g, dog, post.x, post.y, RETURN_SPEED);
    return;
  }

  const rx = dog.x - q.x;
  const ry = dog.y - q.y;
  const dist = Math.sqrt(rx * rx + ry * ry);
  const qfx = DIR_X[q.dir]!;
  const qfy = DIR_Y[q.dir]!;
  // Чем цель может ударить спереди: косой (и ружьём — оно стреляет только с косой в руках,
  // а его конус уже сектора взмаха).
  let danger = 2; // косинус границы опасного сектора; 2 — опасности нет
  if (scytheActive(q) || q.toolCd > 0) danger = q.d.arcCos - 0.2;
  const inFront = dist > 1e-6 && rx * qfx + ry * qfy > danger * dist;
  const reach = t.heroRadius + DOG_RADIUS + BITE_EXTRA;

  if (inFront) {
    // Перед косой в лоб не лезет: обходит по кругу, чуть дальше удара, к спине цели.
    const orbit = orbitOf(g, q);
    const ux = rx / dist;
    const uy = ry / dist;
    // Из двух сторон обхода — та, что ведёт к спине.
    const side = -uy * qfx + ux * qfy <= 0 ? 1 : -1;
    goTo(g, dog, q.x + ux * orbit - uy * side * ORBIT_LEAD, q.y + uy * orbit + ux * side * ORBIT_LEAD, t.dogSpeed);
    return;
  }

  if (dist <= reach) {
    // Рядом и не перед ударом — кусает, как только можно.
    dog.speed = 0;
    if (dist > 1e-6) {
      dog.fx = -rx / dist;
      dog.fy = -ry / dist;
    }
    // Сквозь забор не кусает: стоит и ждёт, пока цель выйдет.
    if (dog.biteCd === 0 && q.shield === 0 && !fenced(g, dog.x, dog.y, q.x, q.y)) {
      biteLegs(g, dog.owner, q, dog.x, dog.y);
      dog.biteCd = g.dogBiteTicks;
      dog.bit = q.id;
      owner.dogBites++;
      if (!onFeet(q)) dog.target = -1; // обезврежен — домой
    }
    return;
  }

  // Подбирается: к безоружному — прямо, к вооружённому — со спины.
  const tx = danger < 2 ? q.x - qfx * BEHIND : q.x;
  const ty = danger < 2 ? q.y - qfy * BEHIND : q.y;
  goTo(g, dog, tx, ty, t.dogSpeed);
}

/** На каком расстоянии от косаря собака обходит его по кругу: чуть дальше удара косы. */
function orbitOf(g: Game, q: Player): number {
  return q.d.reach + g.tuning.heroRadius + DOG_RADIUS + ORBIT_GAP;
}

/**
 * Чужой с косой (или берущий её в руки), перед которым собака оказалась ближе круга обхода:
 * ещё шаг — и он её достанет. Из нескольких — ближайший; при равенстве — с меньшим номером.
 */
function threat(g: Game, dog: Dog, owner: Player): Player | null {
  let best: Player | null = null;
  let bestD2 = 0;
  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (q === owner || !onFeet(q) || !(scytheActive(q) || q.toolCd > 0)) continue;
    const rx = dog.x - q.x;
    const ry = dog.y - q.y;
    const d2 = rx * rx + ry * ry;
    const keep = orbitOf(g, q) - ORBIT_SLACK;
    if (d2 >= keep * keep) continue;
    const dist = Math.sqrt(d2);
    // Сбоку и сзади коса не достаёт — оттуда собака и кусает.
    if (dist > 1e-6 && rx * DIR_X[q.dir]! + ry * DIR_Y[q.dir]! <= (q.d.arcCos - 0.2) * dist) continue;
    if (best === null || d2 < bestD2) {
      best = q;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * На кого броситься: чужой в сторожевом круге у стога или тот, кто подошёл к самой собаке
 * (иначе её, сидящую у будки, подрезали бы косой, не заходя в круг). Дальше поводка — никто.
 * Из нескольких — ближайший к собаке; при равенстве — тот, у кого номер меньше.
 */
function intruder(g: Game, dog: Dog, owner: Player): Player | null {
  const t = g.tuning;
  const guard2 = t.dogGuard * t.dogGuard;
  const near2 = t.dogNear * t.dogNear;
  const leash2 = t.dogLeash * t.dogLeash;
  let best: Player | null = null;
  let bestD2 = 0;
  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (q === owner || !onFeet(q)) continue;
    const sx = q.x - owner.stackX;
    const sy = q.y - owner.stackY;
    const s2 = sx * sx + sy * sy;
    if (s2 > leash2) continue;
    const dx = q.x - dog.x;
    const dy = q.y - dog.y;
    const d2 = dx * dx + dy * dy;
    if (s2 > guard2 && d2 > near2) continue;
    if (best === null || d2 < bestD2) {
      best = q;
      bestD2 = d2;
    }
  }
  return best;
}

function near(q: Player, x: number, y: number, r: number): boolean {
  const dx = q.x - x;
  const dy = q.y - y;
  return dx * dx + dy * dy <= r * r;
}

function goTo(g: Game, dog: Dog, tx: number, ty: number, speed: number): void {
  const dx = tx - dog.x;
  const dy = ty - dog.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) {
    dog.speed = 0;
    return;
  }
  const len = speed * DT < dist ? speed * DT : dist;
  spot.x = dog.x + (dx / dist) * len;
  spot.y = dog.y + (dy / dist) * len;
  collide(g, spot, DOG_RADIUS);
  dog.x = spot.x;
  dog.y = spot.y;
  dog.fx = dx / dist;
  dog.fy = dy / dist;
  dog.speed = len / DT;
}
