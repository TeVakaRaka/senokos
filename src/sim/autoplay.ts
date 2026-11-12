// Общий прогон бота: один и тот же для тестов, проверки движков, страницы самопроверки
// и подбора баланса — чтобы везде считалось одинаково.

import { botInput, createBot } from './bot.ts';
import { createGame, step, type Game } from './game.ts';
import { Recorder } from './replay.ts';
import { DEFAULT_TUNING, type Tuning } from './tuning.ts';

export interface AutoplayResult {
  game: Game;
  recorder: Recorder;
}

/**
 * Бот играет, пока не пройдёт ticks шагов игрового времени или не кончится день.
 * Выборы перков время не двигают, поэтому в записи шагов может быть больше, чем ticks.
 */
export function autoplay(seed: number, ticks = Infinity, tuning: Tuning = DEFAULT_TUNING): AutoplayResult {
  const game = createGame(seed, tuning);
  const bot = createBot(seed);
  const recorder = new Recorder();
  let guard = 0;
  while (!game.over && game.tick < ticks && guard < 200000) {
    const input = botInput(game, bot);
    recorder.push(input);
    step(game, input);
    guard++;
  }
  return { game, recorder };
}
