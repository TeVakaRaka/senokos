// Правила сена и инструментов: покос лежит и сохнет на месте; в руках либо коса, либо
// грабли; грабли сгребают сухое в тюк; тюк выгружается в стог; улучшения; конец дня.

import { describe, expect, it } from 'vitest';
import { botInput, createBot } from '../src/sim/bot.ts';
import { createGame, INPUT_SWAP, step, TOOL_RAKE, TOOL_SCYTHE, type Game } from '../src/sim/game.ts';
import { dryKg, groundKg } from '../src/sim/hay.ts';
import {
  CHOICE_BASE,
  derive,
  levelThreshold,
  PERK_ARC,
  PERK_CARRY,
  PERK_COUNT,
  PERK_RAKE,
  PERK_RATE,
  PERK_REACH,
} from '../src/sim/perks.ts';
import { cloneTuning, DEFAULT_TUNING, DT, TICK_RATE } from '../src/sim/tuning.ts';
import {
  bare,
  EAST,
  farFromStack,
  layDryHay,
  me,
  place,
  run,
  solid,
  totalKg,
  tuftAtDistance,
  useRake,
  useScythe,
  WEST,
} from './util.ts';

describe('покос лежит и сохнет на месте', () => {
  it('срезанное остаётся лежать там, где росло', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    run(g, EAST, 120);
    expect(p.cutTufts).toBeGreaterThan(50);
    const f = g.field;
    let lying = 0;
    for (let i = 0; i < f.count; i++) {
      if (f.hp[i] === 0) {
        expect(f.hay[i]).toBeCloseTo(g.tuning.grassYield[0], 12);
        lying++;
      } else {
        expect(f.hay[i]).toBe(0);
      }
    }
    expect(lying).toBe(p.cutTufts);
    expect(groundKg(g)).toBeCloseTo(p.cutKg, 9);
    expect(p.load).toBe(0);
  });

  it('масса сена сохраняется: скошено + вчерашнее = земля + тюк + стог', () => {
    const g = createGame(3);
    const p = me(g);
    const start = totalKg(g);
    expect(start).toBeGreaterThanOrEqual(g.tuning.yesterdayKg);
    expect(start).toBeLessThan(g.tuning.yesterdayKg + 1);
    const bot = createBot(3);
    for (let i = 0; i < 4000; i++) step(g, botInput(g, bot));
    expect(p.stacked).toBeGreaterThan(10);
    expect(totalKg(g)).toBeCloseTo(start + p.cutKg, 6);
  });

  it('высыхает ровно через время сушки', () => {
    const g = createGame(7, solid());
    farFromStack(me(g));
    run(g, EAST, 40);
    const cutAt = g.field.cutTick.find((t, k) => g.field.hp[k] === 0 && t > 0)!;
    run(g, 0, cutAt + g.dryTicks - g.tick - 1);
    expect(dryKg(g)).toBe(0);
    run(g, 0, 1);
    expect(dryKg(g)).toBeGreaterThan(0);
    expect(g.dryTicks).toBe(Math.round(g.tuning.dryTime * TICK_RATE));
  });
});

describe('коса или грабли', () => {
  it('в начале в руках коса; кнопка меняет инструмент', () => {
    const g = createGame(7, solid());
    const p = me(g);
    expect(p.tool).toBe(TOOL_SCYTHE);
    step(g, INPUT_SWAP);
    expect(p.tool).toBe(TOOL_RAKE);
    expect(p.swapped).toBe(true);
    expect(p.toolCd).toBe(g.swapTicks);
    // Пока меняет — повторное нажатие не срабатывает.
    step(g, INPUT_SWAP);
    expect(p.tool).toBe(TOOL_RAKE);
    run(g, 0, g.swapTicks);
    step(g, INPUT_SWAP);
    expect(p.tool).toBe(TOOL_SCYTHE);
  });

  it('смену инструмента можно нажать на ходу', () => {
    const g = createGame(7, bare());
    const p = me(g);
    farFromStack(p);
    const x0 = p.x;
    step(g, EAST + INPUT_SWAP);
    expect(p.tool).toBe(TOOL_RAKE);
    expect(p.x).toBeGreaterThan(x0);
  });

  it('с косой сухое сено не сгребается, с граблями — сгребается', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    run(g, EAST, 90); // прокосил полосу
    run(g, 0, g.dryTicks); // подождал, пока высохнет
    expect(dryKg(g)).toBeGreaterThan(1);
    run(g, WEST, 40); // прошёл назад по сухому с косой в руках
    expect(p.load).toBe(0);
    useRake(g);
    run(g, EAST, 40); // а теперь с граблями
    expect(p.load).toBeGreaterThan(1);
  });

  it('с граблями коса не косит и шаг косаря не включается', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    useRake(g);
    run(g, EAST, 120);
    expect(p.swings).toBe(0);
    expect(p.needAhead).toBe(0);
    // По стоячей траве с граблями идёт «бродом», а не шагом косаря.
    expect(p.speed).toBeCloseTo(g.tuning.runSpeed * g.tuning.wadeFactor, 6);
  });

  it('пока меняет инструмент, не работает ни коса, ни грабли', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    const tuft = tuftAtDistance(g, p.x, p.y, 0, 0.5);
    layDryHay(g, tuft, 0.1);
    step(g, INPUT_SWAP); // начал брать грабли
    for (let i = 0; i < g.swapTicks - 1; i++) {
      step(g, EAST);
      expect(p.swings).toBe(0);
      expect(p.load).toBe(0);
    }
  });

  it('сырое сено грабли не берут', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    run(g, EAST, 90);
    useRake(g);
    run(g, WEST, 40); // сразу назад по своей полосе: сено ещё сырое
    expect(p.load).toBe(0);
  });

  it('синтез: коса и грабли на максимуме работают вместе', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    const perks = new Array<number>(PERK_COUNT).fill(0);
    expect(derive(t, perks).combo).toBe(false);
    perks[PERK_REACH] = t.perkMaxLevel;
    expect(derive(t, perks).combo).toBe(false);
    perks[PERK_RAKE] = t.perkMaxLevel;
    expect(derive(t, perks).combo).toBe(true);

    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    p.perks[PERK_REACH] = t.perkMaxLevel;
    p.perks[PERK_RAKE] = t.perkMaxLevel;
    p.d = derive(g.tuning, p.perks);
    const tuft = tuftAtDistance(g, p.x, p.y, 0, 0.5);
    layDryHay(g, tuft, 0.1);
    run(g, EAST, 60);
    expect(p.swings).toBeGreaterThan(0); // косит
    expect(p.load).toBeGreaterThan(0); // и гребёт одновременно
    step(g, INPUT_SWAP);
    expect(p.swapped).toBe(false); // менять инструмент больше незачем
  });
});

describe('грабли и тюк', () => {
  it('гребут только в своём радиусе', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    useRake(g);
    const r = p.d.rakeRadius;
    const near = tuftAtDistance(g, p.x, p.y, 0, r - 0.2);
    const far = tuftAtDistance(g, p.x, p.y, r + 0.3, r + 1.2);
    layDryHay(g, near, 0.1);
    layDryHay(g, far, 0.1);
    step(g, 0);
    expect(g.field.hay[near]).toBe(0);
    expect(g.field.hay[far]).toBeCloseTo(0.1, 12);
    expect(p.load).toBeCloseTo(0.1, 12);
    expect(p.rakeTo - p.rakeFrom).toBe(1);
    expect(g.rakeIdx[p.rakeFrom]).toBe(near);
  });

  it('тюк не переполняется: лишнее остаётся лежать', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    useRake(g);
    const cap = p.d.carryCap;
    const tuft = tuftAtDistance(g, p.x, p.y, 0, 0.5);
    layDryHay(g, tuft, 2);
    p.load = cap - 0.5;
    step(g, 0);
    expect(p.load).toBe(cap);
    expect(g.field.hay[tuft]).toBeCloseTo(1.5, 9);
    expect(p.rakeTo - p.rakeFrom).toBe(0); // кустик сгребён не начисто
  });

  it('с полным тюком косить можно, грести — уже некуда', () => {
    const g = createGame(7, solid());
    const p = me(g);
    farFromStack(p);
    p.load = p.d.carryCap;
    run(g, EAST, 90);
    expect(p.swings).toBeGreaterThan(0);
    useRake(g);
    const tuft = tuftAtDistance(g, p.x, p.y, 0, 0.5);
    layDryHay(g, tuft, 0.1);
    run(g, 0, 5);
    expect(g.field.hay[tuft]).toBeCloseTo(0.1, 12);
  });

  it('с косой косарь чуть медленнее, чем с граблями; груз замедляет обоих', () => {
    const speedOf = (rake: boolean, full: boolean): number => {
      const g = createGame(7, bare());
      const p = me(g);
      farFromStack(p);
      if (rake) p.tool = TOOL_RAKE;
      if (full) p.load = p.d.carryCap;
      run(g, EAST, 30);
      return p.speed;
    };
    const t = DEFAULT_TUNING;
    expect(speedOf(true, false)).toBeCloseTo(t.runSpeed, 6);
    expect(speedOf(false, false)).toBeCloseTo(t.runSpeed * t.scytheSpeed, 6);
    expect(speedOf(true, true)).toBeCloseTo(t.runSpeed * (1 - t.carrySlow), 6);
    expect(speedOf(false, true)).toBeCloseTo(t.runSpeed * t.scytheSpeed * (1 - t.carrySlow), 6);
    // С полным тюком и граблями — немного медленнее косаря с косой налегке: тот догонит.
    expect(speedOf(true, true)).toBeLessThan(speedOf(false, false));
    expect(speedOf(true, true)).toBeGreaterThan(speedOf(false, false) * 0.85);
  });
});

describe('стог', () => {
  it('у стога тюк выгружается в стог целиком, с любым инструментом', () => {
    const g = createGame(7, solid());
    const p = me(g);
    place(p, p.stackX + 2, p.stackY);
    p.load = 6; // меньше порога первого улучшения — выгрузка не прервётся выбором
    run(g, 0, 30);
    expect(p.load).toBe(0);
    expect(p.stacked).toBeCloseTo(6, 9);
    expect(p.delivered).toBeCloseTo(6, 9);
  });

  it('вдали от стога тюк не выгружается', () => {
    const g = createGame(7, solid());
    const p = me(g);
    place(p, p.stackX + 8, p.stackY);
    p.load = 10;
    run(g, 0, 30);
    expect(p.load).toBe(10);
    expect(p.stacked).toBe(0);
  });

  it('вчерашний покос лежит сухим рядом с игроком и даёт первое улучшение в первые секунды', () => {
    const g = createGame(7);
    const p = me(g);
    expect(dryKg(g)).toBeGreaterThanOrEqual(g.tuning.yesterdayKg);
    expect(p.cutTufts).toBe(0); // вчерашнее в сегодняшний покос не считается
    const bot = createBot(7);
    let steps = 0;
    while (p.offer === null && steps < 600) {
      step(g, botInput(g, bot));
      steps++;
    }
    expect(p.offer).not.toBeNull();
    expect(g.tick * DT).toBeLessThan(10);
  });
});

describe('улучшения', () => {
  function withOffer(): Game {
    const g = createGame(7, solid());
    const p = me(g);
    place(p, p.stackX + 2, p.stackY);
    p.load = levelThreshold(g.tuning, 0) + 0.5;
    run(g, 0, 30);
    expect(p.offer).not.toBeNull();
    return g;
  }

  it('на пороге предлагаются три разных улучшения', () => {
    const offer = me(withOffer()).offer!;
    expect(offer.length).toBe(3);
    expect(new Set(offer).size).toBe(3);
    for (const k of offer) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(PERK_COUNT);
    }
  });

  it('пока игрок выбирает, время стоит', () => {
    const g = withOffer();
    const tick = g.tick;
    run(g, EAST, 50);
    expect(g.tick).toBe(tick);
    expect(me(g).offer).not.toBeNull();
  });

  it('выбор применяет ровно своё улучшение', () => {
    const g = withOffer();
    const p = me(g);
    const chosen = p.offer![1]!;
    step(g, CHOICE_BASE + 1);
    expect(p.offer).toBeNull();
    expect(p.level).toBe(1);
    for (let k = 0; k < PERK_COUNT; k++) expect(p.perks[k]).toBe(k === chosen ? 1 : 0);
  });

  it('каждое улучшение меняет только свои числа', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    const none = new Array<number>(PERK_COUNT).fill(0);
    const base = derive(t, none);
    const one = (perk: number) => derive(t, none.map((_, k) => (k === perk ? 1 : 0)));

    const arc = one(PERK_ARC);
    expect(arc.arcDeg).toBe(base.arcDeg + t.arcPerLevel);
    expect(arc.reach).toBe(base.reach);
    expect(arc.carryCap).toBe(base.carryCap);
    expect(arc.rakeRadius).toBe(base.rakeRadius);

    const reach = one(PERK_REACH);
    expect(reach.reach).toBeCloseTo(base.reach + t.reachPerLevel, 12);
    expect(reach.mowSpeed).toBeGreaterThan(base.mowSpeed);
    expect(reach.arcDeg).toBe(base.arcDeg);

    const rate = one(PERK_RATE);
    expect(rate.swingTicks).toBe(Math.round(t.swingPeriod * (1 - t.ratePerLevel) * TICK_RATE));
    expect(rate.reach).toBe(base.reach);

    const carry = one(PERK_CARRY);
    expect(carry.carryCap).toBe(base.carryCap + t.carryPerLevel);
    expect(carry.swingTicks).toBe(base.swingTicks);

    const wide = one(PERK_RAKE);
    expect(wide.rakeRadius).toBeCloseTo(base.rakeRadius + t.rakePerLevel, 12);
    expect(wide.carryCap).toBe(base.carryCap);
    expect(wide.reach).toBe(base.reach);
  });

  it('улучшения на максимуме больше не предлагаются', () => {
    const g = withOffer();
    const p = me(g);
    p.perks[PERK_ARC] = g.tuning.perkMaxLevel;
    p.perks[PERK_RATE] = g.tuning.perkMaxLevel;
    step(g, CHOICE_BASE); // взять что-то из текущего предложения
    p.load = 200;
    run(g, 0, 40);
    expect(p.offer).not.toBeNull();
    for (const k of p.offer!) expect(k === PERK_ARC || k === PERK_RATE).toBe(false);
  });

  it('пороги после списка продолжают расти', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    const n = t.levelKg.length;
    const a = levelThreshold(t, n - 1);
    const b = levelThreshold(t, n);
    const c = levelThreshold(t, n + 1);
    expect(b).toBeGreaterThan(a);
    expect(c - b).toBeGreaterThan(b - a);
  });
});

describe('конец дня', () => {
  it('день кончается в срок, после этого ничего не меняется', () => {
    const g = createGame(7, solid({ dayLength: 2 }));
    const p = me(g);
    farFromStack(p);
    run(g, EAST, 60);
    expect(g.over).toBe(true);
    expect(g.tick).toBe(60);
    const x = p.x;
    run(g, EAST, 30);
    expect(g.tick).toBe(60);
    expect(p.x).toBe(x);
  });
});

// useScythe нужен другим тестам; здесь — проверка, что он возвращает косу в руки.
describe('помощники', () => {
  it('useScythe возвращает косу', () => {
    const g = createGame(7, solid());
    useRake(g);
    expect(me(g).tool).toBe(TOOL_RAKE);
    useScythe(g);
    expect(me(g).tool).toBe(TOOL_SCYTHE);
  });
});
