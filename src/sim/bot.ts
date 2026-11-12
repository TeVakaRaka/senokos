// Бот. Играет по тем же правилам, что человек: отдаёт симуляции один байт ввода за шаг.
// Нужен для тестов, подбора баланса, показа игры без рук — и как соперник в PvP.
//
// Порядок решений: выбрать улучшение → (PvP) гнать вора и нападать, когда выгодно →
// забрать упавший тюк → отвезти полный тюк → (PvP) сходить за сеном в чужой стог →
// сгрести сухое сено → косить полосами. Нужный инструмент бот берёт в руки сам.

import { dirFromVector } from './dirs.ts';
import { nearestStanding, nearestTuft, standingInRect } from './field.ts';
import { INPUT_SWAP, TOOL_RAKE, TOOL_SCYTHE, type Game, type Player } from './game.ts';
import { dryKg } from './hay.ts';
import { CHOICE_BASE, PERK_ARC, PERK_CARRY, PERK_RAKE, PERK_RATE, PERK_REACH } from './perks.ts';
import { Rng } from './rng.ts';
import { DT, TICK_RATE } from './tuning.ts';

/** Каким улучшениям бот отдаёт предпочтение (по порядку). */
const PERK_PRIORITY = [PERK_CARRY, PERK_REACH, PERK_RATE, PERK_RAKE, PERK_ARC];

const AGGRO_RANGE = 6; // ближе этого бот может броситься на соперника, м
const CHASE_TICKS = 70; // сколько шагов длится обычная погоня
const HUNT_RANGE = 11; // с такого расстояния бот идёт отнимать почти полный тюк, м
const HUNT_TICKS = 150; // сколько шагов длится охота за тюком
const DEFEND_TICKS = 150; // сколько шагов гонит вора от своего стога
const YARD = 6; // сено с земли ближе этого к чужому стогу бот не трогает, м

export interface Bot {
  me: number; // за какого игрока играет
  rng: Rng;
  started: boolean;
  dir: number; // текущее направление 0…63 или −1
  want: number; // какой инструмент нужен для текущего дела
  raking: boolean; // сейчас сгребает сено, а не косит
  laneY: number; // линия текущей полосы
  laneSign: number; // +1 — идём вдоль +x, −1 — вдоль −x
  sweep: number; // +1 — следующие полосы в сторону +y, −1 — в сторону −y
  think: number; // шагов до следующей проверки полосы
  stuck: number; // шагов без движения
  escape: number; // шагов обхода препятствия
  chase: number; // шагов ещё гнаться за соперником
  calm: number; // шагов до следующей погони
  raiding: boolean; // идёт за сеном в чужой стог
  raidIn: number; // шагов до следующего набега
}

export function createBot(seed: number, me = 0): Bot {
  const rng = new Rng((seed ^ 0x2545f491 ^ Math.imul(me + 1, 0x9e3779b1)) >>> 0);
  return {
    me,
    rng,
    started: false,
    dir: -1,
    want: TOOL_SCYTHE,
    raking: false,
    laneY: 0,
    laneSign: 1,
    sweep: 1,
    think: 0,
    stuck: 0,
    escape: 0,
    chase: 0,
    calm: 15 * TICK_RATE, // в начале дня не нападает: дать сопернику освоиться
    raiding: false,
    raidIn: (40 + rng.int(25)) * TICK_RATE,
  };
}

/** Ввод бота на этот шаг: направление или выбор улучшения, плюс смена инструмента. */
export function botInput(g: Game, b: Bot): number {
  const p = g.players[b.me]!;
  if (p.offer !== null) return CHOICE_BASE + pickPerk(p.offer);
  if (g.over) return 0;

  if (!b.started) {
    b.started = true;
    b.laneY = p.y;
  }

  b.want = p.tool;
  const move = act(g, b, p);
  const swap = !p.d.combo && p.tool !== b.want && p.toolCd === 0;
  return move + (swap ? INPUT_SWAP : 0);
}

/** Решает, куда идти (возвращает ввод 0…64) и какой инструмент нужен (b.want). */
function act(g: Game, b: Bot, p: Player): number {
  // Застрял (упёрся в камень или стог) — несколько шагов идёт вбок.
  const moved = (p.x - p.px) * (p.x - p.px) + (p.y - p.py) * (p.y - p.py);
  if (b.dir >= 0 && moved < 1e-6) b.stuck++;
  else b.stuck = 0;
  if (b.stuck > 12) {
    b.stuck = 0;
    b.escape = 18;
    b.dir = (b.dir + 12 + b.rng.int(9)) % 64;
  }
  if (b.escape > 0) {
    b.escape--;
    return b.dir + 1;
  }

  const t = g.tuning;
  const cap = p.d.carryCap;
  const timeLeft = (g.dayTicks - g.tick) * DT;
  const sx = p.stackX - p.x;
  const sy = p.stackY - p.y;
  const stackDist = Math.sqrt(sx * sx + sy * sy);
  const full = p.load >= cap - 1e-9;
  const foe = g.players.length > 1 ? g.players[(b.me + 1) % g.players.length]! : null;

  // Ноги подрезаны: ползти к своему стогу.
  if (p.crawl > 0) {
    b.chase = 0;
    b.raiding = false;
    b.raking = false;
    return stackDist > 1.6 ? go(b, sx, sy) : idle(b);
  }

  let foeDist = Infinity;
  if (foe) {
    const fx = foe.x - p.x;
    const fy = foe.y - p.y;
    foeDist = Math.sqrt(fx * fx + fy * fy);
    const vulnerable = foe.shield === 0;
    // Соперник с граблями у моего стога — ворует.
    const tx = foe.x - p.stackX;
    const ty = foe.y - p.stackY;
    const thiefReach = t.stackReach + 0.5;
    const thief = p.stacked > 0 && foe.tool === TOOL_RAKE && tx * tx + ty * ty <= thiefReach * thiefReach;

    if (b.calm > 0) b.calm--;
    if (b.chase > 0) {
      b.chase--;
      if (!vulnerable || foeDist > 16) b.chase = 0;
    } else if (vulnerable) {
      // Нападать выгодно, когда соперник медленный или безоружный, а свой тюк не тянет назад.
      // С пустыми граблями соперник быстрее косаря с косой — за таким гнаться без толку,
      // если только он не стоит, не бредёт по траве или не оказался совсем рядом.
      const slow = foe.speed < t.runSpeed * 0.75;
      const easy = foe.load >= 3 || foe.needAhead > 0 || (foe.tool === TOOL_RAKE && (slow || foeDist < 3));
      // Соперник везёт почти полный тюк — есть что отнять, за таким можно и побегать.
      const loot = foe.load >= foe.d.carryCap * 0.6;
      const light = p.load < cap * 0.7;
      if (thief && foeDist < 20) {
        b.chase = DEFEND_TICKS;
      } else if (b.calm === 0 && light && loot && foeDist < HUNT_RANGE) {
        b.chase = HUNT_TICKS;
        b.calm = (28 + b.rng.int(14)) * TICK_RATE; // после погони долго занят делом
      } else if (b.calm === 0 && light && easy && foeDist < AGGRO_RANGE) {
        b.chase = CHASE_TICKS;
        b.calm = (28 + b.rng.int(14)) * TICK_RATE;
      }
    }
    if (b.chase > 0) {
      b.want = TOOL_SCYTHE;
      b.raiding = false;
      // Целится чуть вперёд по ходу соперника.
      return go(b, fx + (foe.x - foe.px) * 9, fy + (foe.y - foe.py) * 9);
    }
  }

  // Упавший тюк неподалёку — забрать.
  if (!full && g.drops.length > 0) {
    let best = -1;
    let bestD2 = 12 * 12;
    for (let i = 0; i < g.drops.length; i++) {
      const d = g.drops[i]!;
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best >= 0) return go(b, g.drops[best]!.x - p.x, g.drops[best]!.y - p.y);
  }

  // В стог: тюк полон или день кончается, а в тюке что-то есть.
  const lateDay = timeLeft < stackDist / (t.runSpeed * 0.6) + 2;
  if (full || (p.load > 0 && lateDay)) {
    b.raking = false;
    b.raiding = false;
    b.want = TOOL_RAKE; // с граблями трава на пути не заставляет идти шагом косаря
    if (stackDist <= t.stackReach - 0.15) return idle(b); // выгружается
    return go(b, sx, sy);
  }

  // Набег на чужой стог: время от времени, когда хозяин далеко, а там есть что брать.
  if (foe) {
    const hx = foe.x - foe.stackX;
    const hy = foe.y - foe.stackY;
    const ownerAway = hx * hx + hy * hy > 9 * 9;
    if (b.raiding) {
      const danger = foeDist < 4.5 && foe.shield === 0 && foe.tool === TOOL_SCYTHE && p.load > 0;
      if (foe.stacked < 1 || timeLeft < 12 || danger) {
        b.raiding = false;
      } else {
        b.want = TOOL_RAKE;
        const rx = foe.stackX - p.x;
        const ry = foe.stackY - p.y;
        const near = t.stackReach - 0.4;
        if (rx * rx + ry * ry <= near * near) return idle(b); // тянет сено
        return go(b, rx, ry);
      }
    } else {
      if (b.raidIn > 0) b.raidIn--;
      if (b.raidIn === 0 && ownerAway && foe.stacked >= 14 && p.load < cap * 0.3 && timeLeft > 25) {
        b.raiding = true;
        b.raidIn = (45 + b.rng.int(25)) * TICK_RATE;
      }
    }
  }

  // Грести: когда сухого сена набралось больше чем на полтюка (или сколько в тюк ещё
  // влезет), а под вечер — пока оно вообще есть.
  const dry = foe ? dryOutsideYard(g, foe) : dryKg(g);
  const worth = Math.min(cap - p.load, cap * 0.6);
  if (b.raking) {
    if (dry <= 1e-9) b.raking = false;
  } else if (dry >= worth || (dry > 0 && timeLeft < t.dryTime + 8)) {
    b.raking = true;
  }
  if (b.raking) {
    const target = nearestDry(g, p, foe);
    if (target >= 0) {
      b.want = TOOL_RAKE;
      return go(b, g.field.x[target]! - p.x, g.field.y[target]! - p.y);
    }
    b.raking = false;
  }

  // Сгребать больше нечего, а в тюке что-то есть — отвезти.
  if (p.load > 0) {
    b.want = TOOL_RAKE;
    if (stackDist <= t.stackReach - 0.15) return idle(b);
    return go(b, sx, sy);
  }

  // Косить, если скошенное успеет высохнуть до конца дня.
  if (timeLeft > t.dryTime + 6 && g.field.standing > 0) {
    b.want = TOOL_SCYTHE;
    return mowLanes(g, b, p);
  }

  // Делать нечего: ждать у стога, пока досохнет.
  if (stackDist > t.stackReach) return go(b, sx, sy);
  return idle(b);
}

function pickPerk(offer: readonly number[]): number {
  for (const want of PERK_PRIORITY) {
    const index = offer.indexOf(want);
    if (index >= 0) return index;
  }
  return 0;
}

function go(b: Bot, dx: number, dy: number): number {
  b.dir = dirFromVector(dx, dy);
  return b.dir + 1;
}

function idle(b: Bot): number {
  b.dir = -1;
  return 0;
}

/**
 * Лежит ли кустик i «во дворе» соперника — рядом с его стогом. Сено оттуда бот с земли
 * не подбирает: иначе он в первые же секунды уносил бы у новичка вчерашний покос.
 * В сам стог за сеном он при этом ходит — это отдельный набег.
 */
function inYard(g: Game, foe: Player, i: number): boolean {
  const dx = g.field.x[i]! - foe.stackX;
  const dy = g.field.y[i]! - foe.stackY;
  return dx * dx + dy * dy < YARD * YARD;
}

/** Сколько на поле сухого сена, не считая лежащего во дворе соперника. */
function dryOutsideYard(g: Game, foe: Player): number {
  const f = g.field;
  let kg = 0;
  for (let i = 0; i < f.count; i++) {
    if (f.hay[i]! > 0 && g.tick - f.cutTick[i]! >= g.dryTicks && !inYard(g, foe, i)) kg += f.hay[i]!;
  }
  return kg;
}

/** Индекс ближайшего к игроку кустика с сухим сеном (не во дворе соперника) или −1. */
function nearestDry(g: Game, p: Player, foe: Player | null): number {
  const f = g.field;
  return nearestTuft(
    f,
    p.x,
    p.y,
    Infinity,
    (i) => f.hay[i]! > 0 && g.tick - f.cutTick[i]! >= g.dryTicks && (foe === null || !inYard(g, foe, i)),
  );
}

/**
 * Есть ли трава в полосе по ходу от игрока до края поля.
 * Кустики вплотную к нему не считаются: коса бьёт сектором вперёд и до них,
 * идя прямо, не дотянется — иначе бот вечно толкался бы в край поля.
 */
function grassAlongLane(g: Game, b: Bot, p: Player, sign: number, half: number): boolean {
  const skip = 0.8;
  const x0 = sign > 0 ? p.x + skip : 0;
  const x1 = sign > 0 ? g.field.size : p.x - skip;
  return standingInRect(g.field, x0, x1, b.laneY - half, b.laneY + half);
}

/** Косит полосами туда-обратно: в конце полосы переходит на соседнюю и разворачивается. */
function mowLanes(g: Game, b: Bot, p: Player): number {
  const size = g.field.size;
  const spacing = p.d.reach * 0.9; // ширина сплошной сердцевины полосы
  // Полоса считается законченной, когда пуста её середина. Редкие кустики по краям
  // добьёт соседняя полоса; гоняться за ними на бегу — пустая трата дня.
  const half = spacing * 0.3;

  if (b.think > 0) {
    b.think--;
  } else {
    b.think = 5;
    let tries = 0;
    while (!grassAlongLane(g, b, p, b.laneSign, half) && tries < 64) {
      tries++;
      if (grassAlongLane(g, b, p, -b.laneSign, half)) {
        b.laneSign = -b.laneSign;
        break;
      }
      let next = b.laneY + b.sweep * spacing;
      if (next < half || next > size - half) {
        b.sweep = -b.sweep;
        next = b.laneY + b.sweep * spacing;
      }
      b.laneY = next;
      b.laneSign = -b.laneSign;
    }
    if (tries >= 64) {
      // Полосами ничего не нашлось (остались редкие кустики) — идём к ближайшему.
      const target = nearestStanding(g.field, p.x, p.y);
      if (target < 0) return idle(b);
      b.laneY = g.field.y[target]!;
      b.laneSign = g.field.x[target]! >= p.x ? 1 : -1;
    }
  }

  // Держит линию полосы: целится в точку впереди на этой линии.
  b.dir = dirFromVector(b.laneSign * 2.5, b.laneY - p.y);
  return b.dir + 1;
}
