// Цвета и имена игроков для интерфейса. Цвет закреплён за номером игрока и одинаков
// на всех экранах: «я синий» значит одно и то же для всей компании.

import { PLAYER_COLORS } from '../render/props.ts';

/** Те же цвета, но потемнее — для цифр на светлой карточке. */
const INK = ['#c5402f', '#3460c4', '#a8740c', '#7443bd'];
const NAMES = ['красный', 'синий', 'жёлтый', 'фиолетовый'];
const WHOSE = ['красного', 'синего', 'жёлтого', 'фиолетового'];

/** Цвет игрока k для точек и стрелок — как у его косаря и флага на стогу. */
export function playerCss(k: number): string {
  return `#${PLAYER_COLORS[k % PLAYER_COLORS.length]!.toString(16).padStart(6, '0')}`;
}

export function playerInk(k: number): string {
  return INK[k % INK.length]!;
}

/** «красный», «синий»… */
export function colorName(k: number): string {
  return NAMES[k % NAMES.length]!;
}

/** «красного», «синего»… */
export function colorWhose(k: number): string {
  return WHOSE[k % WHOSE.length]!;
}
