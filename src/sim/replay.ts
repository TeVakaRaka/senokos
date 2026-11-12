// Запись забега: по одному байту ввода на шаг. Три минуты игры — около 5 КБ.
// По записи забег воспроизводится точь-в-точь: для проверки результата, повторов и «призраков».

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

  bytes(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

export interface Replay {
  seed: number;
  tuningHash: number; // с каким набором чисел сыгран забег
  inputs: Uint8Array;
}

export function makeReplay(seed: number, tuning: Tuning, recorder: Recorder): Replay {
  return { seed, tuningHash: hashTuning(tuning), inputs: recorder.bytes() };
}

/** Проигрывает запись с нуля и возвращает итоговое состояние. */
export function runReplay(replay: Replay, tuning: Tuning): Game {
  if (hashTuning(tuning) !== replay.tuningHash) {
    throw new Error('Запись сыграна с другим набором чисел баланса');
  }
  const g = createGame(replay.seed, tuning);
  for (let i = 0; i < replay.inputs.length; i++) step(g, replay.inputs[i]!);
  return g;
}
