// Общий прогон ботов: один и тот же для тестов, проверки движков, страницы самопроверки
// и подбора баланса — чтобы везде считалось одинаково.

import { botInput, createBot, type Bot } from './bot.ts';
import { createGame, step, type Game } from './game.ts';
import { Recorder } from './replay.ts';
import { DEFAULT_TUNING, type Tuning } from './tuning.ts';

export interface AutoplayResult {
  game: Game;
  recorder: Recorder;
  bots: Bot[];
}

/**
 * Боты играют (по одному на игрока), пока не пройдёт ticks шагов игрового времени или
 * не кончится день. Выборы улучшений время не двигают, поэтому шагов в записи может
 * быть больше, чем ticks.
 */
export function autoplay(
  seed: number,
  ticks = Infinity,
  tuning: Tuning = DEFAULT_TUNING,
  playerCount = 1,
  teams = false,
): AutoplayResult {
  const game = createGame(seed, tuning, playerCount, -1, teams);
  const bots = game.players.map((p) => createBot(seed, p.id));
  const recorder = new Recorder();
  const inputs = new Array<number>(playerCount).fill(0);
  let guard = 0;
  while (!game.over && game.tick < ticks && guard < 400000) {
    for (let i = 0; i < bots.length; i++) inputs[i] = botInput(game, bots[i]!);
    recorder.pushAll(inputs);
    step(game, inputs);
    guard++;
  }
  return { game, recorder, bots };
}
