// Бот. Играет по тем же правилам, что человек: отдаёт симуляции один байт ввода за шаг.
// Нужен для тестов, подбора баланса, показа игры без рук — и как соперник в PvP.
//
// Порядок решений: выбрать улучшение → (PvP) поднять ружьё, уйти из-под чужого ствола
// (если нет бронежилета) и от чужой собаки, раненым уйти от косы, с заряженным ружьём —
// охотиться (с косой в руках: с граблями оно не стреляет), гнать вора, добить раненого
// и нападать, когда выгодно → забрать упавший тюк → отвезти тюк (в стог; в ларёк — за ружьём,
// пока ещё можно стать тем, кто сдал больше всех, потом за патронами или бронежилетом;
// в будку — за собакой) → сходить за сеном в чужой стог → сгрести сухое сено → косить
// полосами. Нужный инструмент бот берёт в руки сам.

import { BONUS_MATCHES } from './bonus.ts';
import { dirFromVector } from './dirs.ts';
import { nearestStanding, nearestTuft, standingInRect } from './field.ts';
import { stackHead, stackKg } from './fire.ts';
import { allies, INPUT_SWAP, onFeet, TOOL_RAKE, TOOL_SCYTHE, type Dog, type Game, type Player } from './game.ts';
import { dryKg } from './hay.ts';
import { free, lineClear, waypoint } from './nav.ts';
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
const FLEE_RANGE = 7; // раненый бот уходит от косаря, пока тот ближе этого, м
const GUN_FETCH = 24; // за упавшим ружьём бот бежит с такого расстояния, м
const GUN_DANGER = 6; // ближе этого к чужому стволу бот не лезет, м
const GUN_HUNT = 14; // с ружьём бот выходит на охоту за соперником в таком радиусе, м
const DOG_SHARE = 40; // как часто, будучи при сене, несёт тюк в будку, пока нет собаки (%)
const TRAP_SHARE = 45; // как часто заходит к будке взвести капкан, пока его нет (%)
const BONUS_FETCH = 16; // за находкой бот сворачивает с такого расстояния, м

// Куда везти тюк. Решается один раз на тюк, чтобы бот не метался.
const DEST_NONE = 0;
const DEST_STACK = 1;
const DEST_SHOP = 2;
const DEST_KENNEL = 3;

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
  dest: number; // куда везёт нынешний тюк: DEST_*
  dogTrip: boolean; // идёт к будке за собакой (иначе — только взвести капкан)
  rushAt: number; // с какого шага дня бот сам начинает копить на ружьё
  seeksGun: boolean; // борется ли за ружьё вообще (выключают в замерах баланса)
  // Обход заборов и реки: куда идти сейчас, ради какой цели и когда пересчитать.
  wpx: number;
  wpy: number;
  wpGoal: number; // цель, ради которой посчитана точка (номер клетки 0,5 м); −1 — нет
  wpAge: number; // шагов до пересчёта
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
    dest: DEST_NONE,
    dogTrip: false,
    // Каждый бот в свой момент дня решает побороться за ружьё (а если соперник начал
    // раньше — отвечает сразу).
    rushAt: (15 + rng.int(50)) * TICK_RATE,
    seeksGun: true,
    wpx: 0,
    wpy: 0,
    wpGoal: -1,
    wpAge: 0,
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
  if (p.load <= 0) b.dest = DEST_NONE;

  // Соперник — ближайший из чужих (в командной игре свои не в счёт).
  let foe: Player | null = null;
  let foeDist = Infinity;
  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (allies(g, p, q)) continue;
    const d = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
    if (d < foeDist) {
      foe = q;
      foeDist = d;
    }
  }

  // Ноги подрезаны: ползти к своему стогу. Подстрелен — лежать.
  if (p.crawl > 0 || p.down > 0) {
    b.chase = 0;
    b.raiding = false;
    b.raking = false;
    return p.crawl > 0 && stackDist > 1.6 ? goTo(g, b, p, p.stackX, p.stackY) : idle(b);
  }

  // В капкане — стоять: дёргаться бесполезно.
  if (p.snare > 0) return idle(b);

  // Свой стог горит — бросить всё и бежать тушить (с граблями быстрее).
  if (stackHead(g, p).fire > 0) {
    b.chase = 0;
    b.raiding = false;
    b.raking = false;
    b.want = TOOL_RAKE;
    return stackDist > t.stackReach - 0.6 ? goTo(g, b, p, p.stackX, p.stackY) : idle(b);
  }

  // Ружьё и собаки. «Вооружён» — ружьё при нём и в нём есть патроны.
  const gun = g.gun;
  const armed = gun !== null && gun.holder === p.id && gun.ammo > 0;
  if (gun && gun.holder < 0) {
    // Ружьё лежит на земле — бежать подбирать.
    const gx = gun.x - p.x;
    const gy = gun.y - p.y;
    if (gx * gx + gy * gy < GUN_FETCH * GUN_FETCH) {
      b.raiding = false;
      b.raking = false;
      return goTo(g, b, p, gun.x, gun.y);
    }
  }
  const dog = huntingDog(g, p);
  if (dog) {
    const dx = dog.x - p.x;
    const dy = dog.y - p.y;
    b.raiding = false;
    b.raking = false;
    if (armed) {
      b.want = TOOL_SCYTHE; // ружьё стреляет только с косой в руках
      return go(b, dx, dy); // повернуться к собаке — выстрелит само
    }
    // Без ружья — уходить от её стога: дальше поводка она не гонится.
    const owner = g.players[dog.owner]!;
    b.want = TOOL_RAKE;
    return go(b, p.x - owner.stackX, p.y - owner.stackY);
  }
  if (gun && gun.holder >= 0 && !allies(g, p, g.players[gun.holder]!)) {
    // Чужой ствол рядом — уйти из-под него (с граблями быстрее). Пока у хозяина в руках
    // грабли, ружьё молчит — тогда он обычный соперник, и на него можно напасть.
    const h = g.players[gun.holder]!;
    const hx = h.x - p.x;
    const hy = h.y - p.y;
    // Без патронов ружьё тоже молчит; а в бронежилете выстрела можно не бояться.
    const loaded = (h.tool === TOOL_SCYTHE || h.d.combo) && gun.ammo > 0;
    if (loaded && p.armor === 0 && onFeet(h) && hx * hx + hy * hy < GUN_DANGER * GUN_DANGER) {
      b.chase = 0;
      b.raiding = false;
      b.raking = false;
      b.want = TOOL_RAKE;
      return go(b, -hx, -hy);
    }
  }

  if (foe) {
    const fx = foe.x - p.x;
    const fy = foe.y - p.y;
    const vulnerable = foe.shield === 0;
    // Соперник с граблями у моего стога — ворует.
    const tx = foe.x - p.stackX;
    const ty = foe.y - p.stackY;
    const thiefReach = t.stackReach + 0.5;
    const thief = p.stacked > 0 && foe.tool === TOOL_RAKE && tx * tx + ty * ty <= thiefReach * thiefReach;

    // Раненого можно добить вторым ударом, пока рана не зажила.
    const wounded = foe.wound > 0 && foe.crawl === 0;
    // Сам ранен, а соперник с косой рядом — уносить ноги (с граблями бежать быстрее).
    // Но если и он ранен и открыт для удара, выгоднее ударить первым.
    if (p.wound > 0 && foe.crawl === 0 && foe.tool === TOOL_SCYTHE && foeDist < FLEE_RANGE && !(wounded && vulnerable)) {
      b.chase = 0;
      b.raiding = false;
      b.raking = false;
      b.want = TOOL_RAKE;
      return go(b, -fx, -fy);
    }

    if (b.calm > 0) b.calm--;
    if (armed && b.chase === 0 && b.calm === 0 && vulnerable && onFeet(foe) && foeDist < GUN_HUNT) {
      // С ружьём — на охоту: подойти лицом к сопернику, ружьё выстрелит само.
      b.chase = HUNT_TICKS;
      b.calm = (10 + b.rng.int(8)) * TICK_RATE;
    }
    if (b.chase > 0) {
      b.chase--;
      // За раненым идём и пока он под передышкой: кончится — добьём.
      if ((!vulnerable && !wounded) || foeDist > 16) b.chase = 0;
    } else if (vulnerable || wounded) {
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
      } else if (wounded && light && foeDist < AGGRO_RANGE + 2) {
        b.chase = CHASE_TICKS; // добить раненого — не дожидаясь, пока пройдёт охота драться
      } else if (b.calm === 0 && light && loot && foeDist < HUNT_RANGE) {
        b.chase = HUNT_TICKS;
        b.calm = (28 + b.rng.int(14)) * TICK_RATE; // после погони долго занят делом
      } else if (b.calm === 0 && light && easy && foeDist < AGGRO_RANGE) {
        b.chase = CHASE_TICKS;
        b.calm = (28 + b.rng.int(14)) * TICK_RATE;
      }
    }
    if (b.chase > 0) {
      b.want = TOOL_SCYTHE; // бьёт коса, и ружьё стреляет только с ней
      b.raiding = false;
      // Целится чуть вперёд по ходу соперника.
      return goTo(g, b, p, foe.x + (foe.x - foe.px) * 9, foe.y + (foe.y - foe.py) * 9);
    }
  }

  const lateDay = timeLeft < stackDist / (t.runSpeed * 0.6) + 2;

  // В ларёк — сейчас, не дожидаясь полного тюка: если того, что уже в тюке, хватит досыпать
  // котёл и остаться первым (ружьё почти в руках) или купить пачку патронов либо бронежилет.
  if (p.load > 0 && b.dest !== DEST_SHOP && b.dest !== DEST_KENNEL && g.shop) {
    const enough = g.shop.sold || p.load >= g.shopKg - g.shop.kg - 1e-6;
    if (enough && shopUse(g, b, p)) b.dest = DEST_SHOP;
  }

  // Понёс тюк в ларёк или в будку — донести и сдать весь: там надо стоять на месте, а стоит
  // тюку стать неполным, как бот уходил за новым сеном, сдав один килограмм.
  if (p.load > 0 && (b.dest === DEST_SHOP || b.dest === DEST_KENNEL)) {
    b.raking = false;
    b.raiding = false;
    return deliver(g, b, p, lateDay);
  }

  // Со спичками — к чужому стогу, где есть чему гореть и нет живой собаки.
  if (p.matches && timeLeft > 12) {
    let target: Player | null = null;
    let most = 10;
    for (let k = 0; k < g.players.length; k++) {
      const q = g.players[k]!;
      if (allies(g, p, q) || stackHead(g, q).fire > 0) continue;
      const guard = g.dogs[q.id];
      if (guard && guard.crawl === 0) continue;
      const kg = stackKg(g, q);
      if (kg > most) {
        most = kg;
        target = q;
      }
    }
    if (target) {
      b.raking = false;
      b.raiding = false;
      b.want = TOOL_RAKE;
      return goTo(g, b, p, target.stackX, target.stackY);
    }
  }

  // Находка неподалёку — забрать (вторые спички ни к чему).
  if (g.bonuses.length > 0) {
    let best = -1;
    let bestD2 = BONUS_FETCH * BONUS_FETCH;
    for (let i = 0; i < g.bonuses.length; i++) {
      const item = g.bonuses[i]!;
      if (item.kind === BONUS_MATCHES && p.matches) continue;
      const dx = item.x - p.x;
      const dy = item.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best >= 0) return goTo(g, b, p, g.bonuses[best]!.x, g.bonuses[best]!.y);
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
    if (best >= 0) return goTo(g, b, p, g.drops[best]!.x, g.drops[best]!.y);
  }

  // Везти: тюк полон или день кончается, а в тюке что-то есть.
  if (full || (p.load > 0 && lateDay)) {
    b.raking = false;
    b.raiding = false;
    return deliver(g, b, p, lateDay);
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
        return goTo(g, b, p, foe.stackX, foe.stackY);
      }
    } else {
      if (b.raidIn > 0) b.raidIn--;
      // Стог под охраной живой собаки не трогает: с граблями в руках от неё не отбиться.
      const guard = g.dogs[foe.id];
      const guarded = !!guard && guard.crawl === 0;
      // Подстрелил хозяина, а его стог недалеко — самое время идти за его сеном: пока он
      // встанет, тюк будет полон. Ради этого и нужно ружьё.
      const helpless = armed && foe.down > 0;
      const rx = foe.stackX - p.x;
      const ry = foe.stackY - p.y;
      if (helpless && !guarded && rx * rx + ry * ry < 14 * 14 && foe.stacked >= 8 && p.load < cap * 0.6 && timeLeft > 12) {
        b.raiding = true;
      } else if (b.raidIn === 0 && ownerAway && !guarded && foe.stacked >= 14 && p.load < cap * 0.3 && timeLeft > 25) {
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
      return goTo(g, b, p, g.field.x[target]!, g.field.y[target]!);
    }
    b.raking = false;
  }

  // Сгребать больше нечего, а в тюке что-то есть — отвезти.
  if (p.load > 0) return deliver(g, b, p, lateDay);

  // Косить, если скошенное успеет высохнуть до конца дня.
  if (timeLeft > t.dryTime + 6 && g.field.standing > 0) {
    b.want = TOOL_SCYTHE;
    return mowLanes(g, b, p);
  }

  // Делать нечего: ждать у стога, пока досохнет.
  if (stackDist > t.stackReach) return goTo(g, b, p, p.stackX, p.stackY);
  return idle(b);
}

/** Отвезти тюк туда, куда решено: в стог, в магазин за ружьё или в будку за собакой. */
function deliver(g: Game, b: Bot, p: Player, late: boolean): number {
  const t = g.tuning;
  if (b.dest === DEST_NONE) b.dest = chooseDest(g, b, p);
  // Тюк решили везти в стог, пока он был мал или гонка за ружьё ещё не началась, — а теперь
  // есть смысл нести его в ларёк. (Пока тюк не начал выгружаться в стог.)
  const sx = p.stackX - p.x;
  const sy = p.stackY - p.y;
  const unloading = sx * sx + sy * sy <= t.stackReach * t.stackReach;
  if (b.dest === DEST_STACK && !late && !unloading && p.load >= 3 && shopUse(g, b, p)) b.dest = DEST_SHOP;
  // Пока шёл, ружьё могло выйти или достаться другому наверняка, а собака — завестись:
  // тогда — в стог.
  if (b.dest === DEST_SHOP && (late || !shopUse(g, b, p))) b.dest = DEST_STACK;
  // У будки делать больше нечего: капкан взведён, а за собакой не шёл (или она уже есть).
  if (b.dest === DEST_KENNEL && (late || !g.kennels[p.id] || (p.trap && (!b.dogTrip || g.dogs[p.id] !== null)))) {
    b.dest = DEST_STACK;
  }
  b.want = TOOL_RAKE; // с граблями трава на пути не заставляет идти шагом косаря
  let tx = p.stackX;
  let ty = p.stackY;
  let near = t.stackReach - 0.15;
  if (b.dest === DEST_SHOP) {
    tx = g.shop!.x;
    ty = g.shop!.y;
    near = t.shopReach - 0.25;
  } else if (b.dest === DEST_KENNEL) {
    tx = g.kennels[p.id]!.x;
    ty = g.kennels[p.id]!.y;
    near = t.kennelReach - 0.2;
  }
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (dx * dx + dy * dy <= near * near) return idle(b); // сдаёт
  return goTo(g, b, p, tx, ty);
}

function chooseDest(g: Game, b: Bot, p: Player): number {
  const t = g.tuning;
  const timeLeft = (g.dayTicks - g.tick) * DT;
  // Нести горсть сена через всё поле нет смысла: в будку — только солидный тюк.
  const solid = p.load >= p.d.carryCap * 0.5;
  const kennel = g.kennels[p.id];
  if (kennel && !g.dogs[p.id] && p.stacked >= 20 && timeLeft > 45) {
    const need = t.dogKg - kennel.kg;
    // Начатое — доделать: в будке уже есть сено, осталось добавить.
    if ((kennel.kg > 0 && p.load >= 3) || ((solid || p.load >= need - 1e-6) && b.rng.int(100) < DOG_SHARE)) {
      b.dogTrip = true;
      return DEST_KENNEL;
    }
  }
  // Капкан — дешёвая защита: взвести, когда в стогу уже есть что красть.
  if (kennel && !p.trap && p.stacked >= 10 && timeLeft > 40 && p.load >= t.trapKg && b.rng.int(100) < TRAP_SHARE) {
    b.dogTrip = false;
    return DEST_KENNEL;
  }
  if (p.load >= 3 && shopUse(g, b, p)) return DEST_SHOP;
  return DEST_STACK;
}

/**
 * Стоит ли нести сено в ларёк.
 *
 * Пока ружьё не вышло: его получит тот, кто сдал больше всех, поэтому если соперника уже
 * не обогнать — не нести (сено досталось бы его ружью); если впереди так, что уже не
 * догонят, — досыпать, чтобы ружьё вышло скорее; пока гонка открыта — вступать, когда пришло
 * время или когда соперник начал первым.
 *
 * Когда ружьё вышло: его хозяину — за патронами, когда они кончились; остальным — за
 * бронежилетом, если у соперника заряженное ружьё. И то и другое — только если сена
 * (с уже сданным в счёт покупки) на неё хватит.
 */
function shopUse(g: Game, b: Bot, p: Player): boolean {
  const shop = g.shop;
  if (!shop || !b.seeksGun) return false;
  const left = (g.dayTicks - g.tick) * DT;
  if (shop.sold) {
    const gun = g.gun;
    if (!gun || left < 30) return false;
    const t = g.tuning;
    if (gun.holder === p.id) return gun.ammo === 0 && p.load + shop.ammoKg[p.id]! >= t.ammoPackKg - 1e-6;
    if (gun.holder < 0 || allies(g, p, g.players[gun.holder]!)) return false; // ружьё ничьё или у своего
    return gun.ammo > 0 && p.armor === 0 && p.load + shop.vestKg[p.id]! >= t.vestKg - 1e-6;
  }
  // «Мы» — самый щедрый из своих (в команде ружьё напарника тоже наше), «они» — из чужих.
  let mine = 0;
  let best = 0;
  for (let k = 0; k < shop.given.length; k++) {
    const kg = shop.given[k]!;
    if (allies(g, p, g.players[k]!)) {
      if (kg > mine) mine = kg;
    } else if (kg > best) best = kg;
  }
  const room = g.shopKg - shop.kg;
  if (mine + room <= best) return false; // не обогнать: при равенстве впереди тот, кто раньше
  // Того, что в тюке, хватит досыпать котёл и остаться первым — ружьё выйдет сразу.
  if (p.load >= room - 1e-6) return left > 20;
  if (left < 40) return false; // под конец дня ружьё уже не окупится
  if (mine > best + room) return true; // впереди наверняка
  return g.tick >= b.rushAt || best > 0;
}

/** Чужая собака, которая сейчас гонится за этим игроком (и не ползает), или null. */
function huntingDog(g: Game, p: Player): Dog | null {
  for (let k = 0; k < g.dogs.length; k++) {
    const dog = g.dogs[k];
    if (dog && dog.owner !== p.id && dog.target === p.id && dog.crawl === 0) return dog;
  }
  return null;
}

function pickPerk(offer: readonly number[]): number {
  for (const want of PERK_PRIORITY) {
    const index = offer.indexOf(want);
    if (index >= 0) return index;
  }
  return 0;
}

/**
 * Идти к точке (x, y). На лугу — напрямую. Если на пути забор или вода — по обходному
 * пути (карта проходимости), к самой дальней точке пути, которую видно напрямую.
 */
function goTo(g: Game, b: Bot, p: Player, x: number, y: number): number {
  const nav = g.nav;
  if (g.walls.length === 0 || lineClear(nav, p.x, p.y, x, y, 2.2)) {
    b.wpGoal = -1;
    return go(b, x - p.x, y - p.y);
  }
  const goal = Math.floor(y / 0.5) * nav.cols + Math.floor(x / 0.5);
  const near = (b.wpx - p.x) * (b.wpx - p.x) + (b.wpy - p.y) * (b.wpy - p.y) < 0.36;
  if (goal !== b.wpGoal || b.wpAge <= 0 || near) {
    const spot = { x: 0, y: 0 };
    if (!waypoint(nav, p.x, p.y, x, y, spot)) return go(b, x - p.x, y - p.y);
    b.wpx = spot.x;
    b.wpy = spot.y;
    b.wpGoal = goal;
    b.wpAge = 12;
  }
  b.wpAge--;
  return go(b, b.wpx - p.x, b.wpy - p.y);
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
  let x0 = sign > 0 ? p.x + skip : 0;
  let x1 = sign > 0 ? g.field.size : p.x - skip;
  // Полоса кончается у забора или воды: дальше по прямой не пройти.
  if (g.walls.length > 0) {
    for (let x = p.x + sign * skip; x > 0 && x < g.field.size; x += sign * 0.5) {
      if (free(g.nav, x, b.laneY)) continue;
      if (sign > 0) x1 = x;
      else x0 = x;
      break;
    }
    if (x1 <= x0) return false;
  }
  return standingInRect(g.field, x0, x1, b.laneY - half, b.laneY + half);
}

/** Косит полосами туда-обратно: в конце полосы переходит на соседнюю и разворачивается. */
function mowLanes(g: Game, b: Bot, p: Player): number {
  const size = g.field.size;
  const spacing = p.d.reach * 0.9; // ширина сплошной сердцевины полосы
  // Полоса считается законченной, когда пуста её середина. Редкие кустики по краям
  // добьёт соседняя полоса; гоняться за ними на бегу — пустая трата дня.
  const half = spacing * 0.3;

  // Впереди по полосе забор или вода — дальше эту полосу не косить, как у края поля.
  if (g.walls.length > 0 && !free(g.nav, p.x + b.laneSign * 1.2, p.y)) b.think = 0;
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
