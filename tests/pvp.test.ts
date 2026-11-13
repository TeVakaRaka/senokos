// Правила PvP: у каждого свой стог; коса подрезает сопернику ноги; подрезанный ползёт,
// роняет тюк и какое-то время неуязвим; граблями можно таскать сено из чужого стога.

import { describe, expect, it } from 'vitest';
import { autoplay } from '../src/sim/autoplay.ts';
import { createGame, fleeing, scytheActive, step, TOOL_RAKE, type Game, type Player } from '../src/sim/game.ts';
import { fieldSizeFor, MAP_MEADOW, STACK_RADIUS } from '../src/sim/gen.ts';
import { derive, PERK_RAKE, PERK_REACH } from '../src/sim/perks.ts';
import { makeReplay, runReplay } from '../src/sim/replay.ts';
import { hashGame } from '../src/sim/hash.ts';
import { cloneTuning, DEFAULT_TUNING, DT, type Tuning } from '../src/sim/tuning.ts';
import { bare, EAST, layDryHay, place, run, solid, totalKg, tuftAtDistance, useRake, WEST } from './util.ts';

/**
 * Два игрока вдали от стогов: А в точке (20, 40), Б — правее на dx. Б стоит к А спиной,
 * чтобы не ударить первым (кто бьёт первым в спорном шаге — чередуется).
 *
 * Оба уже ранены — следующий удар подрежет ноги. Так удобнее проверять всё, что бывает
 * после подрезания; чтобы проверить сам первый удар, передайте healthy = true.
 */
function duel(dx: number, tuning: Tuning = bare(), healthy = false): { g: Game; a: Player; b: Player } {
  const g = createGame(5, tuning, 2, MAP_MEADOW);
  const a = g.players[0]!;
  const b = g.players[1]!;
  place(a, 20, 40);
  place(b, 20 + dx, 40);
  b.dir = dx >= 0 ? 0 : 32;
  if (!healthy) {
    a.wound = g.woundTicks;
    b.wound = g.woundTicks;
  }
  return { g, a, b };
}

describe('стоги и старт', () => {
  it('у каждого игрока свой стог, стоги далеко друг от друга', () => {
    const g = createGame(5, cloneTuning(DEFAULT_TUNING), 2);
    const [a, b] = g.players as [Player, Player];
    expect(Math.hypot(a.stackX - b.stackX, a.stackY - b.stackY)).toBeGreaterThan(10);
    for (const p of g.players) {
      expect(Math.hypot(p.x - p.stackX, p.y - p.stackY)).toBeLessThan(g.tuning.stackReach);
    }
  });

  it('вчерашнее сено лежит у каждого', () => {
    const g = createGame(5, cloneTuning(DEFAULT_TUNING), 2);
    expect(totalKg(g)).toBeGreaterThanOrEqual(g.tuning.yesterdayKg * 2);
    expect(totalKg(g)).toBeLessThan(g.tuning.yesterdayKg * 2 + 1);
  });
});

describe('первый удар ранит, второй подрезает ноги', () => {
  it('первый удар только ранит: ноги целы, тюк при нём', () => {
    const { g, a, b } = duel(1.5, bare(), true);
    b.load = 10; // коса в руках — тюк не прикрывает, но от первого удара и не падает
    step(g, [EAST, 0]);
    expect(a.swing!.victim).toBe(1);
    expect(b.woundedBy).toBe(0);
    expect(b.wound).toBe(g.woundTicks);
    expect(b.shield).toBe(g.graceTicks);
    expect(b.crawl).toBe(0);
    expect(b.hitBy).toBe(-1);
    expect(a.hits).toBe(0);
    expect(b.hurt).toBe(0);
    expect(b.load).toBe(10);
    expect(g.drops.length).toBe(0);
  });

  it('раненого полторы секунды нельзя ударить снова, и он бежит рывком', () => {
    const { g, a, b } = duel(1.5, bare(), true);
    step(g, [EAST, 0]);
    expect(fleeing(b)).toBe(true);
    // Обидчик стоит и машет, раненый убегает на восток.
    run(g, [0, EAST], g.graceTicks - 2);
    expect(a.hits).toBe(0);
    expect(b.crawl).toBe(0);
    const t = g.tuning;
    expect(b.speed).toBeCloseTo(t.runSpeed * t.scytheSpeed * t.woundBoost, 6);
    // Передышка кончилась — бежит как обычно, но рана ещё не зажила.
    run(g, [0, EAST], 10);
    expect(fleeing(b)).toBe(false);
    expect(b.wound).toBeGreaterThan(0);
    expect(b.speed).toBeCloseTo(t.runSpeed * t.scytheSpeed, 6);
  });

  it('пока передышка — раненый не косит и не бьёт в ответ', () => {
    const { g, a, b } = duel(1.5, solid(), true);
    step(g, [EAST, 0]);
    const swings = b.swings;
    expect(scytheActive(b)).toBe(false);
    // Раненый разворачивается к обидчику — тот в секторе его косы, трава вокруг стоит.
    run(g, [0, WEST], g.graceTicks - 2);
    expect(b.swings).toBe(swings);
    expect(a.wound).toBe(0);
    run(g, [0, 0], 3);
    expect(scytheActive(b)).toBe(true);
  });

  it('второй удар, пока рана не зажила, подрезает ноги', () => {
    const { g, a, b } = duel(1.5, bare(), true);
    step(g, [EAST, 0]);
    run(g, 0, g.graceTicks + a.d.swingTicks); // оба стоят: передышка проходит, коса снова готова
    expect(b.crawl).toBeGreaterThan(0);
    expect(b.wound).toBe(0); // рана «закрыта» подрезанием
    expect(a.hits).toBe(1);
    expect(b.hurt).toBe(1);
  });

  it('убежать можно: рывка хватает, чтобы выйти из-под косы', () => {
    const { g, a, b } = duel(1.5, bare(), true);
    run(g, [EAST, EAST], 240); // раненый бежит прочь, обидчик с косой — за ним
    expect(b.woundedBy).toBe(-1);
    expect(b.crawl).toBe(0);
    expect(a.hits).toBe(0);
    expect(b.x - a.x).toBeGreaterThan(g.tuning.reach + g.tuning.heroRadius + 0.5);
  });

  it('рана заживает: потом опять нужны два удара', () => {
    const { g, a, b } = duel(1.5, bare(), true);
    step(g, [EAST, 0]);
    place(a, 5, 5); // обидчик ушёл
    run(g, 0, g.woundTicks);
    expect(b.wound).toBe(0);
    place(a, b.x - 1.5, b.y);
    a.dir = 0;
    run(g, 0, a.d.swingTicks + 1);
    expect(b.wound).toBeGreaterThan(0); // снова только ранен
    expect(b.crawl).toBe(0);
    expect(a.hits).toBe(0);
  });

  it('с граблями и сеном запас ещё больше: сначала тюк, потом рана, потом ноги', () => {
    const { g, a, b } = duel(1.5, bare(), true);
    b.tool = TOOL_RAKE;
    b.load = g.tuning.hitHay; // сена ровно на один удар
    a.load = a.d.carryCap; // чтобы выбитое не мешало счёту
    step(g, [EAST, 0]);
    expect(b.load).toBe(0);
    expect(b.wound).toBe(0); // первый удар пришёлся по тюку
    run(g, 0, a.d.swingTicks);
    expect(b.wound).toBeGreaterThan(0); // второй — ранил
    expect(b.crawl).toBe(0);
    run(g, 0, g.graceTicks + a.d.swingTicks);
    expect(b.crawl).toBeGreaterThan(0); // третий — подрезал
  });

  it('если раны выключены числом баланса, ноги подрезает первый же удар', () => {
    const { g, b } = duel(1.5, bare({ woundTime: 0 }), true);
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
  });
});

describe('коса по ногам', () => {
  it('раненый соперник в секторе взмаха получает по ногам', () => {
    const { g, a, b } = duel(1.5);
    step(g, [EAST, 0]);
    expect(a.swing).not.toBeNull();
    expect(a.swing!.victim).toBe(1);
    expect(a.hits).toBe(1);
    expect(b.hitBy).toBe(0);
    expect(b.hurt).toBe(1);
    expect(b.crawl).toBe(g.crawlTicks);
    expect(b.shield).toBe(g.crawlTicks + g.shieldTicks);
  });

  it('соперника за спиной коса не достаёт', () => {
    const { g, a, b } = duel(-1.5);
    step(g, [EAST, 0]);
    expect(a.swing).toBeNull();
    expect(b.crawl).toBe(0);
  });

  it('дальше радиуса косы не достаёт', () => {
    const { g, a, b } = duel(DEFAULT_TUNING.reach + DEFAULT_TUNING.heroRadius + 0.3);
    step(g, [EAST, 0]);
    expect(a.swing).toBeNull();
    expect(b.crawl).toBe(0);
  });

  it('на самом краю радиуса — достаёт (коса задевает край тела)', () => {
    const { g, a, b } = duel(DEFAULT_TUNING.reach + DEFAULT_TUNING.heroRadius - 0.3);
    step(g, [EAST, 0]);
    expect(a.hits).toBe(1);
    expect(b.crawl).toBeGreaterThan(0);
  });

  it('сбоку, вне сектора взмаха, коса не достаёт', () => {
    const { g, a, b } = duel(0);
    place(b, a.x, a.y + 1.5); // ровно слева от курса: 90° при половине дуги 55°
    b.dir = 16;
    step(g, [EAST, 0]);
    expect(a.hits).toBe(0);
    expect(b.crawl).toBe(0);
  });

  it('с граблями в руках ударить нельзя', () => {
    const { g, a, b } = duel(1.5);
    useRake(g, 0);
    run(g, [EAST, 0], 5);
    expect(a.tool).toBe(TOOL_RAKE);
    expect(a.hits).toBe(0);
    expect(b.crawl).toBe(0);
  });

  it('подрезанный ползёт медленно, потом встаёт', () => {
    const { g, a, b } = duel(1.5);
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
    place(a, 5, 5); // убрать обидчика подальше
    run(g, [0, EAST], 20); // разогнаться ползком
    const x0 = b.x;
    run(g, [0, EAST], 30);
    const speed = (b.x - x0) / (30 * DT);
    const onFoot = g.tuning.runSpeed * g.tuning.scytheSpeed; // у подрезанного в руках коса
    expect(speed).toBeCloseTo(onFoot * g.tuning.crawlFactor, 6);
    run(g, [0, EAST], g.crawlTicks);
    expect(b.crawl).toBe(0);
    expect(b.speed).toBeCloseTo(onFoot, 6);
  });

  it('ползком не косит и не гребёт', () => {
    const { g, a, b } = duel(1.5, solid());
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
    place(a, 5, 5);
    const swings = b.swings;
    run(g, [0, EAST], 60); // ползёт по стоячей траве с косой в руках
    expect(b.swings).toBe(swings);
    b.tool = TOOL_RAKE;
    const tuft = tuftAtDistance(g, b.x, b.y, 0, 0.5);
    layDryHay(g, tuft, 0.1);
    run(g, [0, 0], 5);
    expect(b.load).toBe(0);
    expect(g.field.hay[tuft]).toBeCloseTo(0.1, 12);
  });

  it('пока ползёт и немного после — неуязвим', () => {
    const { g, a, b } = duel(1.5);
    step(g, [EAST, 0]);
    // Оба стоят: обидчик смотрит на соперника, коса готова, но бить нельзя.
    run(g, 0, g.crawlTicks + g.shieldTicks - 2);
    expect(a.hits).toBe(1);
    expect(b.crawl).toBe(0); // уже встал
    expect(b.shield).toBeGreaterThan(0); // но щит ещё действует
    run(g, 0, 3);
    // Щит кончился — но встал он целым: новый удар только ранит.
    expect(b.wound).toBeGreaterThan(0);
    expect(b.crawl).toBe(0);
    expect(a.hits).toBe(1);
    run(g, 0, g.graceTicks + a.d.swingTicks);
    expect(a.hits).toBe(2); // а следующий — снова по ногам
    expect(b.crawl).toBeGreaterThan(0);
  });

  it('два взмаха навстречу: побеждает один, второй уже ползёт', () => {
    const { g, a, b } = duel(1.5);
    step(g, [EAST, WEST]);
    expect(a.hits + b.hits).toBe(1);
    expect((a.crawl > 0 ? 1 : 0) + (b.crawl > 0 ? 1 : 0)).toBe(1);
  });
});

describe('тюк прикрывает того, кто с граблями', () => {
  /** А с косой стоит в полутора метрах от Б; у Б в руках грабли и kg сена в тюке. */
  function raker(kg: number): { g: Game; a: Player; b: Player } {
    const d = duel(1.5);
    d.b.tool = TOOL_RAKE;
    d.b.load = kg;
    return d;
  }

  it('удар выбивает сено из тюка, а ноги целы', () => {
    const { g, a, b } = raker(16);
    step(g, [EAST, 0]);
    expect(a.swing!.victim).toBe(1);
    expect(b.crawl).toBe(0);
    expect(b.hurt).toBe(0);
    expect(a.hits).toBe(0);
    expect(b.load).toBe(16 - g.tuning.hitHay);
    expect(b.lostKg).toBe(g.tuning.hitHay);
    expect(b.lostBy).toBe(0);
    expect(a.knocked).toBe(g.tuning.hitHay);
  });

  it('выбитое сено достаётся ударившему, если в его тюке есть место', () => {
    const { g, a, b } = raker(16);
    step(g, [EAST, 0]);
    expect(a.load).toBe(g.tuning.hitHay);
    expect(a.pickedKg).toBe(g.tuning.hitHay);
    expect(g.drops.length).toBe(0);
    expect(a.load + b.load).toBe(16); // ничего не потерялось
  });

  it('если места нет — сено лежит рядом с ударившим, хозяину его не достать не сходя с места', () => {
    const { g, a, b } = raker(16);
    a.load = a.d.carryCap;
    step(g, [EAST, 0]);
    run(g, 0, 5);
    expect(g.drops.length).toBe(1);
    expect(g.drops[0]!.kg).toBe(g.tuning.hitHay);
    expect(Math.hypot(g.drops[0]!.x - a.x, g.drops[0]!.y - a.y)).toBeLessThan(0.3);
    expect(b.load).toBe(16 - g.tuning.hitHay);
  });

  it('пока в тюке есть сено, ноги целы; по пустому тюку удар приходится по ногам', () => {
    const { g, a, b } = raker(16);
    step(g, [EAST, 0]); // первый удар: 16 → 8
    run(g, 0, a.d.swingTicks); // второй: 8 → 0
    expect(b.load).toBe(0);
    expect(b.crawl).toBe(0);
    expect(a.hits).toBe(0);
    run(g, 0, a.d.swingTicks); // третий — уже по ногам
    expect(b.crawl).toBeGreaterThan(0);
    expect(a.hits).toBe(1);
    expect(b.hurt).toBe(1);
  });

  it('щепотка сена в тюке не спасает', () => {
    const { g, a, b } = raker(DEFAULT_TUNING.armorMin - 0.5);
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
    expect(a.knocked).toBe(0);
    expect(b.load).toBe(0);
    expect(g.drops.length).toBe(1); // что было — упало
  });

  it('с пустыми граблями защиты нет', () => {
    const { g, b } = raker(0);
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
  });

  it('с косой в руках тюк не прикрывает: ноги подрезаны, весь тюк на земле', () => {
    const { g, a, b } = duel(1.5);
    b.load = 16;
    a.load = a.d.carryCap; // чтобы упавшее осталось лежать
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
    expect(b.load).toBe(0);
    expect(g.drops[0]!.kg).toBe(16);
  });

  it('после синтеза тюк прикрывает всегда', () => {
    const { g, b } = duel(1.5);
    b.perks[PERK_REACH] = g.tuning.perkMaxLevel;
    b.perks[PERK_RAKE] = g.tuning.perkMaxLevel;
    b.d = derive(g.tuning, b.perks);
    b.load = 10;
    step(g, [EAST, 0]);
    expect(b.crawl).toBe(0);
    expect(b.load).toBe(10 - g.tuning.hitHay);
  });

  it('полегчав, тот, кто с граблями, убегает: тюк потерян, ноги целы', () => {
    const { g, a, b } = raker(16);
    run(g, [EAST, EAST], 150); // Б бежит прочь, А с косой — за ним
    expect(b.crawl).toBe(0);
    expect(b.hurt).toBe(0);
    expect(b.load).toBe(0); // оба удара пришлись по тюку
    expect(a.load).toBe(16); // и всё сено теперь у ударившего
    expect(a.knocked).toBe(16);
    // Третьего удара не было: налегке с граблями быстрее, чем с косой и полным тюком.
    expect(b.x - a.x).toBeGreaterThan(g.tuning.reach + g.tuning.heroRadius + 1);
    expect(b.speed).toBeGreaterThan(a.speed);
  });

  it('с полным тюком от косаря налегке не уйти — но и тут сначала страдает тюк', () => {
    const { g, a, b } = raker(16);
    place(b, a.x + 4, a.y); // фора в четыре метра: до первого удара ещё далеко
    run(g, [EAST, EAST], 20);
    expect(a.speed).toBeGreaterThan(b.speed);
    expect(a.speed - b.speed).toBeLessThan(0.6); // догоняет, но не мгновенно
  });
});

describe('упавший тюк', () => {
  it('подрезанный роняет весь тюк на землю', () => {
    const { g, a, b } = duel(1.5);
    b.load = 10;
    step(g, [EAST, 0]);
    expect(b.load).toBe(0);
    expect(g.drops.length).toBe(1);
    expect(g.drops[0]!.kg).toBe(10);
    expect(a.load).toBe(0); // далеко — сам в руки не прыгает
  });

  it('упавший тюк забирает тот, кто подошёл; ползущий — не может', () => {
    const { g, a, b } = duel(1.5);
    b.load = 10;
    step(g, [EAST, 0]);
    run(g, [0, 0], 3); // ползущий лежит прямо на своём тюке
    expect(g.drops.length).toBe(1);
    run(g, [EAST, 0], 20); // обидчик подходит
    expect(g.drops.length).toBe(0);
    expect(a.load).toBe(10);
  });

  it('в тюк влезает только сколько есть места, остальное лежит дальше', () => {
    const { g, a, b } = duel(1.5);
    b.load = 10;
    a.load = a.d.carryCap - 4;
    step(g, [EAST, 0]);
    run(g, [EAST, 0], 20);
    expect(a.load).toBe(a.d.carryCap);
    expect(g.drops.length).toBe(1);
    expect(g.drops[0]!.kg).toBeCloseTo(6, 9);
  });
});

describe('кража из чужого стога', () => {
  function atEnemyStack(): { g: Game; a: Player; b: Player } {
    const g = createGame(5, bare(), 2, MAP_MEADOW);
    const a = g.players[0]!;
    const b = g.players[1]!;
    place(a, b.stackX + STACK_RADIUS + 0.8, b.stackY);
    place(b, 5, 5); // хозяин далеко
    b.stacked = 20;
    b.delivered = 20;
    return { g, a, b };
  }

  it('граблями сено из чужого стога идёт в свой тюк', () => {
    const { g, a, b } = atEnemyStack();
    useRake(g, 0);
    const load0 = a.load;
    const stack0 = b.stacked;
    run(g, 0, 30);
    const expected = g.tuning.stealRate * 30 * DT;
    expect(a.load - load0).toBeCloseTo(expected, 6);
    expect(stack0 - b.stacked).toBeCloseTo(expected, 6);
    expect(a.stolen).toBeCloseTo(a.load, 9);
    expect(a.load + b.stacked).toBeCloseTo(20, 9); // ничего не потерялось
  });

  it('с косой в руках сено из стога не тянется', () => {
    const { g, a, b } = atEnemyStack();
    run(g, 0, 30);
    expect(a.load).toBe(0);
    expect(b.stacked).toBe(20);
  });

  it('у обворованного счёт падает, а опыт для улучшений — нет', () => {
    const { g, b } = atEnemyStack();
    useRake(g, 0);
    run(g, 0, 60);
    expect(b.stacked).toBeLessThan(20);
    expect(b.delivered).toBe(20);
  });

  it('больше, чем есть в стоге, не украсть', () => {
    const { g, a, b } = atEnemyStack();
    b.stacked = 1;
    useRake(g, 0);
    run(g, 0, 60);
    expect(b.stacked).toBe(0);
    expect(a.load).toBeCloseTo(1, 9);
  });
});

describe('вдвоём на поле', () => {
  it('игроки не стоят друг в друге', () => {
    const { g, a, b } = duel(0.1);
    useRake(g, 0); // чтобы никто никого не подрезал
    useRake(g, 1);
    run(g, [EAST, WEST], 30);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(g.tuning.heroRadius * 2 - 1e-6);
  });

  it('чужой стог — такое же препятствие, как свой', () => {
    const g = createGame(5, bare(), 2, MAP_MEADOW);
    const a = g.players[0]!;
    const b = g.players[1]!;
    place(a, b.stackX - 4, b.stackY);
    useRake(g, 0);
    run(g, EAST, 90);
    expect(Math.hypot(a.x - b.stackX, a.y - b.stackY)).toBeGreaterThanOrEqual(
      STACK_RADIUS + g.tuning.heroRadius - 1e-6,
    );
  });

  it('полный день двух ботов: оба возят сено, дерутся, масса сохраняется', () => {
    const fresh = createGame(9, cloneTuning(DEFAULT_TUNING), 2);
    const start = totalKg(fresh);
    const { game } = autoplay(9, Infinity, DEFAULT_TUNING, 2);
    const [a, b] = game.players as [Player, Player];
    expect(game.over).toBe(true);
    expect(a.stacked).toBeGreaterThan(10);
    expect(b.stacked).toBeGreaterThan(10);
    expect(a.hits + b.hits).toBeGreaterThan(0);
    // Ноги подрезает коса соперника или — вторым укусом — его собака.
    expect(b.hurt).toBeGreaterThanOrEqual(a.hits);
    expect(b.hurt - a.hits).toBeLessThanOrEqual(a.dogBites);
    expect(a.hurt).toBeGreaterThanOrEqual(b.hits);
    expect(a.hurt - b.hits).toBeLessThanOrEqual(b.dogBites);
    expect(totalKg(game)).toBeCloseTo(start + a.cutKg + b.cutKg, 6);
  });
});

describe('трое и больше', () => {
  it('поле растёт вместе с числом игроков и ещё на 15 % для простора', () => {
    expect(fieldSizeFor(32, 1, 1.15)).toBe(32); // в одиночку поле прежнее
    expect(fieldSizeFor(32, 2, 1.15)).toBe(37);
    expect(fieldSizeFor(32, 3, 1.15)).toBe(45);
    expect(fieldSizeFor(32, 4, 1.15)).toBe(52);
    expect(fieldSizeFor(32, 4, 1)).toBe(45);
    const g = createGame(5, DEFAULT_TUNING, 3);
    expect(g.field.size).toBe(45);
    expect(g.tuning.fieldSize).toBe(45);
    expect(createGame(5).field.size).toBe(32);
    // На каждого приходится не меньше травы, чем в игре вдвоём.
    const duelGame = createGame(5, DEFAULT_TUNING, 2);
    expect(g.field.count / 3).toBeGreaterThan((duelGame.field.count / 2) * 0.9);
  });

  it('у каждого свой стог, старт у своего стога и своё вчерашнее сено', () => {
    for (const n of [3, 4]) {
      const g = createGame(5, DEFAULT_TUNING, n);
      expect(g.players.length).toBe(n);
      for (let i = 0; i < n; i++) {
        const p = g.players[i]!;
        expect(Math.hypot(p.x - p.stackX, p.y - p.stackY)).toBeLessThan(g.tuning.stackReach);
        expect(p.stackX).toBeGreaterThan(4);
        expect(p.stackX).toBeLessThan(g.field.size - 4);
        for (let j = i + 1; j < n; j++) {
          const q = g.players[j]!;
          expect(Math.hypot(p.stackX - q.stackX, p.stackY - q.stackY)).toBeGreaterThan(11);
        }
      }
      expect(totalKg(g)).toBeGreaterThanOrEqual(g.tuning.yesterdayKg * n);
      expect(totalKg(g)).toBeLessThan(g.tuning.yesterdayKg * n + n);
    }
  });

  it('один взмах достаёт всех, кто в секторе', () => {
    const g = createGame(5, bare(), 3, MAP_MEADOW);
    const [a, b, c] = g.players as [Player, Player, Player];
    place(a, 20, 40);
    place(b, 21.5, 40.6);
    place(c, 21.5, 39.4);
    b.dir = 0; // оба стоят к первому спиной
    c.dir = 0;
    b.wound = g.woundTicks; // оба уже ранены — удар подрежет ноги
    c.wound = g.woundTicks;
    // Шаг, на котором первым ходит игрок 0: тогда его не опередят.
    while ((g.tick + 1) % 3 !== 0) step(g, [0, 0, 0]);
    a.dir = 0;
    step(g, [EAST, 0, 0]);
    expect(a.hits).toBe(2);
    expect(b.crawl).toBeGreaterThan(0);
    expect(c.crawl).toBeGreaterThan(0);
  });

  it('ввод третьего игрока доходит до третьего', () => {
    const g = createGame(5, bare(), 3, MAP_MEADOW);
    const c = g.players[2]!;
    place(c, 10, 30);
    const x0 = c.x;
    run(g, [0, 0, EAST], 30);
    expect(c.x).toBeGreaterThan(x0 + 3);
    expect(g.players[0]!.speed).toBe(0);
  });

  it('полный день трёх ботов: все возят сено, масса сохраняется', () => {
    const fresh = createGame(9, DEFAULT_TUNING, 3);
    const start = totalKg(fresh);
    const { game, recorder } = autoplay(9, Infinity, DEFAULT_TUNING, 3);
    expect(game.over).toBe(true);
    let cut = 0;
    for (const p of game.players) {
      expect(p.stacked + p.stolen).toBeGreaterThan(5);
      cut += p.cutKg;
    }
    expect(totalKg(game)).toBeCloseTo(start + cut, 6);
    const replay = makeReplay(9, DEFAULT_TUNING, recorder, 3);
    expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(game));
  });
});
