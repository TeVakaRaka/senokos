// Ядро симуляции: состояние забега и один шаг step(game, inputs).
// Никакого браузера, никаких часов: одинаковые зерно и ввод дают одинаковое состояние
// на любом устройстве.
//
// В игре один или несколько косарей (Player). У каждого свой стог, свой тюк и свои
// улучшения; трава и лежащее сено — общие. В PvP коса бьёт соперника: первый удар ранит,
// второй подрезает ноги; у того, кто с граблями, удар сначала выбивает сено из тюка.
// Ещё в PvP есть ларёк в центре (сено → ружьё, arms.ts) и будки у стогов (сено → собака,
// dog.ts); забор закрывает от косы, выстрела и укуса (world.ts).

import { shoot, pickGun, type Gun, type Shop, type ShotEvent } from './arms.ts';
import { fleeing, hitLegs, knockHay, onFeet, rakeActive, scytheActive, TOOL_RAKE, TOOL_SCYTHE } from './combat.ts';
import { DIR_COUNT, DIR_X, DIR_Y } from './dirs.ts';
import { cosDeg } from './dmath.ts';
import { cutDog, DOG_RADIUS, stepDogs, type Dog, type Kennel } from './dog.ts';
import { cellCoord, standingWithin, type Field } from './field.ts';
import { fieldSizeFor, generateLevel, KENNEL_RADIUS, SHOP_RADIUS, STACK_RADIUS, type Point, type River, type Rock } from './gen.ts';
import { buildNav, type Nav, type Wall } from './nav.ts';
import { pickDrops, raid, rake, unload, type Drop } from './hay.ts';
import { applyChoice, checkLevel, CHOICE_BASE, derive, OFFER_SIZE, PERK_COUNT, type Derived } from './perks.ts';
import { Rng } from './rng.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE, type Tuning } from './tuning.ts';
import { collide, fenced, type Spot } from './world.ts';

export type { Derived } from './perks.ts';
export type { Gun, Shop, ShotEvent } from './arms.ts';
export type { Dog, Kennel } from './dog.ts';
export type { Bridge, River } from './gen.ts';
export type { Wall } from './nav.ts';
export { fleeing, onFeet, rakeActive, scytheActive, TOOL_RAKE, TOOL_SCYTHE } from './combat.ts';

const FLY_TICKS = 8; // сколько шагов летит подстреленный
const DOG_SHIELD_TICKS = 30; // столько шагов после того, как встала, собаку нельзя подрезать снова

/**
 * Ввод за шаг — один байт: 0 — палец не касается, 1…64 — направление (номер + 1),
 * 65…67 — выбор улучшения. Плюс 128, если на этом шаге нажата кнопка смены инструмента.
 */
export const INPUT_NONE = 0;
export const INPUT_SWAP = 128;

export interface SwingEvent {
  x: number;
  y: number;
  dir: number;
  reach: number;
  arcDeg: number;
  cut: number; // сколько кустиков срезано этим взмахом
  kg: number; // сколько сена срезано
  victim: number; // кого задел (номер игрока) или −1
  dog: number; // чьей собаке подрезал ноги или −1
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
  wound: number; // шагов, пока не зажила рана от первого удара (второй удар подрежет ноги)
  crawl: number; // шагов осталось ползти (ноги подрезаны)
  shield: number; // шагов, пока его нельзя ударить снова
  down: number; // шагов лежит после выстрела: не двигается и ничего не делает
  still: number; // сколько шагов подряд стоит на месте (сено в ларёк и будку сдаётся только стоя)
  armor: number; // сколько выстрелов ещё выдержит бронежилет (0 — его нет)
  fly: number; // шагов ещё летит, отброшенный выстрелом
  flyX: number; // смещение за шаг, пока летит
  flyY: number;

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
  shotHits: number; // скольких подстрелил
  shotDown: number; // сколько раз подстрелили его
  dogsKilled: number; // скольких собак застрелил
  dogCuts: number; // скольким собакам подрезал ноги
  dogBites: number; // сколько раз его собака укусила чужих

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
  woundedBy: number; // кто ранил его на этом шаге (первый удар); −1 — никто
  lostKg: number; // сколько сена выбили из его тюка на этом шаге
  lostBy: number; // кто выбил; −1 — никто
  shot: ShotEvent | null; // свой выстрел на этом шаге
  shotBy: number; // кто подстрелил его на этом шаге; −1 — никто
  bitBy: number; // чья собака укусила его на этом шаге; −1 — ничья
  shopKg: number; // сдал в магазин за шаг
  kennelKg: number; // сдал в будку за шаг
  gotGun: boolean; // на этом шаге получил ружьё (купил или подобрал)
  lostGun: boolean; // на этом шаге уронил ружьё
  dogBorn: boolean; // на этом шаге у него появилась собака
  dogDied: boolean; // на этом шаге его собаку застрелили
  dogHurt: boolean; // на этом шаге его собаке подрезали ноги
  ammoBought: number; // сколько патронов купил на этом шаге
  vestBought: boolean; // на этом шаге купил бронежилет
  armorHitBy: number; // чей выстрел на этом шаге принял его бронежилет; −1 — ничей
  dryFire: boolean; // на этом шаге щёлкнул пустым ружьём
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
  woundTicks: number; // сколько шагов держится рана от первого удара
  graceTicks: number; // сколько шагов после него раненого нельзя ударить снова
  crawlTicks: number; // сколько шагов ползёт подрезанный
  shieldTicks: number; // сколько шагов после этого он неуязвим
  shopKg: number; // сколько сена все вместе сдают в магазин, чтобы вышло ружьё, кг
  gunTicks: number; // сколько шагов между выстрелами
  gunCos: number; // косинус половины конуса выстрела
  flyTicks: number; // сколько шагов летит подстреленный
  downTicks: number; // сколько шагов он потом лежит
  dwellTicks: number; // сколько шагов надо простоять, чтобы сено пошло в ларёк или будку
  dogBiteTicks: number; // сколько шагов между укусами
  dogCrawlTicks: number; // сколько шагов ползает подрезанная собака
  dogShieldTicks: number; // сколько шагов после этого её нельзя подрезать
  over: boolean; // день окончен
  rng: Rng;

  field: Field;
  map: number; // вид поля: луг, огороды, река (MAP_* из gen.ts)
  rocks: Rock[];
  walls: Wall[]; // заборы и вода
  river: River | null; // река (для картинки)
  nav: Nav; // карта проходимости — для бота
  players: Player[];
  drops: Drop[]; // тюки, выроненные на землю
  nextDropId: number;
  shop: Shop | null; // магазин в центре поля (в игре на одного — нет)
  gun: Gun | null; // ружьё; null — ещё не вышло из магазина
  kennels: Kennel[]; // будка у стога каждого игрока (в игре на одного — нет)
  dogs: (Dog | null)[]; // собака каждого игрока; null — нет
  spentKg: number; // сено, ушедшее на покупки: собаки, патроны, бронежилеты

  // Общие буферы событий шага (у каждого игрока в них свой отрезок).
  cutIdx: Int32Array;
  cutCount: number;
  rakeIdx: Int32Array;
  rakeCount: number;
}

/**
 * Новый день. map — вид поля (MAP_* из gen.ts); если не задан, его выбирает зерно.
 */
export function createGame(seed: number, tuning: Tuning = DEFAULT_TUNING, playerCount = 1, map = -1): Game {
  const t = cloneTuning(tuning);
  // Чем больше игроков, тем больше поле: места и травы должно хватать всем.
  t.fieldSize = fieldSizeFor(t.fieldSize, playerCount, t.pvpFieldScale);
  const level = generateLevel(seed, t, playerCount, map);
  const discs = [
    ...level.stacks.map((s) => ({ x: s.x, y: s.y, r: STACK_RADIUS })),
    ...level.rocks,
    ...level.kennels.map((k) => ({ x: k.x, y: k.y, r: KENNEL_RADIUS })),
    ...(level.shop ? [{ x: level.shop.x, y: level.shop.y, r: SHOP_RADIUS }] : []),
  ];
  const g: Game = {
    seed,
    tuning: t,
    tick: 0,
    dayTicks: Math.max(1, Math.round(t.dayLength * TICK_RATE)),
    dryTicks: Math.max(1, Math.round(t.dryTime * TICK_RATE)),
    swapTicks: Math.max(0, Math.round(t.swapTime * TICK_RATE)),
    woundTicks: Math.max(0, Math.round(t.woundTime * TICK_RATE)),
    graceTicks: Math.max(0, Math.round(t.graceTime * TICK_RATE)),
    crawlTicks: Math.max(1, Math.round(t.crawlTime * TICK_RATE)),
    shieldTicks: Math.max(0, Math.round(t.shieldTime * TICK_RATE)),
    shopKg: t.shopKgEach * playerCount,
    gunTicks: Math.max(1, Math.round(t.gunPeriod * TICK_RATE)),
    gunCos: cosDeg(t.gunArcDeg / 2),
    flyTicks: FLY_TICKS,
    downTicks: Math.max(0, Math.round(t.downTime * TICK_RATE)),
    dwellTicks: Math.max(1, Math.round(t.giveDwell * TICK_RATE)),
    dogBiteTicks: Math.max(1, Math.round(t.dogBitePeriod * TICK_RATE)),
    dogCrawlTicks: Math.max(1, Math.round(t.dogCrawlTime * TICK_RATE)),
    dogShieldTicks: DOG_SHIELD_TICKS,
    over: false,
    rng: new Rng((seed ^ 0x51ed270b) >>> 0),
    field: level.field,
    map: level.map,
    rocks: level.rocks,
    walls: level.walls,
    river: level.river,
    // Карту проходимости строим, только если есть заборы или вода: на лугу бот ходит напрямую.
    nav: level.walls.length > 0 ? buildNav(t.fieldSize, discs, level.walls, t.heroRadius + 0.05) : buildNav(1, [], [], 0),
    players: [],
    drops: [],
    nextDropId: 1,
    shop: level.shop
      ? {
          x: level.shop.x,
          y: level.shop.y,
          kg: 0,
          given: new Array<number>(playerCount).fill(0),
          since: new Array<number>(playerCount).fill(0),
          stamp: 0,
          sold: false,
          ammoKg: new Array<number>(playerCount).fill(0),
          vestKg: new Array<number>(playerCount).fill(0),
        }
      : null,
    gun: null,
    kennels: level.kennels.map((k) => ({ x: k.x, y: k.y, kg: 0 })),
    dogs: level.kennels.map(() => null),
    spentKg: 0,
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
    wound: 0,
    crawl: 0,
    shield: 0,
    down: 0,
    still: 0,
    armor: 0,
    fly: 0,
    flyX: 0,
    flyY: 0,
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
    shotHits: 0,
    shotDown: 0,
    dogsKilled: 0,
    dogCuts: 0,
    dogBites: 0,
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
    woundedBy: -1,
    lostKg: 0,
    lostBy: -1,
    shot: null,
    shotBy: -1,
    bitBy: -1,
    shopKg: 0,
    kennelKg: 0,
    gotGun: false,
    lostGun: false,
    dogBorn: false,
    dogDied: false,
    dogHurt: false,
    ammoBought: 0,
    vestBought: false,
    armorHitBy: -1,
    dryFire: false,
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
    p.woundedBy = -1;
    p.lostKg = 0;
    p.lostBy = -1;
    p.shot = null;
    p.shotBy = -1;
    p.bitBy = -1;
    p.shopKg = 0;
    p.kennelKg = 0;
    p.gotGun = false;
    p.lostGun = false;
    p.dogBorn = false;
    p.dogDied = false;
    p.dogHurt = false;
    p.ammoBought = 0;
    p.vestBought = false;
    p.armorHitBy = -1;
    p.dryFire = false;
  }
  for (let i = 0; i < g.dogs.length; i++) {
    const dog = g.dogs[i];
    if (!dog) continue;
    dog.bit = -1;
    dog.hurtBy = -1;
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
    if (p.wound > 0) p.wound--;
    if (p.crawl > 0) p.crawl--;
    if (p.shield > 0) p.shield--;
    if (p.down > 0) p.down--;
    // Смена инструмента: пока меняет, не работает ни коса, ни грабли.
    if ((raw & INPUT_SWAP) !== 0 && p.toolCd === 0 && !p.d.combo) {
      p.tool = p.tool === TOOL_SCYTHE ? TOOL_RAKE : TOOL_SCYTHE;
      p.toolCd = g.swapTicks;
      p.swapped = true;
    }
  }
  if (g.gun && g.gun.cd > 0) g.gun.cd--;

  // В спорных случаях (два взмаха навстречу, одно сено на двоих) первым ходит то один,
  // то другой — через шаг. Так ни у кого нет вечного преимущества.
  const first = g.tick % n;

  // 2. Ружьё (стреляет само, когда перед стволом кто-то есть) и косы: бьют сами, как только
  // готовы и в секторе есть трава, соперник или чужая собака.
  if (g.gun && g.gun.holder >= 0) shoot(g, players[g.gun.holder]!);
  for (let k = 0; k < n; k++) scythe(g, players[(first + k) % n]!);

  // 3. Собаки сторожат стоги.
  stepDogs(g);

  // 4. Движение.
  for (let i = 0; i < n; i++) {
    const p = players[i]!;
    const input = inputOf(inputs, i) & 127;
    move(g, p, input >= 1 && input <= DIR_COUNT);
    // Сколько шагов подряд стоит (растёт до тысячи — дальше считать незачем).
    p.still = p.speed > 0 || p.fly > 0 ? 0 : p.still < 1000 ? p.still + 1 : p.still;
  }
  if (n > 1) separate(g);

  // 5. Упавшие тюки и ружьё (подбираются с любым инструментом), грабли: сухое сено с поля
  // и сено из чужого стога; тюк — в свой стог, в магазин или в будку.
  for (let k = 0; k < n; k++) {
    const p = players[(first + k) % n]!;
    if (onFeet(p)) {
      pickDrops(g, p);
      pickGun(g, p);
    }
    if (rakeActive(p)) {
      rake(g, p);
      if (n > 1) raid(g, p);
    }
    unload(g, p);
    if (p.unloadedKg > 0 || p.shopKg > 0 || p.kennelKg > 0) checkLevel(g, p);
  }

  // 6. Конец дня.
  if (g.tick >= g.dayTicks) g.over = true;
}

const spot: Spot = { x: 0, y: 0 };

/** Скорость и перемещение игрока на шаг: груз, брод, шаг косаря, ползком; края и препятствия. */
function move(g: Game, p: Player, moving: boolean): void {
  const t = g.tuning;
  // Отброшенный выстрелом летит, потом лежит — что бы ни нажимал.
  if (p.fly > 0) {
    // Летит быстро — двигаем мелкими шажками, чтобы не проскочить сквозь тонкий забор.
    const len = Math.sqrt(p.flyX * p.flyX + p.flyY * p.flyY);
    const parts = Math.max(1, Math.ceil(len / 0.2));
    spot.x = p.x;
    spot.y = p.y;
    for (let i = 0; i < parts; i++) {
      spot.x += p.flyX / parts;
      spot.y += p.flyY / parts;
      collide(g, spot, t.heroRadius);
    }
    p.x = spot.x;
    p.y = spot.y;
    p.fly--;
    p.speed = 0;
    return;
  }
  if (!moving || p.down > 0) {
    p.speed = 0;
    return;
  }

  // Скорость — наименьшая из бега (с поправкой на инструмент, груз и брод) и шага косаря.
  // С косой в руках косарь чуть медленнее, чем с граблями.
  let target = t.runSpeed * (1 - (t.carrySlow * p.load) / p.d.carryCap);
  if (p.tool === TOOL_SCYTHE && !p.d.combo) target *= t.scytheSpeed;
  // Первый удар только ранит: полторы секунды раненый бежит рывком — есть шанс уйти.
  if (fleeing(p)) target *= t.woundBoost;
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

  spot.x = p.x + DIR_X[p.dir]! * p.speed * DT;
  spot.y = p.y + DIR_Y[p.dir]! * p.speed * DT;
  collide(g, spot, t.heroRadius);
  p.x = spot.x;
  p.y = spot.y;
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
      if (fenced(g, p.x, p.y, q.x, q.y)) continue; // за забором не достать
      // Того, кто с граблями, прикрывает тюк: удар сначала выбивает из него сено.
      // С косой в руках (или с пустым тюком) удар приходится по ногам.
      const armored = (q.tool === TOOL_RAKE || q.d.combo) && q.load >= g.tuning.armorMin;
      if (armored) knockHay(g, p, q, dist);
      else hitLegs(g, p, q);
      if (victim < 0) victim = k;
    }
  }

  // Чужие собаки в секторе взмаха: подрезанная собака ползает и не кусает.
  let dogHit = -1;
  if (ready && g.dogs.length > 0) {
    const reach = d.reach + DOG_RADIUS;
    for (let k = 0; k < g.dogs.length; k++) {
      const dog = g.dogs[k];
      if (!dog || dog.owner === p.id || dog.crawl > 0 || dog.shield > 0) continue;
      const dx = dog.x - p.x;
      const dy = dog.y - p.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > reach * reach) continue;
      const dist = Math.sqrt(dist2);
      if (dist > 0.5 && dx * fx + dy * fy < d.arcCos * dist) continue;
      if (fenced(g, p.x, p.y, dog.x, dog.y)) continue;
      cutDog(g, p, dog);
      if (dogHit < 0) dogHit = k;
    }
  }

  if (ready && (hit > 0 || victim >= 0 || dogHit >= 0)) {
    p.swingCd = d.swingTicks;
    p.swings++;
    p.cutTufts += cut;
    p.cutKg += kg;
    p.swing = { x: p.x, y: p.y, dir: p.dir, reach: d.reach, arcDeg: d.arcDeg, cut, kg, victim, dog: dogHit };
  }
}
