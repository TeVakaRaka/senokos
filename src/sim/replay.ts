// Запись забега: по одному байту ввода на игрока за шаг. Три минуты игры одного
// игрока — около 5 КБ. По записи забег воспроизводится точь-в-точь: для проверки
// результата, повторов и «призраков».

import { createGame, step, type Game } from './game.ts';
import { hashTuning } from './hash.ts';
import type { Tuning } from './tuning.ts';

export class Recorder {
  data = new Uint8Array(8192);
  length = 0;

  push(input: number): void {
    if (this.length === this.data.length) {
      const bigger = new Uint8Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = input;
  }

  /** Ввод всех игроков за один шаг — подряд, по порядку номеров. */
  pushAll(inputs: readonly number[]): void {
    for (let i = 0; i < inputs.length; i++) this.push(inputs[i]!);
  }

  bytes(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

export interface Replay {
  seed: number;
  tuningHash: number; // с каким набором чисел сыгран забег
  players: number; // сколько игроков; в inputs на каждый шаг столько же байтов
  teams: boolean; // игра командами 2×2 (вчетвером)
  inputs: Uint8Array;
}

export function makeReplay(seed: number, tuning: Tuning, recorder: Recorder, players = 1, teams = false): Replay {
  return { seed, tuningHash: hashTuning(tuning), players, teams, inputs: recorder.bytes() };
}

/** Проигрывает запись с нуля и возвращает итоговое состояние. */
export function runReplay(replay: Replay, tuning: Tuning): Game {
  if (hashTuning(tuning) !== replay.tuningHash) {
    throw new Error('Запись сыграна с другим набором чисел баланса');
  }
  const n = replay.players;
  const g = createGame(replay.seed, tuning, n, -1, replay.teams);
  const frame = new Array<number>(n).fill(0);
  for (let i = 0; i + n <= replay.inputs.length; i += n) {
    for (let k = 0; k < n; k++) frame[k] = replay.inputs[i + k]!;
    step(g, frame);
  }
  return g;
}
