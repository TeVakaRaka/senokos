// Варианты внешнего вида: палитра, форма травинок, свет. На правила игры не влияют —
// число и места кустиков задаёт симуляция. Выбор: ?look=a | b | c.

export interface Look {
  id: string;
  title: string;

  // Форма кустика
  blades: number; // травинок в кустике при полном качестве
  bladeHeight: [number, number]; // м
  bladeWidth: [number, number]; // половина ширины у земли, м
  bladeLean: [number, number]; // насколько кончик отклонён наружу, м

  // Цвета травы
  grassBase: number;
  grassTipA: number;
  grassTipB: number;
  stubble: number;

  // Цвета земли
  groundBare: number; // голая земля
  groundUnder: number; // под стоячей травой
  groundMown: number; // скошенное
  groundOutside: number; // за полем

  // Скошенная трава на земле: только срезана → сохнет → высохла (можно грести)
  hayWet: number;
  hayDrying: number;
  hayReady: number;

  // Свет
  sky: number;
  skyGround: number;
  skyIntensity: number;
  sun: number;
  sunIntensity: number;
}

/** Сочный зелёный луг в разгар лета. */
const JULY: Look = {
  id: 'a',
  title: 'Июль',
  blades: 6,
  bladeHeight: [0.48, 0.74],
  bladeWidth: [0.05, 0.085],
  bladeLean: [0.1, 0.28],
  grassBase: 0x3a6620,
  grassTipA: 0x7fb638,
  grassTipB: 0xa8c847,
  stubble: 0xc4c268,
  groundBare: 0xa59c66,
  groundUnder: 0x4a7729,
  groundMown: 0xa6bd5a,
  groundOutside: 0x3d632c,
  hayWet: 0x6fae35,
  hayDrying: 0xc6cc68,
  hayReady: 0xf2bc36,
  sky: 0xe8f3ff,
  skyGround: 0x6b7a3c,
  skyIntensity: 2.2,
  sun: 0xfff0cf,
  sunIntensity: 2.6,
};

/** Высокая, уже желтеющая трава и тёплый свет. */
const AUGUST: Look = {
  id: 'b',
  title: 'Август',
  blades: 6,
  bladeHeight: [0.62, 0.98],
  bladeWidth: [0.038, 0.066],
  bladeLean: [0.14, 0.34],
  grassBase: 0x4d6a1f,
  grassTipA: 0xa3b93b,
  grassTipB: 0xd6c452,
  stubble: 0xdccb78,
  groundBare: 0xb39c63,
  groundUnder: 0x617d2b,
  groundMown: 0xc6c065,
  groundOutside: 0x4a632a,
  hayWet: 0x86ad38,
  hayDrying: 0xd6d27a,
  hayReady: 0xffa424,
  sky: 0xfff1de,
  skyGround: 0x7d7a3c,
  skyIntensity: 2.1,
  sun: 0xffdca6,
  sunIntensity: 3.0,
};

/** Крупные широкие листья и яркие плоские цвета — как в мобильных казуальных играх. */
const TOY: Look = {
  id: 'c',
  title: 'Игрушка',
  blades: 4,
  bladeHeight: [0.42, 0.62],
  bladeWidth: [0.095, 0.135],
  bladeLean: [0.05, 0.16],
  grassBase: 0x2f7d32,
  grassTipA: 0x6fcf45,
  grassTipB: 0x9ee05c,
  stubble: 0xe8da7a,
  groundBare: 0xcbb97c,
  groundUnder: 0x3f8f3a,
  groundMown: 0xbcd96c,
  groundOutside: 0x2f6b3a,
  hayWet: 0x55bf3c,
  hayDrying: 0xcfdc6e,
  hayReady: 0xffbd24,
  sky: 0xf2fbff,
  skyGround: 0x6f8f4a,
  skyIntensity: 2.4,
  sun: 0xfff6dd,
  sunIntensity: 2.4,
};

export const LOOKS: Look[] = [JULY, AUGUST, TOY];

export function lookById(id: string | null): Look {
  return LOOKS.find((l) => l.id === id) ?? JULY;
}
