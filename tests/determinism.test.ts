// Одинаковость: одно зерно и один ввод обязаны давать одно и то же состояние.
// Эталонных хешей здесь нет намеренно — они ломались бы при каждой правке баланса.

import { describe, expect, it } from 'vitest';
import { botInput, createBot } from '../src/sim/bot.ts';
import { autoplay } from '../src/sim/autoplay.ts';
import { createGame, step } from '../src/sim/game.ts';
import { hashGame } from '../src/sim/hash.ts';
import { makeReplay, Recorder, runReplay } from '../src/sim/replay.ts';
import { cloneTuning, DEFAULT_TUNING } from '../src/sim/tuning.ts';
import { me } from './util.ts';

const SEEDS = [1, 2, 3, 20261112];
const TICKS = 1800; // шагов ввода (около минуты игры)

/** Боты играют заданное число шагов ввода; на каждой десятой секунде снимается хеш. */
function playBots(seed: number, steps: number, players = 1) {
  const g = createGame(seed, DEFAULT_TUNING, players);
  const bots = g.players.map((p) => createBot(seed, p.id));
  const recorder = new Recorder();
  const checkpoints: number[] = [];
  const inputs = new Array<number>(players).fill(0);
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < players; k++) inputs[k] = botInput(g, bots[k]!);
    recorder.pushAll(inputs);
    step(g, inputs);
    if (g.tick % 300 === 0) checkpoints.push(hashGame(g));
  }
  return { g, recorder, checkpoints };
}

describe('одинаковость симуляции', () => {
  for (const players of [1, 2]) {
    for (const seed of SEEDS) {
      it(`зерно ${seed}, игроков ${players}: запись воспроизводится точь-в-точь`, () => {
        const first = playBots(seed, TICKS, players);
        const replay = makeReplay(seed, DEFAULT_TUNING, first.recorder, players);
        expect(replay.inputs.length).toBe(TICKS * players);

        const again = createGame(seed, DEFAULT_TUNING, players);
        const checkpoints: number[] = [];
        const frame = new Array<number>(players).fill(0);
        for (let i = 0; i < replay.inputs.length; i += players) {
          for (let k = 0; k < players; k++) frame[k] = replay.inputs[i + k]!;
          step(again, frame);
          if (again.tick % 300 === 0) checkpoints.push(hashGame(again));
        }
        expect(checkpoints).toEqual(first.checkpoints);
        expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(first.g));
      });
    }
  }

  it('бот действительно косит, носит в стог и берёт перки', () => {
    const { g } = playBots(1, TICKS);
    const p = me(g);
    expect(p.swings).toBeGreaterThan(20);
    expect(p.cutTufts).toBeGreaterThan(200);
    const fresh = createGame(1);
    const yesterday = fresh.field.count - fresh.field.standing; // скошено накануне
    expect(g.field.standing).toBe(g.field.count - p.cutTufts - yesterday);
    expect(p.stacked).toBeGreaterThan(20);
    expect(p.level).toBeGreaterThan(1);
  });

  it('полный день бота воспроизводится по записи', () => {
    const { game, recorder } = autoplay(4);
    expect(game.over).toBe(true);
    const replay = makeReplay(4, DEFAULT_TUNING, recorder);
    expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(game));
  });

  it('полный день двух ботов воспроизводится по записи', () => {
    const { game, recorder } = autoplay(4, Infinity, DEFAULT_TUNING, 2);
    expect(game.over).toBe(true);
    const replay = makeReplay(4, DEFAULT_TUNING, recorder, 2);
    expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(game));
  });

  it('ввод соперника меняет исход: один и тот же первый игрок, разные вторые', () => {
    const a = createGame(6, DEFAULT_TUNING, 2);
    const b = createGame(6, DEFAULT_TUNING, 2);
    for (let i = 0; i < 300; i++) {
      step(a, [1, 0]);
      step(b, [1, 33]);
    }
    expect(hashGame(a)).not.toBe(hashGame(b));
  });

  it('разные зёрна дают разные поля', () => {
    const a = createGame(1);
    const b = createGame(2);
    expect(hashGame(a)).not.toBe(hashGame(b));
    expect(me(a).stackX === me(b).stackX && me(a).stackY === me(b).stackY).toBe(false);
  });

  it('один игрок и двое — разные расклады одного зерна', () => {
    expect(hashGame(createGame(1))).not.toBe(hashGame(createGame(1, DEFAULT_TUNING, 2)));
  });

  it('полный день трёх ботов воспроизводится по записи', () => {
    const { game, recorder } = autoplay(4, Infinity, DEFAULT_TUNING, 3);
    expect(game.over).toBe(true);
    expect(game.players.length).toBe(3);
    const replay = makeReplay(4, DEFAULT_TUNING, recorder, 3);
    expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(game));
  });

  it('запись с другим набором чисел отклоняется', () => {
    const first = playBots(3, 300);
    const replay = makeReplay(3, DEFAULT_TUNING, first.recorder);
    const other = cloneTuning(DEFAULT_TUNING);
    other.reach = 3;
    expect(() => runReplay(replay, other)).toThrow();
  });

  it('новые числа PvP и инструментов входят в хеш набора', () => {
    const first = playBots(3, 60, 2);
    const replay = makeReplay(3, DEFAULT_TUNING, first.recorder, 2);
    const keys = [
      'swapTime',
      'scytheSpeed',
      'crawlTime',
      'crawlFactor',
      'shieldTime',
      'stealRate',
      'dropRadius',
      'hitHay',
      'armorMin',
      'woundTime',
      'graceTime',
      'woundBoost',
      'pvpFieldScale',
      'shopKgEach',
      'shopReach',
      'giveDwell',
      'gunShells',
      'ammoPackKg',
      'ammoPack',
      'vestKg',
      'vestHits',
      'gunPeriod',
      'gunArcDeg',
      'gunDogExtra',
      'gunKnockback',
      'downTime',
      'kennelReach',
      'dogKg',
      'dogSpeed',
      'dogGuard',
      'dogNear',
      'dogLeash',
      'dogBitePeriod',
      'dogCrawlTime',
    ] as const;
    for (const key of keys) {
      const other = cloneTuning(DEFAULT_TUNING);
      other[key] = other[key] + 0.5;
      expect(() => runReplay(replay, other), key).toThrow();
    }
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
