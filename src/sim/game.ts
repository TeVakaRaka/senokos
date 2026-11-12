// Ядро симуляции: состояние забега и один шаг step(game, inputs).
// Никакого браузера, никаких часов: одинаковые зерно и ввод дают одинаковое состояние
// на любом устройстве.
//
// В игре один или несколько косарей (Player). У каждого свой стог, свой тюк и свои
// улучшения; трава и лежащее сено — общие. В PvP коса подрезает сопернику ноги,
// а у того, кто с граблями, сначала выбивает сено из тюка.

import { DIR_COUNT, DIR_X, DIR_Y } from './dirs.ts';
import { cellCoord, standingWithin, type Field } from './field.ts';
import { fieldSizeFor, generateLevel, STACK_RADIUS, type Point, type Rock } from './gen.ts';
import { pickDrops, raid, rake, unload, type Drop } from './hay.ts';
import { applyChoice, checkLevel, CHOICE_BASE, derive, OFFER_SIZE, PERK_COUNT, type Derived } from './perks.ts';
import { Rng } from './rng.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE, type Tuning } from './tuning.ts';

export type { Derived } from './perks.ts';

/**
 * Ввод за шаг — один байт: 0 — палец не касается, 1…64 — направление (номер + 1),
 * 65…67 — выбор улучшения. Плюс 128, если на этом шаге нажата кнопка смены инструмента.
 */
export const INPUT_NONE = 0;
export const INPUT_SWAP = 128;

/** Что у косаря в руках. Работает только это; оба сразу — после «синтеза» улучшений. */
export const TOOL_SCYTHE = 0;
export const TOOL_RAKE = 1;

export interface SwingEvent {
  x: number;
  y: number;
  dir: number;
  reach: number;
  arcDeg: number;
  cut: number; // сколько кустиков срезано этим взмахом
  kg: number; // сколько сена срезано
  victim: number; // кому подрезал ноги (номер игрока) или −1
}

export interface Player {
  id: number;

  // Косарь
  x: number;
  y: number;
  px: number; // позиция на прошлом шаге — картинка плавно ведёт героя между шагами
  py: number;
  dir: number; // куда смотрит: 0…63
  speed: number; // м/с
  swingCd: number; // шагов до следующего взмаха
  load: number; // кг в тюке
  tool: number; // что в руках: TOOL_SCYTHE или TOOL_RAKE
  toolCd: number; // шагов до конца смены инструмента (пока меняет — не работает ни один)
  crawl: number; // шагов осталось ползти (ноги подрезаны)
  shield: number; // шагов, пока его нельзя подрезать снова

  // Стог и улучшения
  stackX: number;
  stackY: number;
  stacked: number; // кг в своём стогу — это счёт
  delivered: number; // всего привезено за день — это опыт для улучшений
  level: number; // сколько порогов пройдено
  perks: number[]; // уровни улучшений
  offer: number[] | null; // предложенные улучшения, пока игрок выбирает
  d: Derived;

  // Статистика
  swings: number;
  cutTufts: number;
  cutKg: number;
  hits: number; // сколько раз подрезал соперника
  hurt: number; // сколько раз подрезали его
  stolen: number; // кг, унесённых из чужого стога
  knocked: number; // кг, выбитых косой из чужих тюков
  robbed: number; // кг, которые утащили из его стога

  // События последнего шага — по ним картинка и звук делают эффекты. В хеш не входят.
  swing: SwingEvent | null;
  cutFrom: number; // свои срезанные кустики: отрезок общего буфера cutIdx
  cutTo: number;
  rakeFrom: number; // свои начисто сгребённые кустики: отрезок общего буфера rakeIdx
  rakeTo: number;
  rakedKg: number; // сгреб в тюк за шаг
  pickedKg: number; // подобрал из упавших тюков за шаг
  stolenKg: number; // вытащил из чужого стога за шаг
  unloadedKg: number; // выгрузил в свой стог за шаг
  leveled: boolean; // на этом шаге появился выбор улучшения
  swapped: boolean; // на этом шаге сменил инструмент
  hitBy: number; // кто подрезал ему ноги на этом шаге; −1 — никто
  lostKg: number; // сколько сена выбили из его тюка на этом шаге
  lostBy: number; // кто выбил; −1 — никто
  /** Сколько ударов ещё требует трава прямо по курсу (0 — травы впереди нет). */
  needAhead: number;
}

export interface Game {
  seed: number;
  tuning: Tuning;
  tick: number; // шагов игрового времени (выбор улучшения время не двигает)
  dayTicks: number; // длина дня в шагах
  dryTicks: number; // сколько шагов сохнет скошенное
  swapTicks: number; // сколько шагов занимает смена инструмента
  crawlTicks: number; // сколько шагов ползёт подрезанный
  shieldTicks: number; // сколько шагов после этого он неуязвим
  over: boolean; // день окончен
  rng: Rng;

  field: Field;
  rocks: Rock[];
  players: Player[];
  drops: Drop[]; // тюки, выроненные на землю
  nextDropId: number;

  // Общие буферы событий шага (у каждого игрока в них свой отрезок).
  cutIdx: Int32Array;
  cutCount: number;
  rakeIdx: Int32Array;
  rakeCount: number;
}

export function createGame(seed: number, tuning: Tuning = DEFAULT_TUNING, playerCount = 1): Game {
  const t = cloneTuning(tuning);
  // Чем больше игроков, тем больше поле: места и травы должно хватать всем.
  t.fieldSize = fieldSizeFor(t.fieldSize, playerCount);
  const level = generateLevel(seed, t, playerCount);
  const g: Game = {
    seed,
    tuning: t,
    tick: 0,
    dayTicks: Math.max(1, Math.round(t.dayLength * TICK_RATE)),
    dryTicks: Math.max(1, Math.round(t.dryTime * TICK_RATE)),
    swapTicks: Math.max(0, Math.round(t.swapTime * TICK_RATE)),
    crawlTicks: Math.max(1, Math.round(t.crawlTime * TICK_RATE)),
    shieldTicks: Math.max(0, Math.round(t.shieldTime * TICK_RATE)),
    over: false,
    rng: new Rng((seed ^ 0x51ed270b) >>> 0),
    field: level.field,
    rocks: level.rocks,
    players: [],
    drops: [],
    nextDropId: 1,
    cutIdx: new Int32Array(4096),
    cutCount: 0,
    rakeIdx: new Int32Array(4096),
    rakeCount: 0,
  };
  for (let id = 0; id < level.starts.length; id++) {
    g.players.push(newPlayer(id, level.starts[id]!, level.stacks[id]!, t));
  }
  for (const p of g.players) placeYesterdayHay(g, p);
  return g;
}

function newPlayer(id: number, start: Point, stack: Point, t: Tuning): Player {
  const perks = new Array<number>(PERK_COUNT).fill(0);
  return {
    id,
    x: start.x,
    y: start.y,
    px: start.x,
    py: start.y,
    dir: 40, // лицом «вверх по экрану»
    speed: 0,
    swingCd: 0,
    load: 0,
    tool: TOOL_SCYTHE,
    toolCd: 0,
    crawl: 0,
    shield: 0,
    stackX: stack.x,
    stackY: stack.y,
    stacked: 0,
    delivered: 0,
    level: 0,
    perks,
    offer: null,
    d: derive(t, perks),
    swings: 0,
    cutTufts: 0,
    cutKg: 0,
    hits: 0,
    hurt: 0,
    stolen: 0,
    knocked: 0,
    robbed: 0,
    swing: null,
    cutFrom: 0,
    cutTo: 0,
    rakeFrom: 0,
    rakeTo: 0,
    rakedKg: 0,
    pickedKg: 0,
    stolenKg: 0,
    unloadedKg: 0,
    leveled: false,
    swapped: false,
    hitBy: -1,
    lostKg: 0,
    lostBy: -1,
    needAhead: 0,
  };
}

/**
 * «Вчерашний» покос: с утра рядом с игроком уже лежит сухое сено — ближайшие к нему
 * кустики скошены накануне. Первый тюк, первая выгрузка и первое улучшение — в первые секунды дня.
 */
function placeYesterdayHay(g: Game, p: Player): void {
  const t = g.tuning;
  const f = g.field;
  if (t.yesterdayKg <= 0 || f.count === 0) return;
  const dist2 = new Float64Array(f.count);
  const order: number[] = [];
  for (let i = 0; i < f.count; i++) {
    if (f.hp[i] === 0) continue; // уже отдан другому игроку
    const dx = f.x[i]! - p.x;
    const dy = f.y[i]! - p.y;
    dist2[i] = dx * dx + dy * dy;
    order.push(i);
  }
  // Строгий порядок: по расстоянию, при равенстве — по номеру. Одинаков в любом движке.
  order.sort((a, b) => (dist2[a]! < dist2[b]! ? -1 : dist2[a]! > dist2[b]! ? 1 : a - b));
  let kg = 0;
  for (let k = 0; k < order.length && kg < t.yesterdayKg; k++) {
    const i = order[k]!;
    const amount = t.grassYield[f.type[i]!]!;
    f.hp[i] = 0;
    f.hay[i] = amount;
    f.cutTick[i] = -g.dryTicks; // уже высохло
    f.standing--;
    kg += amount;
  }
}

function inputOf(inputs: number | readonly number[], id: number): number {
  if (typeof inputs === 'number') return id === 0 ? inputs : 0;
  const v = inputs[id];
  return v === undefined ? 0 : v;
}

/** Работает ли сейчас коса у игрока. */
export function scytheActive(p: Player): boolean {
  return p.crawl === 0 && p.toolCd === 0 && (p.tool === TOOL_SCYTHE || p.d.combo);
}

/** Работают ли сейчас грабли у игрока. */
export function rakeActive(p: Player): boolean {
  return p.crawl === 0 && p.toolCd === 0 && (p.tool === TOOL_RAKE || p.d.combo);
}

/**
 * Один шаг симуляции (1/30 секунды) или выбор улучшения.
 * inputs — по одному вводу на игрока; число означает ввод первого игрока (остальные стоят).
 */
export function step(g: Game, inputs: number | readonly number[]): void {
  const players = g.players;
  const n = players.length;

  // События прошлого шага больше не нужны.
  g.cutCount = 0;
  g.rakeCount = 0;
  for (let i = 0; i < n; i++) {
    const p = players[i]!;
    p.swing = null;
    p.cutFrom = 0;
    p.cutTo = 0;
    p.rakeFrom = 0;
    p.rakeTo = 0;
    p.rakedKg = 0;
    p.pickedKg = 0;
    p.stolenKg = 0;
    p.unloadedKg = 0;
    p.leveled = false;
    p.swapped = false;
    p.hitBy = -1;
    p.lostKg = 0;
    p.lostBy = -1;
  }

  if (g.over) return;

  // Пока хоть кто-то выбирает улучшение, время стоит; принимаются только выборы.
  let choosing = false;
  for (let i = 0; i < n; i++) {
    const p = players[i]!;
    if (p.offer === null) continue;
    choosing = true;
    const index = (inputOf(inputs, i) & 127) - CHOICE_BASE;
    if (index >= 0 && index < OFFER_SIZE) applyChoice(g, p, index);
  }
  if (choosing) return;

  g.tick++;

  // 1. Ввод и таймеры.
  for (let i = 0; i < n; i++) {
    const p = players[i]!;
    p.px = p.x;
    p.py = p.y;
    const raw = inputOf(inputs, i);
    const input = raw & 127;
    if (input >= 1 && input <= DIR_COUNT) p.dir = input - 1;
    if (p.swingCd > 0) p.swingCd--;
    if (p.toolCd > 0) p.toolCd--;
    if (p.crawl > 0) p.crawl--;
    if (p.shield > 0) p.shield--;
    // Смена инструмента: пока меняет, не работает ни коса, ни грабли.
    if ((raw & INPUT_SWAP) !== 0 && p.toolCd === 0 && !p.d.combo) {
      p.tool = p.tool === TOOL_SCYTHE ? TOOL_RAKE : TOOL_SCYTHE;
      p.toolCd = g.swapTicks;
      p.swapped = true;
    }
  }

  // В спорных случаях (два взмаха навстречу, одно сено на двоих) первым ходит то один,
  // то другой — через шаг. Так ни у кого нет вечного преимущества.
  const first = g.tick % n;

  // 2. Косы: бьют сами, как только готовы и в секторе есть трава или соперник.
  for (let k = 0; k < n; k++) scythe(g, players[(first + k) % n]!);

  // 3. Движение.
  for (let i = 0; i < n; i++) {
    const p = players[i]!;
    const input = inputOf(inputs, i) & 127;
    move(g, p, input >= 1 && input <= DIR_COUNT);
  }
  if (n > 1) separate(g);

  // 4. Упавшие тюки (подбираются с любым инструментом), грабли: сухое сено с поля и
  // сено из чужого стога; свой стог — выгрузка.
  for (let k = 0; k < n; k++) {
    const p = players[(first + k) % n]!;
    if (p.crawl === 0) pickDrops(g, p);
    if (rakeActive(p)) {
      rake(g, p);
      if (n > 1) raid(g, p);
    }
    unload(g, p);
    if (p.unloadedKg > 0) checkLevel(g, p);
  }

  // 5. Конец дня.
  if (g.tick >= g.dayTicks) g.over = true;
}

/** Скорость и перемещение игрока на шаг: груз, брод, шаг косаря, ползком; края и препятствия. */
function move(g: Game, p: Player, moving: boolean): void {
  if (!moving) {
    p.speed = 0;
    return;
  }
  const t = g.tuning;

  // Скорость — наименьшая из бега (с поправкой на инструмент, груз и брод) и шага косаря.
  // С косой в руках косарь чуть медленнее, чем с граблями.
  let target = t.runSpeed * (1 - (t.carrySlow * p.load) / p.d.carryCap);
  if (p.tool === TOOL_SCYTHE && !p.d.combo) target *= t.scytheSpeed;
  if (standingWithin(g.field, p.x, p.y, t.wadeRadius)) target *= t.wadeFactor;
  if (p.needAhead > 0) {
    const pace = p.d.mowSpeed / p.needAhead;
    if (pace < target) target = pace;
  }
  if (p.crawl > 0) target *= t.crawlFactor;

  if (target < p.speed) {
    const slowed = p.speed - t.accel * 2 * DT;
    p.speed = slowed < target ? target : slowed;
  } else {
    const sped = p.speed + t.accel * DT;
    p.speed = sped > target ? target : sped;
  }

  let nx = p.x + DIR_X[p.dir]! * p.speed * DT;
  let ny = p.y + DIR_Y[p.dir]! * p.speed * DT;

  const lo = t.heroRadius;
  const hi = t.fieldSize - t.heroRadius;
  if (nx < lo) nx = lo;
  else if (nx > hi) nx = hi;
  if (ny < lo) ny = lo;
  else if (ny > hi) ny = hi;

  // Стоги (все — и свой, и чужие) и камни.
  const stackKeep = STACK_RADIUS + t.heroRadius;
  for (let i = 0; i < g.players.length; i++) {
    const owner = g.players[i]!;
    const dx = nx - owner.stackX;
    const dy = ny - owner.stackY;
    const d2 = dx * dx + dy * dy;
    if (d2 < stackKeep * stackKeep) {
      const dist = Math.sqrt(d2);
      if (dist > 1e-6) {
        nx = owner.stackX + (dx / dist) * stackKeep;
        ny = owner.stackY + (dy / dist) * stackKeep;
      } else {
        nx = owner.stackX + stackKeep;
      }
    }
  }
  for (let i = 0; i < g.rocks.length; i++) {
    const rock = g.rocks[i]!;
    const keep = rock.r + t.heroRadius;
    const dx = nx - rock.x;
    const dy = ny - rock.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < keep * keep) {
      const dist = Math.sqrt(d2);
      if (dist > 1e-6) {
        nx = rock.x + (dx / dist) * keep;
        ny = rock.y + (dy / dist) * keep;
      } else {
        nx = rock.x + keep;
      }
    }
  }

  p.x = nx;
  p.y = ny;
}

/** Игроки не стоят друг в друге: каждого отодвигает на половину перекрытия. */
function separate(g: Game): void {
  const players = g.players;
  const keep = g.tuning.heroRadius * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= keep * keep) continue;
      const dist = Math.sqrt(d2);
      const push = (keep - dist) / 2;
      const ux = dist > 1e-6 ? dx / dist : 1;
      const uy = dist > 1e-6 ? dy / dist : 0;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;
    }
  }
}

/**
 * Коса игрока. Обходит кустики в радиусе: если коса готова и в секторе взмаха есть трава —
 * бьёт; срезанное остаётся лежать на месте и начинает сохнуть. Заодно считает, сколько
 * ударов ещё требует трава в узком секторе прямо по курсу: от этого зависит шаг косаря.
 * Соперник в секторе взмаха получает по ногам.
 *
 * Коса работает, только когда она в руках (или после «синтеза»), и не работает,
 * пока игрок меняет инструмент или ползёт.
 */
function scythe(g: Game, p: Player): void {
  p.needAhead = 0;
  if (!scytheActive(p)) return;

  const d = p.d;
  const f = g.field;
  const fx = DIR_X[p.dir]!;
  const fy = DIR_Y[p.dir]!;
  const ready = p.swingCd === 0;
  let cut = 0;
  let hit = 0;
  let need = 0;
  let kg = 0;
  p.cutFrom = g.cutCount;

  const c0 = cellCoord(f.cols, p.x - d.reach);
  const c1 = cellCoord(f.cols, p.x + d.reach);
  const r0 = cellCoord(f.cols, p.y - d.reach);
  const r1 = cellCoord(f.cols, p.y + d.reach);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const cell = cy * f.cols + cx;
      const end = f.cellStart[cell + 1]!;
      for (let k = f.cellStart[cell]!; k < end; k++) {
        const i = f.cellItems[k]!;
        let hp = f.hp[i]!;
        if (hp === 0) continue;
        const dx = f.x[i]! - p.x;
        const dy = f.y[i]! - p.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > d.reach2) continue;
        const dist = Math.sqrt(dist2);
        const dot = dx * fx + dy * fy;
        if (dot < d.arcCos * dist) continue; // вне сектора взмаха

        if (ready) {
          hit++;
          hp = hp > d.damage ? hp - d.damage : 0;
          f.hp[i] = hp;
          if (hp === 0) {
            const amount = g.tuning.grassYield[f.type[i]!]!;
            f.standing--;
            f.hay[i] = amount;
            f.cutTick[i] = g.tick;
            cut++;
            kg += amount;
            if (g.cutCount < g.cutIdx.length) g.cutIdx[g.cutCount++] = i;
          }
        }
        if (hp > 0 && dot >= d.probeCos * dist) {
          const hits = Math.ceil(hp / d.damage);
          if (hits > need) need = hits;
        }
      }
    }
  }
  p.cutTo = g.cutCount;
  p.needAhead = need;

  // Соперники в секторе взмаха: коса достаёт до края тела.
  let victim = -1;
  if (ready && g.players.length > 1) {
    const reach = d.reach + g.tuning.heroRadius;
    for (let k = 0; k < g.players.length; k++) {
      const q = g.players[k]!;
      if (q === p || q.shield > 0) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > reach * reach) continue;
      const dist = Math.sqrt(dist2);
      // Вплотную задевает в любую сторону; дальше — только в секторе взмаха.
      if (dist > 0.5 && dx * fx + dy * fy < d.arcCos * dist) continue;
      // Того, кто с граблями, прикрывает тюк: удар сначала выбивает из него сено.
      // С косой в руках (или с пустым тюком) удар приходится по ногам.
      const armored = (q.tool === TOOL_RAKE || q.d.combo) && q.load >= g.tuning.armorMin;
      if (armored) knockHay(g, p, q, dist);
      else cutLegs(g, p, q);
      if (victim < 0) victim = k;
    }
  }

  if (ready && (hit > 0 || victim >= 0)) {
    p.swingCd = d.swingTicks;
    p.swings++;
    p.cutTufts += cut;
    p.cutKg += kg;
    p.swing = { x: p.x, y: p.y, dir: p.dir, reach: d.reach, arcDeg: d.arcDeg, cut, kg, victim };
  }
}

/**
 * Удар по тому, кого прикрывает тюк: часть сена вылетает из тюка и падает со стороны
 * ударившего (тот подберёт её на ходу, если в его тюке есть место). Сам соперник цел
 * и, полегчав, бежит быстрее.
 */
function knockHay(g: Game, attacker: Player, q: Player, dist: number): void {
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
  g.drops.push({ id: g.nextDropId++, x: q.x + ux * fly, y: q.y + uy * fly, kg });
}

/** Подрезать ноги: соперник какое-то время ползёт и роняет свой тюк на землю. */
function cutLegs(g: Game, attacker: Player, q: Player): void {
  q.crawl = g.crawlTicks;
  q.shield = g.crawlTicks + g.shieldTicks;
  q.hitBy = attacker.id;
  q.hurt++;
  q.speed = 0;
  q.needAhead = 0;
  attacker.hits++;
  if (q.load > 0) {
    g.drops.push({ id: g.nextDropId++, x: q.x, y: q.y, kg: q.load });
    q.load = 0;
  }
}
