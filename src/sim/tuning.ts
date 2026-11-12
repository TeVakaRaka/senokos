// Все числа баланса в одном месте. Набор замораживается на старте забега:
// ползунки отладочной панели действуют только со следующего.

export const TICK_RATE = 30; // шагов симуляции в секунду
export const DT = 1 / TICK_RATE;

export interface Tuning {
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
}

export const DEFAULT_TUNING: Tuning = {
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
  grassYield: [0.09, 0.27, 0.486],
};

/** Плоский список чисел набора в фиксированном порядке — для хеша и для записи забега. */
export function tuningValues(t: Tuning): number[] {
  return [
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
  ];
}

export function cloneTuning(t: Tuning): Tuning {
  return {
    ...t,
    grassHp: [t.grassHp[0], t.grassHp[1], t.grassHp[2]],
    grassYield: [t.grassYield[0], t.grassYield[1], t.grassYield[2]],
  };
}
