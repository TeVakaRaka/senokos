// Капкан у стога, находки на поле (точило, сапоги, спички), пожар, дождь и команды 2×2.

import { describe, expect, it } from 'vitest';
import { autoplay } from '../src/sim/autoplay.ts';
import { BONUS_BOOTS, BONUS_KINDS, BONUS_MATCHES, BONUS_WHET } from '../src/sim/bonus.ts';
import { createGame, step, TOOL_RAKE, TOOL_SCYTHE, type Game, type Player } from '../src/sim/game.ts';
import { KENNEL_RADIUS, MAP_MEADOW } from '../src/sim/gen.ts';
import { hashGame } from '../src/sim/hash.ts';
import { isDry } from '../src/sim/hay.ts';
import { makeReplay, runReplay } from '../src/sim/replay.ts';
import { DEFAULT_TUNING, TICK_RATE } from '../src/sim/tuning.ts';
import { bare, EAST, layDryHay, place, run, solid, totalKg, tuftAtDistance, WEST } from './util.ts';

const R = DEFAULT_TUNING.heroRadius;

/** Двое на голом поле: без находок и дождя по расписанию, без остановок на улучшения. */
function pair(patch: Partial<typeof DEFAULT_TUNING> = {}): { g: Game; a: Player; b: Player } {
  const g = createGame(5, bare({ levelKg: [100000], rainRadius: 0, bonusEvery: 0, ...patch }), 2, MAP_MEADOW);
  return { g, a: g.players[0]!, b: g.players[1]! };
}

/** Поставить игрока вплотную к его будке, со стороны стога. */
function atKennel(g: Game, p: Player): void {
  const k = g.kennels[p.id]!;
  const dx = p.stackX - k.x;
  const dy = p.stackY - k.y;
  const len = Math.hypot(dx, dy);
  const off = KENNEL_RADIUS + R + 0.1;
  place(p, k.x + (dx / len) * off, k.y + (dy / len) * off);
}

/** Поставить вора с граблями в круг кражи у стога хозяина. */
function atStack(owner: Player, thief: Player): void {
  place(thief, owner.stackX + 2.6, owner.stackY);
  thief.tool = TOOL_RAKE;
  thief.toolCd = 0;
}

describe('капкан у стога', () => {
  it('взводится у своей будки за 5 кг сена; лишнее идёт уже на собаку', () => {
    const { g, a } = pair();
    const before = totalKg(g);
    atKennel(g, a);
    a.load = g.tuning.trapKg;
    let set = false;
    for (let i = 0; i < 30; i++) {
      step(g, 0);
      if (a.trapSet) set = true;
    }
    expect(set).toBe(true);
    expect(a.trap).toBe(true);
    expect(a.load).toBe(0);
    expect(g.kennels[0]!.kg).toBe(0);
    expect(a.stacked).toBe(0);
    expect(a.delivered).toBeCloseTo(g.tuning.trapKg, 9);
    expect(totalKg(g)).toBeCloseTo(before + g.tuning.trapKg, 9);
    // Капкан уже есть — следующее сено копится на собаку.
    a.load = 4;
    run(g, 0, 30);
    expect(g.kennels[0]!.kg).toBeCloseTo(4, 9);
  });

  it('вор попадает в капкан: стоит три секунды и остаётся ни с чем; капкан одноразовый', () => {
    const { g, a, b } = pair();
    a.trap = true;
    a.stacked = 50;
    place(a, 3, 60);
    atStack(a, b);
    step(g, [0, 0]);
    expect(b.snaredBy).toBe(0);
    expect(a.caught).toBe(1);
    expect(a.trap).toBe(false);
    expect(b.snare).toBe(g.snareTicks);
    expect(g.snareTicks).toBe(g.tuning.trapTime * TICK_RATE);
    expect(b.stolen).toBe(0);
    expect(a.stacked).toBe(50);

    // Пока держит капкан — ни уйти, ни тащить сено.
    const x = b.x;
    run(g, [0, EAST], g.snareTicks - 2);
    expect(b.x).toBe(x);
    expect(b.stolen).toBe(0);
    // Отпустил — можно красть: второго капкана нет.
    run(g, [0, 0], 40);
    expect(b.snare).toBe(0);
    expect(b.stolen).toBeGreaterThan(0);
  });

  it('просто пройти мимо стога можно: капкан ждёт вора или поджигателя', () => {
    const { g, a, b } = pair();
    a.trap = true;
    a.stacked = 50;
    place(a, 3, 60);
    place(b, a.stackX + 2.6, a.stackY);
    b.tool = TOOL_SCYTHE; // без граблей не крадёт
    run(g, [0, 0], 30);
    expect(a.trap).toBe(true);
    expect(b.snare).toBe(0);
  });

  it('пойманный не закрыт от ударов: хозяин успевает и ранить, и подрезать', () => {
    const { g, a, b } = pair();
    a.trap = true;
    a.stacked = 50;
    atStack(a, b);
    place(a, b.x - 1.5, b.y);
    a.dir = 0;
    a.tool = TOOL_SCYTHE;
    let wounded = false;
    let cut = false;
    for (let i = 0; i < g.snareTicks; i++) {
      step(g, [0, 0]);
      if (b.woundedBy === 0) wounded = true;
      if (b.hitBy === 0) cut = true;
    }
    expect(wounded).toBe(true);
    expect(cut).toBe(true);
  });
});

describe('находки на поле', () => {
  it('расписание задаёт зерно: в игре на нескольких — пять за день, виды по кругу; в одиночку — нет', () => {
    expect(createGame(7).bonusPlan).toEqual([]);
    for (const n of [2, 3, 4]) {
      const g = createGame(7, DEFAULT_TUNING, n);
      const plan = g.bonusPlan;
      expect(plan.length).toBe(5);
      for (let i = 0; i < plan.length; i++) {
        const b = plan[i]!;
        expect(b.tick).toBe(Math.round((g.tuning.bonusFirst + i * g.tuning.bonusEvery) * TICK_RATE));
        expect(b.kind).toBe((plan[0]!.kind + i) % BONUS_KINDS);
        // Не у самого стога и не в ларьке.
        for (const p of g.players) expect(Math.hypot(b.x - p.stackX, b.y - p.stackY)).toBeGreaterThan(4);
        expect(Math.hypot(b.x - g.shop!.x, b.y - g.shop!.y)).toBeGreaterThan(3);
      }
      expect(createGame(7, DEFAULT_TUNING, n).bonusPlan).toEqual(plan);
    }
  });

  it('находка появляется в свой час и достаётся тому, кто прошёл рядом', () => {
    const { g, a, b } = pair();
    place(a, 20, 40);
    place(b, 50, 20);
    g.bonusPlan = [{ tick: g.tick + 3, kind: BONUS_WHET, x: 22, y: 40 }];
    run(g, [0, 0], 2);
    expect(g.bonuses.length).toBe(0);
    step(g, [0, 0]);
    expect(g.bonusBorn).toBe(BONUS_WHET);
    expect(g.bonuses.length).toBe(1);
    let got = -1;
    for (let i = 0; i < 30 && got < 0; i++) {
      step(g, [EAST, 0]);
      got = a.bonus;
    }
    expect(got).toBe(BONUS_WHET);
    expect(g.bonuses.length).toBe(0);
    expect(a.sharp).toBe(g.bonusTicks);
    expect(b.sharp).toBe(0);
  });

  it('точило: коса бьёт чаще, пока оно действует', () => {
    const count = (sharp: boolean): number => {
      const g = createGame(5, solid({ levelKg: [100000], rainRadius: 0, bonusEvery: 0 }), 2, MAP_MEADOW);
      const a = g.players[0]!;
      place(a, 20, 40);
      a.tool = TOOL_SCYTHE;
      if (sharp) a.sharp = 100000;
      run(g, [EAST, 0], 300);
      return a.swings;
    };
    const plain = count(false);
    const sharp = count(true);
    expect(plain).toBeGreaterThan(5);
    expect(sharp / plain).toBeGreaterThan(1.5);
    expect(sharp / plain).toBeLessThan(1.8);
  });

  it('сапоги: бег быстрее на треть', () => {
    const dash = (boots: boolean): number => {
      const { g, a } = pair();
      place(a, 10, 40);
      a.tool = TOOL_RAKE;
      if (boots) a.boots = 100000;
      run(g, [EAST, 0], 90);
      return a.x - 10;
    };
    expect(dash(true) / dash(false)).toBeCloseTo(DEFAULT_TUNING.bootsSpeed, 1);
  });

  it('точило и сапоги кончаются через 20 секунд', () => {
    const { g, a } = pair();
    a.sharp = g.bonusTicks;
    a.boots = g.bonusTicks;
    expect(g.bonusTicks).toBe(g.tuning.bonusTime * TICK_RATE);
    run(g, [0, 0], g.bonusTicks - 1);
    expect(a.sharp).toBe(1);
    step(g, [0, 0]);
    expect(a.sharp).toBe(0);
    expect(a.boots).toBe(0);
  });

  it('вторые спички не берёт — оставляет другим', () => {
    const { g, a } = pair();
    place(a, 20, 40);
    a.matches = true;
    g.bonuses.push({ id: 1, kind: BONUS_MATCHES, x: 20.3, y: 40 }, { id: 2, kind: BONUS_BOOTS, x: 20.5, y: 40 });
    step(g, [0, 0]);
    expect(a.bonus).toBe(BONUS_BOOTS);
    expect(g.bonuses.map((b) => b.kind)).toEqual([BONUS_MATCHES]);
  });
});

describe('спички и пожар', () => {
  /** Б со спичками у стога А (в нём 50 кг), сам А далеко. */
  function arsonist(): { g: Game; a: Player; b: Player } {
    const { g, a, b } = pair();
    a.stacked = 50;
    place(a, 3, 60);
    place(b, a.stackX + 2.6, a.stackY);
    b.tool = TOOL_SCYTHE;
    b.matches = true;
    return { g, a, b };
  }

  it('со спичками у чужого стога — он загорается и теряет сено, пока не прогорит', () => {
    const { g, a, b } = arsonist();
    const before = totalKg(g);
    step(g, [0, 0]);
    expect(b.lit).toBe(0);
    expect(a.litBy).toBe(1);
    expect(b.matches).toBe(false);
    expect(a.fire).toBeGreaterThan(0);
    expect(g.fireTicks).toBe(g.tuning.fireTime * TICK_RATE);
    run(g, [0, 0], g.fireTicks + 5);
    const lost = g.tuning.fireRate * g.tuning.fireTime;
    expect(a.fire).toBe(0);
    expect(a.stacked).toBeCloseTo(50 - lost, 6);
    expect(a.burnt).toBeCloseTo(lost, 6);
    expect(g.burntKg).toBeCloseTo(lost, 6);
    expect(totalKg(g)).toBeCloseTo(before, 6); // сгоревшее учтено, сено не пропало «в никуда»
    // Спички были одни: второй раз не поджечь.
    run(g, [0, 0], 30);
    expect(a.fire).toBe(0);
  });

  it('хозяин подошёл к стогу — потушил', () => {
    const { g, a, b } = arsonist();
    step(g, [0, 0]);
    run(g, [0, 0], 30); // секунду горит
    const after = a.stacked;
    expect(after).toBeLessThan(50);
    place(b, 60, 3); // поджигатель ушёл
    place(a, a.stackX + 2, a.stackY - 1.5);
    let doused = false;
    for (let i = 0; i < 5; i++) {
      step(g, [0, 0]);
      if (a.doused) doused = true;
    }
    expect(doused).toBe(true);
    expect(a.fire).toBe(0);
    run(g, [0, 0], 60);
    expect(a.stacked).toBeCloseTo(after, 1); // больше не горит (первый шаг у стога ещё жёг)
  });

  it('пустой стог не горит; свой стог не поджечь', () => {
    const { g, a, b } = arsonist();
    a.stacked = 0;
    run(g, [0, 0], 10);
    expect(a.fire).toBe(0);
    expect(b.matches).toBe(true);
    b.stacked = 30;
    place(b, b.stackX + 2.6, b.stackY);
    run(g, [0, 0], 10);
    expect(b.fire).toBe(0);
    expect(b.matches).toBe(true);
  });

  it('капкан ловит и поджигателя: стог цел, спички остались при нём', () => {
    const { g, a, b } = arsonist();
    a.trap = true;
    step(g, [0, 0]);
    expect(b.snaredBy).toBe(0);
    expect(a.fire).toBe(0);
    expect(b.matches).toBe(true);
    // Капкан отпустил — и вот теперь стог горит.
    run(g, [0, 0], g.snareTicks + 5);
    expect(a.fire).toBeGreaterThan(0);
  });
});

describe('дождь', () => {
  it('туча есть у каждого дня: приходит в своё окно и пересекает поле', () => {
    for (const players of [1, 2, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const g = createGame(seed, DEFAULT_TUNING, players);
        const rain = g.rain!;
        expect(rain.from).toBeGreaterThanOrEqual(g.tuning.rainFrom * TICK_RATE);
        expect(rain.from).toBeLessThanOrEqual(g.tuning.rainTo * TICK_RATE);
        expect(rain.r).toBe(g.tuning.rainRadius);
        // В середине пути туча над полем.
        const mid = (rain.to - rain.from) / 2;
        const x = rain.x0 + rain.vx * mid;
        const y = rain.y0 + rain.vy * mid;
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(g.field.size);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(g.field.size);
        // Скорость — как задано.
        expect(Math.hypot(rain.vx, rain.vy) * TICK_RATE).toBeCloseTo(g.tuning.rainSpeed, 6);
      }
    }
    expect(createGame(3, { ...DEFAULT_TUNING, rainRadius: 0 }).rain).toBeNull();
  });

  it('сухое сено под тучей мокнет, грабли его не берут; уйдёт туча — сохнет заново', () => {
    // Поле с травой: нужен кустик, на который положить сено.
    const g = createGame(5, solid({ levelKg: [100000], rainRadius: 0, bonusEvery: 0 }), 2, MAP_MEADOW);
    const a = g.players[0]!;
    place(a, 20, 40);
    const i = tuftAtDistance(g, a.x, a.y, 4, 8);
    layDryHay(g, i, 3);
    expect(isDry(g, i)).toBe(true);
    const f = g.field;
    // Туча стоит над этим сеном одну секунду.
    g.rain = { x0: f.x[i]!, y0: f.y[i]!, vx: 0, vy: 0, r: 3, from: g.tick + 1, to: g.tick + 30 };
    run(g, [0, 0], 30);
    expect(isDry(g, i)).toBe(false);
    // Игрок с граблями стоит на мокром сене — оно остаётся лежать.
    place(a, f.x[i]!, f.y[i]!);
    a.tool = TOOL_RAKE;
    run(g, [0, 0], g.dryTicks - 2);
    expect(a.load).toBe(0);
    expect(f.hay[i]).toBe(3);
    // Досохло — сгребается.
    run(g, [0, 0], 5);
    expect(a.load).toBeCloseTo(3, 9);
  });

  it('сено в тюке и в стоге дождя не боится; масса сохраняется', () => {
    const { g, a } = pair();
    const before = totalKg(g);
    a.load = 10;
    a.stacked = 20;
    g.rain = { x0: a.x, y0: a.y, vx: 0, vy: 0, r: 30, from: g.tick + 1, to: g.tick + 60 };
    run(g, [0, 0], 60);
    expect(a.load + a.stacked).toBeCloseTo(30, 9); // тюк у своего стога просто выгрузился
    expect(totalKg(g)).toBeCloseTo(before + 30, 9);
  });
});

describe('команды 2×2', () => {
  function squads(): { g: Game; p: Player[] } {
    const g = createGame(5, bare({ levelKg: [100000], rainRadius: 0, bonusEvery: 0 }), 4, MAP_MEADOW, true);
    return { g, p: g.players };
  }

  it('вчетвером командами: 0 и 2 против 1 и 3, у команды общий стог, будки по разные стороны', () => {
    const { g, p } = squads();
    expect(g.team).toEqual([0, 1, 0, 1]);
    expect([p[0]!.stackX, p[0]!.stackY]).toEqual([p[2]!.stackX, p[2]!.stackY]);
    expect([p[1]!.stackX, p[1]!.stackY]).toEqual([p[3]!.stackX, p[3]!.stackY]);
    expect(p[0]!.stackX).toBeLessThan(g.tuning.fieldSize / 2);
    expect(p[1]!.stackX).toBeGreaterThan(g.tuning.fieldSize / 2);
    // Стартуют не друг в друге, будки не одна на другой.
    expect(Math.hypot(p[0]!.x - p[2]!.x, p[0]!.y - p[2]!.y)).toBeGreaterThan(2);
    expect(Math.hypot(g.kennels[0]!.x - g.kennels[2]!.x, g.kennels[0]!.y - g.kennels[2]!.y)).toBeGreaterThan(6);
    // Без команд у каждого свой стог, а втроём и вдвоём команд не бывает.
    expect(createGame(5, DEFAULT_TUNING, 4).team).toEqual([0, 1, 2, 3]);
    expect(createGame(5, DEFAULT_TUNING, 2, -1, true).team).toEqual([0, 1]);
  });

  it('своих коса не трогает, чужих — как всегда', () => {
    const { g, p } = squads();
    const [a, foe, mate] = p as [Player, Player, Player];
    place(a, 20, 40);
    a.dir = 0;
    a.tool = TOOL_SCYTHE;
    place(mate, 21.5, 40);
    place(foe, 21.5, 40.4);
    foe.tool = TOOL_RAKE; // чтобы сам никого не задел косой
    mate.tool = TOOL_RAKE;
    step(g, [0, 0, 0, 0]);
    expect(mate.woundedBy).toBe(-1);
    expect(foe.woundedBy).toBe(0);
  });

  it('у своих не крадут; у чужого общего стога тащат с обычной скоростью, а не вдвое', () => {
    const { g, p } = squads();
    const [a, thief, mate] = p as [Player, Player, Player];
    a.stacked = 1;
    mate.stacked = 50;
    place(a, 3, 60);
    // Напарник с граблями у своего же стога — ничего не берёт.
    place(mate, a.stackX + 2.6, a.stackY);
    mate.tool = TOOL_RAKE;
    run(g, [0, 0, 0, 0], 30);
    expect(mate.stolen).toBe(0);
    place(mate, 3, 58);
    // Чужой — тащит, сначала у одного напарника, потом у другого: за секунду — stealRate.
    atStack(a, thief);
    run(g, [0, 0, 0, 0], 30);
    expect(thief.stolen).toBeCloseTo(g.tuning.stealRate, 6);
    expect(a.stacked + mate.stacked).toBeCloseTo(51 - g.tuning.stealRate, 6);
  });

  it('капкан напарника стережёт общий стог; пожар тушит любой из своих', () => {
    const { g, p } = squads();
    const [a, thief, mate] = p as [Player, Player, Player];
    a.stacked = 30;
    mate.trap = true;
    place(a, 3, 60);
    place(mate, 3, 58);
    atStack(a, thief);
    step(g, [0, 0, 0, 0]);
    expect(thief.snaredBy).toBe(2);
    expect(mate.caught).toBe(1);

    thief.snare = 0;
    thief.matches = true;
    thief.tool = TOOL_SCYTHE;
    step(g, [0, 0, 0, 0]);
    expect(a.fire).toBeGreaterThan(0); // огонь числится на первом из напарников
    place(thief, 60, 3);
    place(mate, a.stackX + 2, a.stackY - 1.5);
    let doused = false;
    for (let i = 0; i < 5; i++) {
      step(g, [0, 0, 0, 0]);
      if (mate.doused) doused = true;
    }
    expect(doused).toBe(true);
    expect(a.fire).toBe(0);
  });

  it('полный день четырёх ботов командами воспроизводится по записи; масса сохраняется', () => {
    const fresh = createGame(11, DEFAULT_TUNING, 4, -1, true);
    const start = totalKg(fresh);
    const first = autoplay(11, Infinity, DEFAULT_TUNING, 4, true);
    const g = first.game;
    expect(g.over).toBe(true);
    let cut = 0;
    for (const q of g.players) cut += q.cutKg;
    expect(totalKg(g)).toBeCloseTo(start + cut, 5);
    const replay = makeReplay(11, DEFAULT_TUNING, first.recorder, 4, true);
    expect(hashGame(runReplay(replay, DEFAULT_TUNING))).toBe(hashGame(g));
    // Та же запись без команд — уже другая игра.
    expect(hashGame(runReplay({ ...replay, teams: false }, DEFAULT_TUNING))).not.toBe(hashGame(g));
    void WEST;
  });
});
