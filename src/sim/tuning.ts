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
  crawlTime: number; // секунд ползёт тот, кому подрезали ноги
  crawlFactor: number; // множитель скорости ползком
  shieldTime: number; // секунд неуязвимости после того, как встал
  stealRate: number; // кг в секунду из чужого стога
  dropRadius: number; // упавший тюк подбирается ближе этого расстояния, м
  hitHay: number; // сколько сена удар выбивает из тюка того, кто с граблями, кг
  armorMin: number; // если в тюке меньше — он не спасает, удар приходится по ногам, кг

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

  crawlTime: 4,
  crawlFactor: 0.35,
  shieldTime: 3,
  stealRate: 5,
  dropRadius: 1.2,
  hitHay: 8,
  armorMin: 1,

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
