// Все числа баланса в одном месте. Набор замораживается на старте забега:
// ползунки отладочной панели действуют только со следующего.
//
// Новое число обязательно добавить в tuningValues() — иначе оно не попадёт в хеш записи
// и забег с другим набором чисел не отличить.

export const TICK_RATE = 30; // шагов симуляции в секунду
export const DT = 1 / TICK_RATE;

export interface Tuning {
  // День
  dayLength: number; // секунд в одном дне

  // Поле
  fieldSize: number; // сторона квадратного поля, м
  pvpFieldScale: number; // во сколько раз поле для нескольких игроков больше «справедливого»
  tuftSpacing: number; // шаг сетки кустиков, м
  tuftJitter: number; // случайный сдвиг кустика от узла сетки, м
  coverage: number; // доля поля под травой, 0…1
  grassTypes: number; // сколько видов травы на поле: 1…3
  stackClearRadius: number; // голая площадка вокруг стога, м
  rockCount: number;

  // Герой
  heroRadius: number;
  runSpeed: number; // м/с по скошенному и по голой земле
  accel: number; // разгон, м/с²
  wadeFactor: number; // множитель скорости в стоячей траве
  wadeRadius: number; // трава ближе этого расстояния считается «под ногами», м

  // Коса
  swingPeriod: number; // секунд между взмахами
  reach: number; // радиус взмаха, м
  arcDeg: number; // полная дуга взмаха, градусы
  probeDeg: number; // половина узкого сектора «прямо по курсу», градусы
  stepFrac: number; // шаг косаря за один взмах в долях радиуса
  damage: number; // ударов снимает один взмах

  // Трава: по видам (луговая, пырей, осока)
  grassHp: [number, number, number];
  grassYield: [number, number, number]; // кг сена с кустика

  // Сено: лежит там, где скошено, сохнет на месте, сгребается граблями в тюк
  dryTime: number; // секунд на солнце, пока скошенное станет сухим
  rakeRadius: number; // грабли сгребают сухое сено ближе этого расстояния, м
  carryCap: number; // вместимость тюка, кг
  carrySlow: number; // какую долю скорости отнимает полный тюк
  stackReach: number; // ближе этого расстояния от центра стога тюк выгружается, м
  unloadRate: number; // кг в секунду при выгрузке
  yesterdayKg: number; // «вчерашний» сухой покос у стога с утра, кг

  // Инструменты
  swapTime: number; // секунд занимает смена косы на грабли и обратно
  scytheSpeed: number; // множитель скорости с косой в руках: с граблями косарь быстрее

  // PvP
  woundTime: number; // секунд держится рана от первого удара: второй удар за это время подрезает ноги
  graceTime: number; // секунд после первого удара раненого нельзя ударить снова — время убежать
  woundBoost: number; // множитель скорости раненого в эти секунды («рывок»)
  crawlTime: number; // секунд ползёт тот, кому подрезали ноги
  crawlFactor: number; // множитель скорости ползком
  shieldTime: number; // секунд неуязвимости после того, как встал
  stealRate: number; // кг в секунду из чужого стога
  dropRadius: number; // упавший тюк подбирается ближе этого расстояния, м
  hitHay: number; // сколько сена удар выбивает из тюка того, кто с граблями, кг
  armorMin: number; // если в тюке меньше — он не спасает, удар приходится по ногам, кг

  // Магазин в центре поля: сено → ружьё
  shopKgEach: number; // цена ружья на каждого игрока: вчетвером — вчетверо больше, кг
  // (ружьё получает тот, кто сдал в общий котёл больше всех)
  shopReach: number; // ближе этого к центру ларька тюк сдаётся в ларёк (надо остановиться у прилавка), м
  giveDwell: number; // сколько надо простоять, чтобы сено пошло в ларёк или будку, с (перехват пальца не в счёт)

  // Ружьё
  gunShells: number; // сколько патронов в ружье, когда оно выходит из ларька (двустволка заряжена)
  ammoPackKg: number; // цена пачки патронов в ларьке, кг сена
  ammoPack: number; // сколько патронов в пачке
  vestKg: number; // цена бронежилета в ларьке, кг сена
  vestHits: number; // сколько выстрелов держит бронежилет
  gunPeriod: number; // секунд между выстрелами (коса бьёт раз в секунду)
  gunArcDeg: number; // ширина конуса выстрела, градусы
  gunDogExtra: number; // на столько дальше косы ружьё достаёт собаку: косу она обходит, а ружья не боится, м
  gunKnockback: number; // на сколько метров отбрасывает подстреленного
  downTime: number; // секунд лежит подстреленный (подрезанный ползёт меньше)

  // Будка и собака
  kennelReach: number; // ближе этого к будке тюк сдаётся в будку (надо остановиться), м
  dogKg: number; // сколько сена сдать в будку, чтобы появилась собака, кг
  dogSpeed: number; // скорость собаки в погоне, м/с
  dogGuard: number; // чужой ближе этого к стогу — собака бросается на него, м
  dogNear: number; // и на того, кто подошёл ближе этого к ней самой, м
  dogLeash: number; // дальше этого от стога собака не гонится, м
  dogBitePeriod: number; // секунд между укусами
  dogCrawlTime: number; // секунд ползает собака, которой косой подрезали ноги

  // Перки
  perkMaxLevel: number;
  arcPerLevel: number; // градусов дуги за уровень
  reachPerLevel: number; // метров радиуса за уровень
  ratePerLevel: number; // на какую долю короче период взмаха за уровень
  carryPerLevel: number; // кг тюка за уровень
  rakePerLevel: number; // метров ширины граблей за уровень
  levelKg: number[]; // пороги выгруженного сена для новых перков, кг
}

export const DEFAULT_TUNING: Tuning = {
  dayLength: 180,

  fieldSize: 32,
  pvpFieldScale: 1.15,
  tuftSpacing: 0.4,
  tuftJitter: 0.15,
  coverage: 0.75,
  grassTypes: 1,
  stackClearRadius: 3,
  rockCount: 6,

  heroRadius: 0.35,
  runSpeed: 5,
  accel: 40,
  wadeFactor: 0.6,
  wadeRadius: 0.5,

  swingPeriod: 1.0,
  reach: 2.2,
  arcDeg: 110,
  probeDeg: 20,
  stepFrac: 0.55,
  damage: 1,

  grassHp: [1, 2, 3],
  grassYield: [0.11, 0.33, 0.594],

  dryTime: 18,
  rakeRadius: 1.0,
  carryCap: 16,
  carrySlow: 0.16,
  stackReach: 3.0,
  unloadRate: 40,
  yesterdayKg: 12,

  swapTime: 0.4,
  scytheSpeed: 0.9,

  woundTime: 8,
  graceTime: 1.5,
  woundBoost: 1.3,
  crawlTime: 4,
  crawlFactor: 0.35,
  shieldTime: 3,
  stealRate: 5,
  dropRadius: 1.2,
  hitHay: 8,
  armorMin: 1,

  shopKgEach: 15,
  shopReach: 2.8,
  giveDwell: 0.25,

  gunShells: 2,
  ammoPackKg: 10,
  ammoPack: 10,
  vestKg: 10,
  vestHits: 3,
  gunPeriod: 2,
  gunArcDeg: 60,
  gunDogExtra: 1,
  gunKnockback: 4,
  downTime: 6,

  kennelReach: 1.9,
  dogKg: 25,
  dogSpeed: 7,
  dogGuard: 4.5,
  dogNear: 3.5,
  dogLeash: 9,
  dogBitePeriod: 1.2,
  dogCrawlTime: 5,

  perkMaxLevel: 5,
  arcPerLevel: 25,
  reachPerLevel: 0.35,
  ratePerLevel: 0.12,
  carryPerLevel: 4,
  rakePerLevel: 0.3,
  levelKg: [8, 18, 30, 44, 60, 78, 98, 120],
};

/** Плоский список чисел набора в фиксированном порядке — для хеша и для записи забега. */
export function tuningValues(t: Tuning): number[] {
  return [
    t.dayLength,
    t.fieldSize,
    t.tuftSpacing,
    t.tuftJitter,
    t.coverage,
    t.grassTypes,
    t.stackClearRadius,
    t.rockCount,
    t.heroRadius,
    t.runSpeed,
    t.accel,
    t.wadeFactor,
    t.wadeRadius,
    t.swingPeriod,
    t.reach,
    t.arcDeg,
    t.probeDeg,
    t.stepFrac,
    t.damage,
    t.grassHp[0],
    t.grassHp[1],
    t.grassHp[2],
    t.grassYield[0],
    t.grassYield[1],
    t.grassYield[2],
    t.dryTime,
    t.rakeRadius,
    t.carryCap,
    t.carrySlow,
    t.stackReach,
    t.unloadRate,
    t.yesterdayKg,
    t.swapTime,
    t.crawlTime,
    t.crawlFactor,
    t.shieldTime,
    t.stealRate,
    t.dropRadius,
    t.scytheSpeed,
    t.hitHay,
    t.armorMin,
    t.woundTime,
    t.graceTime,
    t.woundBoost,
    t.pvpFieldScale,
    t.shopKgEach,
    t.shopReach,
    t.giveDwell,
    t.gunShells,
    t.ammoPackKg,
    t.ammoPack,
    t.vestKg,
    t.vestHits,
    t.gunPeriod,
    t.gunArcDeg,
    t.gunDogExtra,
    t.gunKnockback,
    t.downTime,
    t.kennelReach,
    t.dogKg,
    t.dogSpeed,
    t.dogGuard,
    t.dogNear,
    t.dogLeash,
    t.dogBitePeriod,
    t.dogCrawlTime,
    t.perkMaxLevel,
    t.arcPerLevel,
    t.reachPerLevel,
    t.ratePerLevel,
    t.carryPerLevel,
    t.rakePerLevel,
    t.levelKg.length,
    ...t.levelKg,
  ];
}

export function cloneTuning(t: Tuning): Tuning {
  return {
    ...t,
    grassHp: [t.grassHp[0], t.grassHp[1], t.grassHp[2]],
    grassYield: [t.grassYield[0], t.grassYield[1], t.grassYield[2]],
    levelKg: t.levelKg.slice(),
  };
}
