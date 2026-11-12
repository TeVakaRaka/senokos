// Одинаковость: одно зерно и один ввод обязаны давать одно и то же состояние.
// Эталонных хешей здесь нет намеренно — они ломались бы при каждой правке баланса.

import { describe, expect, it } from 'vitest';
import { botInput, createBot } from '../src/sim/bot.ts';
import { autoplay } from '../src/sim/autoplay.ts';
import { createGame, step } from '../src/sim/game.ts';
import { hashGame } from '../src/sim/hash.ts';
import { makeReplay, Recorder, runReplay } from '../src/sim/replay.ts';
import { cloneTuning, DEFAULT_TUNING } from '../src/sim/tuning.ts';

const SEEDS = [1, 2, 3, 20261112];
const TICKS = 1800; // шагов ввода (около минуты игры)

function playBot(seed: number, ticks: number) {
  const g = createGame(seed);
  const bot = createBot(seed);
  const recorder = new Recorder();
  const checkpoints: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const input = botInput(g, bot);
    recorder.push(input);
    step(g, input);
    if (g.tick % 300 === 0) checkpoints.push(hashGame(g));
  }
  return { g, recorder, checkpoints };
}

describe('одинаковость симуляции', () => {
  for (const seed of SEEDS) {
    it(`зерно ${seed}: запись воспроизводится точь-в-точь`, () => {
      const first = playBot(seed, TICKS);
      const replay = makeReplay(seed, DEFAULT_TUNING, first.recorder);
      expect(replay.inputs.length).toBe(TICKS);

      const again = createGame(seed);
      const checkpoints: number[] = [];
      for (let i = 0; i < replay.inputs.length; i++) {
        step(again, replay.inputs[i]!);
        if (again.tick % 300 === 0) checkpoints.push(hashGame(again));
      }
      expect(checkpoints).toEqual(first.checkpoints);
      expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(first.g));
    });
  }

  it('бот действительно косит, носит в стог и берёт перки', () => {
    const { g } = playBot(1, TICKS);
    expect(g.swings).toBeGreaterThan(20);
    expect(g.cutTufts).toBeGreaterThan(200);
    const fresh = createGame(1);
    const yesterday = fresh.field.count - fresh.field.standing; // скошено накануне
    expect(g.field.standing).toBe(g.field.count - g.cutTufts - yesterday);
    expect(g.stacked).toBeGreaterThan(20);
    expect(g.level).toBeGreaterThan(1);
  });

  it('полный день бота воспроизводится по записи', () => {
    const { game, recorder } = autoplay(4);
    expect(game.over).toBe(true);
    const replay = makeReplay(4, DEFAULT_TUNING, recorder);
    expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(game));
  });

  it('разные зёрна дают разные поля', () => {
    const a = createGame(1);
    const b = createGame(2);
    expect(hashGame(a)).not.toBe(hashGame(b));
    expect(a.stackX === b.stackX && a.stackY === b.stackY).toBe(false);
  });

  it('запись с другим набором чисел отклоняется', () => {
    const first = playBot(3, 300);
    const replay = makeReplay(3, DEFAULT_TUNING, first.recorder);
    const other = cloneTuning(DEFAULT_TUNING);
    other.reach = 3;
    expect(() => runReplay(replay, other)).toThrow();
  });

  it('набор чисел забега не меняется, если поменять исходный', () => {
    const tuning = cloneTuning(DEFAULT_TUNING);
    const g = createGame(5, tuning);
    tuning.reach = 9;
    tuning.grassHp[0] = 3;
    expect(g.tuning.reach).toBe(DEFAULT_TUNING.reach);
    expect(g.tuning.grassHp[0]).toBe(DEFAULT_TUNING.grassHp[0]);
  });
});
