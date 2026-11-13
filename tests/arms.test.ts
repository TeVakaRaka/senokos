// Ларёк с ружьём в центре поля, будки у стогов и собаки-сторожа.

import { describe, expect, it } from 'vitest';
import { shopLeader } from '../src/sim/arms.ts';
import { dirFromVector } from '../src/sim/dirs.ts';
import { createGame, INPUT_SWAP, step, TOOL_RAKE, TOOL_SCYTHE, type Dog, type Game, type Player } from '../src/sim/game.ts';
import { KENNEL_RADIUS, MAP_MEADOW, SHOP_RADIUS } from '../src/sim/gen.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';
import { bare, EAST, place, run, totalKg, WEST } from './util.ts';

const R = DEFAULT_TUNING.heroRadius;

/**
 * Двое на голом поле 64 м: стоги по бокам, магазин в центре (32, 32). Пороги улучшений
 * высокие, чтобы выбор карточки не останавливал время посреди проверки.
 */
function pair(): { g: Game; a: Player; b: Player } {
  const g = createGame(5, bare({ levelKg: [100000] }), 2, MAP_MEADOW);
  return { g, a: g.players[0]!, b: g.players[1]!};
}

/** Поставить игрока вплотную к прилавку: с запада (side = −1) или с востока (side = 1). */
function atCounter(g: Game, p: Player, side: number): void {
  const shop = g.shop!;
  place(p, shop.x + side * (SHOP_RADIUS + R + 0.1), shop.y);
  p.dir = side < 0 ? 0 : 32; // лицом к магазину
}

/** Поставить игрока вплотную к будке, со стороны своего стога. */
function atKennel(g: Game, p: Player, owner = p.id): void {
  const k = g.kennels[owner]!;
  const o = g.players[owner]!;
  const dx = o.stackX - k.x;
  const dy = o.stackY - k.y;
  const len = Math.hypot(dx, dy);
  const off = KENNEL_RADIUS + R + 0.1;
  place(p, k.x + (dx / len) * off, k.y + (dy / len) * off);
}

/**
 * Купить собаку игроку id: сдать сено в будку. Капкан считаем уже взведённым (иначе первые
 * килограммы ушли бы на него), а после покупки снимаем — чтобы проверять одну только собаку.
 * Потом хозяин уходит в дальний угол — не мешать.
 */
function buyDog(g: Game, id: number): Dog {
  const p = g.players[id]!;
  atKennel(g, p);
  p.trap = true;
  p.load = g.tuning.dogKg;
  for (let i = 0; i < 60 && !g.dogs[id]; i++) step(g, 0);
  p.trap = false;
  place(p, 3, 60);
  return g.dogs[id]!;
}

/** Дать ружьё игроку id (как будто купил), с запасом патронов. */
function arm(g: Game, id: number, ammo = 20): void {
  g.shop!.sold = true;
  g.gun = { holder: id, x: 0, y: 0, cd: 0, ammo };
}

describe('ларёк в центре поля', () => {
  it('магазин и будки есть только в игре на нескольких', () => {
    const solo = createGame(5);
    expect(solo.shop).toBeNull();
    expect(solo.kennels).toEqual([]);
    expect(solo.dogs).toEqual([]);

    for (const n of [2, 3, 4]) {
      const g = createGame(5, DEFAULT_TUNING, n);
      const size = g.tuning.fieldSize;
      expect(g.shop!.x).toBe(size / 2);
      expect(g.shop!.y).toBe(size / 2);
      expect(g.kennels.length).toBe(n);
      expect(g.dogs).toEqual(new Array(n).fill(null));
      // Вокруг магазина — голая площадка: подойти к прилавку ничто не мешает.
      for (let i = 0; i < g.field.count; i++) {
        expect(Math.hypot(g.field.x[i]! - g.shop!.x, g.field.y[i]! - g.shop!.y)).toBeGreaterThan(4);
      }
      // Будка — у своего стога, но так, что от магазина к ней можно дойти по прямой,
      // не заходя в круг выгрузки в стог (иначе тюк уйдёт в стог по дороге).
      for (const p of g.players) {
        const k = g.kennels[p.id]!;
        expect(Math.hypot(k.x - p.stackX, k.y - p.stackY)).toBeLessThan(7);
        const sx = k.x - g.shop!.x;
        const sy = k.y - g.shop!.y;
        const len2 = sx * sx + sy * sy;
        const u = Math.max(0, Math.min(1, ((p.stackX - g.shop!.x) * sx + (p.stackY - g.shop!.y) * sy) / len2));
        const gap = Math.hypot(g.shop!.x + sx * u - p.stackX, g.shop!.y + sy * u - p.stackY);
        expect(gap).toBeGreaterThan(g.tuning.stackReach + 0.5);
      }
    }
  });

  it('у прилавка тюк уходит в магазин: стог не растёт, опыт для улучшений растёт', () => {
    const { g, a } = pair();
    atCounter(g, a, -1);
    a.load = 10;
    run(g, 0, 30);
    expect(a.load).toBe(0);
    expect(g.shop!.kg).toBeCloseTo(10, 9);
    expect(g.shop!.given[0]).toBeCloseTo(10, 9);
    expect(a.stacked).toBe(0);
    expect(a.delivered).toBeCloseTo(10, 9);
  });

  it('на ходу сено в ларёк не уходит: надо остановиться у прилавка', () => {
    const { g, a } = pair();
    atCounter(g, a, -1);
    a.load = 10;
    run(g, EAST, 12); // идёт прямо на прилавок и упирается в него
    expect(a.load).toBe(10);
    run(g, 17, 6); // идёт на север, вдоль прилавка
    expect(a.load).toBe(10);
    expect(g.shop!.kg).toBe(0);
    atCounter(g, a, -1);
    run(g, 0, g.dwellTicks - 1); // отпустил палец на миг — ещё не считается
    expect(a.load).toBe(10);
    run(g, 0, 1); // простоял четверть секунды — сено пошло
    expect(a.load).toBeLessThan(10);
    run(g, 0, 12);
    expect(a.load).toBe(0);
    expect(g.shop!.kg).toBeCloseTo(10, 9);
  });

  it('перехват пальца у прилавка сено не отдаёт: короткие остановки не в счёт', () => {
    const { g, a } = pair();
    atCounter(g, a, -1);
    a.load = 10;
    for (let i = 0; i < 20; i++) {
      run(g, 0, g.dwellTicks - 2); // стоит чуть меньше четверти секунды
      run(g, EAST, 1); // и снова жмёт на прилавок
    }
    expect(a.load).toBe(10);
    expect(g.shop!.kg).toBe(0);
  });

  it('цена ружья — 15 кг на каждого игрока: вдвоём 30, вчетвером 60', () => {
    expect(createGame(5, DEFAULT_TUNING, 2).shopKg).toBe(30);
    expect(createGame(5, DEFAULT_TUNING, 4).shopKg).toBe(60);
  });

  it('ружьё получает тот, кто сдал больше всех, а не тот, кто досыпал последним', () => {
    const { g, a, b } = pair();
    g.shopKg = 100; // проверяем на круглой сумме
    atCounter(g, a, -1);
    atCounter(g, b, 1);
    a.load = 60;
    run(g, 0, 60);
    expect(g.shop!.kg).toBeCloseTo(60, 9);
    expect(g.gun).toBeNull();

    // Б досыпает остаток — котёл полон, но больше сдал А: ружьё его.
    b.load = 50;
    let got = -1;
    for (let i = 0; i < 60; i++) {
      step(g, 0);
      if (a.gotGun) got = 0;
      if (b.gotGun) got = 1;
    }
    expect(got).toBe(0);
    expect(g.shop!.sold).toBe(true);
    expect(g.shop!.kg).toBe(g.shopKg);
    expect(g.shop!.given[0]).toBeCloseTo(60, 9);
    expect(g.shop!.given[1]).toBeCloseTo(g.shopKg - 60, 9);
    expect(g.gun!.holder).toBe(0);
    // Б стоит у прилавка дальше — и на остаток сена ларёк тут же продаёт ему бронежилет.
    expect(b.armor).toBe(g.tuning.vestHits);
    expect(b.load).toBeCloseTo(50 - (g.shopKg - 60) - g.tuning.vestKg, 9);
    expect(g.gun!.ammo).toBe(g.tuning.gunShells); // двустволка выходит заряженной

    // Ружьё одно на день: в котёл ларёк сено больше не берёт (дальше он торгует — см. ниже).
    expect(g.shop!.kg).toBe(g.shopKg);
    a.load = 3;
    run(g, 0, 30);
    expect(g.shop!.kg).toBe(g.shopKg);
    expect(g.shop!.given[0]).toBeCloseTo(60, 9);
  });

  it('при равенстве ружьё у того, кто раньше набрал своё, — где бы он ни был', () => {
    const shop = { x: 0, y: 0, kg: 0, sold: false, stamp: 3, ammoKg: [], vestKg: [] };
    expect(shopLeader({ ...shop, given: [0, 0], since: [0, 0] })).toBe(-1);
    expect(shopLeader({ ...shop, given: [5, 9, 7], since: [1, 2, 3] })).toBe(1);
    expect(shopLeader({ ...shop, given: [10, 10, 1], since: [2, 1, 3] })).toBe(1);
    expect(shopLeader({ ...shop, given: [10, 10, 1], since: [1, 2, 3] })).toBe(0);

    // Трое: А и Б сдали поровну (Б — раньше), В досыпает последний килограмм.
    const g = createGame(5, bare({ levelKg: [100000] }), 3, MAP_MEADOW);
    const [a, b, c] = g.players as [Player, Player, Player];
    g.shopKg = 21;
    g.shop!.kg = 20;
    g.shop!.given = [10, 10, 0];
    g.shop!.since = [2, 1, 0];
    g.shop!.stamp = 2;
    place(b, 3, 3); // Б далеко от ларька
    atCounter(g, c, -1);
    c.load = 5;
    run(g, [0, 0, 0], g.dwellTicks + 3);
    expect(g.shop!.sold).toBe(true);
    expect(g.gun!.holder).toBe(1);
    expect(a.gotGun || b.shotHits > 0).toBe(false);
    // Остаток сена В ларёк берёт уже в счёт бронежилета.
    run(g, [0, 0, 0], 6);
    expect(c.load).toBe(0);
    expect(g.shop!.vestKg[2]).toBeCloseTo(4, 9);
    expect(c.armor).toBe(0);
  });
});

describe('ружьё', () => {
  /** А с ружьём в (20, 40) смотрит на восток, Б — правее на dx, спиной к нему. */
  function duel(dx: number, dy = 0): { g: Game; a: Player; b: Player } {
    const { g, a, b } = pair();
    place(a, 20, 40);
    place(b, 20 + dx, 40 + dy);
    a.dir = 0;
    b.dir = 0;
    a.tool = TOOL_SCYTHE; // ружьё стреляет только с косой в руках
    arm(g, 0);
    return { g, a, b };
  }

  it('стреляет само, когда соперник перед стволом: отбрасывает и надолго валит', () => {
    const { g, a, b } = duel(1.5);
    const x0 = b.x;
    step(g, [EAST, 0]);
    expect(a.shot).not.toBeNull();
    expect(a.shot!.victim).toBe(1);
    expect(b.shotBy).toBe(0);
    expect(a.shotHits).toBe(1);
    expect(b.shotDown).toBe(1);
    expect(b.down).toBe(g.flyTicks + g.downTicks);
    expect(g.gun!.cd).toBe(g.gunTicks);

    run(g, [0, 0], g.flyTicks);
    expect(b.x - x0).toBeCloseTo(g.tuning.gunKnockback, 6); // отлетел
    // Лежит дольше, чем ползает подрезанный, и не может ни идти, ни бить.
    expect(g.downTicks).toBeGreaterThan(g.crawlTicks);
    const x1 = b.x;
    run(g, [0, WEST], g.downTicks - 2);
    expect(b.x).toBe(x1);
    expect(b.swings).toBe(0);
    run(g, [0, WEST], 10);
    expect(b.down).toBe(0);
    expect(b.x).toBeLessThan(x1); // встал и пошёл
  });

  it('не стреляет в пустоту, за спину и дальше косы', () => {
    for (const dx of [-1.5, DEFAULT_TUNING.reach + R + 0.3]) {
      const { g, a, b } = duel(dx);
      run(g, [0, 0], 5); // стоит лицом на восток
      expect(a.shot).toBeNull();
      expect(g.gun!.cd).toBe(0);
      expect(b.down).toBe(0);
    }
  });

  it('бьёт узким конусом: сбоку под 45° ружьё мимо, а коса достаёт', () => {
    const { g, a, b } = duel(1.5 * Math.SQRT1_2, 1.5 * Math.SQRT1_2);
    step(g, [EAST, 0]);
    expect(a.shot).toBeNull();
    expect(b.down).toBe(0);
    expect(b.woundedBy).toBe(0);
  });

  it('с граблями ружьё молчит; взял косу — стреляет', () => {
    const { g, a, b } = duel(1.5);
    a.tool = TOOL_RAKE;
    run(g, [0, 0], 30);
    expect(a.shot).toBeNull();
    expect(b.down).toBe(0);
    expect(g.gun!.cd).toBe(0);

    step(g, [INPUT_SWAP, 0]); // берёт косу
    let shotAt = -1;
    for (let i = 1; i <= 40 && shotAt < 0; i++) {
      step(g, [0, 0]);
      if (a.shot) shotAt = i;
    }
    expect(shotAt).toBeGreaterThanOrEqual(g.swapTicks - 1); // пока меняет инструмент — не стреляет
    expect(shotAt).toBeLessThanOrEqual(g.swapTicks + 1);
    expect(b.down).toBeGreaterThan(0);
  });

  it('стреляет реже, чем бьёт коса', () => {
    const { g, a } = duel(1.5);
    expect(g.gunTicks).toBeGreaterThan(a.d.swingTicks);
  });

  it('тюк от выстрела не спасает: падает на месте, стрелок его подбирает', () => {
    const { g, a, b } = duel(1.5);
    b.tool = TOOL_RAKE;
    b.load = 16;
    step(g, [EAST, 0]);
    expect(b.down).toBeGreaterThan(0);
    expect(b.load).toBe(0);
    expect(g.drops.length).toBe(1);
    expect(g.drops[0]!.x).toBeCloseTo(21.5, 9);
    run(g, [EAST, 0], 20);
    expect(a.load).toBe(16);
  });

  it('раненый в передышке не стреляет', () => {
    const { g, a, b } = duel(1.5);
    a.wound = g.woundTicks;
    a.shield = g.graceTicks;
    step(g, [EAST, 0]);
    expect(a.shot).toBeNull();
    expect(b.down).toBe(0);
  });

  it('кому подрезали ноги, тот роняет ружьё; поднимает любой, кроме ползущего', () => {
    const { g, a, b } = duel(1.5);
    g.gun!.holder = 1; // ружьё у Б, а он стоит к А спиной
    b.wound = g.woundTicks; // уже ранен — следующий удар подрежет
    step(g, [EAST, 0]);
    expect(b.crawl).toBeGreaterThan(0);
    expect(b.lostGun).toBe(true);
    expect(g.gun!.holder).toBe(-1);
    expect(g.gun!.x).toBeCloseTo(21.5, 9);
    run(g, [0, 0], 5); // ползущий лежит прямо на ружье — поднять не может
    expect(g.gun!.holder).toBe(-1);
    let got = false;
    for (let i = 0; i < 20; i++) {
      step(g, [EAST, 0]);
      if (a.gotGun) got = true;
    }
    expect(got).toBe(true);
    expect(g.gun!.holder).toBe(0);
  });

  /** Поставить Б перед стволом А заново: цел, не под защитой, ружьё готово, коса — нет. */
  function again(g: Game, a: Player, b: Player): void {
    place(b, a.x + 1.5, a.y);
    b.down = 0;
    b.fly = 0;
    b.shield = 0;
    b.wound = 0;
    g.gun!.cd = 0;
    a.swingCd = 1000; // коса пока не мешает
  }

  it('каждый выстрел тратит патрон; пустое ружьё только щёлкает — и тогда бьёт коса', () => {
    const { g, a, b } = duel(1.5);
    g.gun!.ammo = 2;
    again(g, a, b);
    step(g, [0, 0]);
    expect(a.shot).not.toBeNull();
    expect(g.gun!.ammo).toBe(1);
    again(g, a, b);
    step(g, [0, 0]);
    expect(b.down).toBeGreaterThan(0);
    expect(g.gun!.ammo).toBe(0);

    again(g, a, b);
    a.swingCd = 0; // а теперь коса готова
    step(g, [0, 0]);
    expect(a.shot).toBeNull();
    expect(a.dryFire).toBe(true);
    expect(g.gun!.ammo).toBe(0);
    expect(b.down).toBe(0);
    expect(b.woundedBy).toBe(0); // без патронов хозяин ружья — обычный косарь
    step(g, [0, 0]);
    expect(a.dryFire).toBe(false); // щёлкает не каждый шаг, а в темпе выстрелов
  });

  it('хозяин ружья покупает в ларьке патроны: пачка в 10 штук за 10 кг, остаток копится', () => {
    const { g, a, b } = pair();
    arm(g, 0, 0);
    const before = totalKg(g);
    atCounter(g, a, -1);
    a.load = 16;
    let bought = 0;
    for (let i = 0; i < 40; i++) {
      step(g, 0);
      bought += a.ammoBought;
    }
    expect(bought).toBe(10);
    expect(g.gun!.ammo).toBe(10);
    expect(a.load).toBe(0);
    expect(g.shop!.ammoKg[0]).toBeCloseTo(6, 9); // шесть килограммов — в счёт следующей пачки
    expect(a.stacked).toBe(0);
    expect(a.delivered).toBeCloseTo(16, 9);
    a.load = 4;
    run(g, 0, 30);
    expect(g.gun!.ammo).toBe(20);
    expect(g.shop!.ammoKg[0]).toBeCloseTo(0, 9);
    expect(totalKg(g)).toBeCloseTo(before + 20, 9);
    // Жилет хозяину ружья не продают, а патроны — только ему.
    expect(a.armor).toBe(0);
    atCounter(g, b, 1);
    b.load = 3;
    run(g, [0, 0], 30);
    expect(g.gun!.ammo).toBe(20);
    expect(g.shop!.ammoKg[1]).toBe(0);
  });

  it('остальным ларёк продаёт бронежилет за 10 кг: три выстрела держит, четвёртый валит', () => {
    const { g, a, b } = duel(1.5);
    const before = totalKg(g);
    atCounter(g, b, 1);
    b.load = 16;
    let bought = false;
    for (let i = 0; i < 40; i++) {
      step(g, [0, 0]);
      if (b.vestBought) bought = true;
    }
    expect(bought).toBe(true);
    expect(b.armor).toBe(g.tuning.vestHits);
    expect(b.load).toBeCloseTo(6, 9); // лишнее сено осталось в тюке
    expect(g.shop!.vestKg[1]).toBe(0);
    expect(totalKg(g)).toBeCloseTo(before + 16, 9);
    // Целый жилет второй раз не продают.
    run(g, [0, 0], 30);
    expect(b.load).toBeCloseTo(6, 9);

    b.tool = TOOL_RAKE;
    const ammo = g.gun!.ammo;
    for (let hit = 1; hit <= g.tuning.vestHits; hit++) {
      again(g, a, b);
      step(g, [0, 0]);
      expect(a.shot!.blocked).toBe(true);
      expect(b.armorHitBy).toBe(0);
      expect(b.armor).toBe(g.tuning.vestHits - hit);
      expect(b.down).toBe(0); // на ногах
      expect(b.load).toBeCloseTo(6, 9); // и при тюке
      expect(g.gun!.ammo).toBe(ammo - hit); // а патрон потрачен
    }
    again(g, a, b);
    step(g, [0, 0]);
    expect(a.shot!.blocked).toBe(false);
    expect(b.down).toBeGreaterThan(0);
    expect(b.load).toBe(0);

    // Побитый жилет можно сменить на новый.
    again(g, a, b);
    b.armor = 1;
    atCounter(g, b, 1);
    b.load = 10;
    run(g, [0, 0], 40);
    expect(b.armor).toBe(g.tuning.vestHits);
    expect(b.load).toBeCloseTo(0, 9);
  });

  it('от косы бронежилет не спасает', () => {
    const { g, b } = duel(1.5);
    g.gun = null; // у А просто коса
    b.armor = 3;
    step(g, [0, 0]);
    expect(b.woundedBy).toBe(0);
    expect(b.armor).toBe(3);
  });

  it('масса сена сохраняется, когда его сдают в магазин', () => {
    const { g, a } = pair();
    const before = totalKg(g);
    atCounter(g, a, -1);
    a.load = 30;
    run(g, 0, 40);
    expect(totalKg(g)).toBeCloseTo(before + 30, 9);
  });
});

describe('будка и собака', () => {
  it('сено в свою будку: сначала капкан, потом собака; будка опустела', () => {
    const { g, a } = pair();
    const before = totalKg(g);
    const price = g.tuning.trapKg + g.tuning.dogKg;
    atKennel(g, a);
    a.load = price + 5;
    let born = false;
    let trapAt = -1;
    for (let i = 0; i < 60; i++) {
      step(g, 0);
      if (a.trapSet) trapAt = i;
      if (a.dogBorn) {
        born = true;
        expect(trapAt).toBeGreaterThanOrEqual(0); // капкан — раньше собаки
      }
    }
    expect(a.trap).toBe(true);
    expect(born).toBe(true);
    expect(g.dogs[0]).not.toBeNull();
    expect(g.dogs[1]).toBeNull();
    expect(g.kennels[0]!.kg).toBe(0);
    expect(g.kennels[0]!.trapKg).toBe(0);
    expect(g.spentKg).toBeCloseTo(price, 9);
    expect(a.load).toBeCloseTo(5, 9);
    expect(a.delivered).toBeCloseTo(price, 9);
    expect(a.stacked).toBe(0);
    expect(totalKg(g)).toBeCloseTo(before + price + 5, 9);
    // Пока собака жива, будка сено не берёт.
    run(g, 0, 20);
    expect(a.load).toBeCloseTo(5, 9);
  });

  it('на ходу сено в будку не уходит: надо остановиться', () => {
    const { g, a } = pair();
    atKennel(g, a);
    a.trap = true; // капкан уже взведён — сено пойдёт на собаку
    a.load = 10;
    const k = g.kennels[0]!;
    run(g, dirFromVector(k.x - a.x, k.y - a.y) + 1, 12); // идёт прямо на будку
    expect(a.load).toBe(10);
    expect(k.kg).toBe(0);
    run(g, 0, g.dwellTicks + 12);
    expect(a.load).toBe(0);
    expect(k.kg).toBeCloseTo(10, 9);
  });

  it('свой стог берёт сено с любой стороны, даже если не отпускать палец', () => {
    // Раньше правило «иду к будке» мешало выгрузке с десятка направлений.
    const { g, a } = pair();
    let expected = 0;
    for (let d = 0; d < 64; d++) {
      const turn = (d / 64) * Math.PI * 2;
      place(a, a.stackX + Math.cos(turn) * 4.5, a.stackY + Math.sin(turn) * 4.5);
      a.tool = TOOL_RAKE;
      a.load = 16;
      expected += 16;
      for (let i = 0; i < 40; i++) step(g, dirFromVector(a.stackX - a.x, a.stackY - a.y) + 1);
      expect(a.load, `направление ${d}`).toBe(0);
    }
    expect(a.stacked).toBeCloseTo(expected, 6);
    expect(g.kennels[0]!.kg).toBe(0);
  });

  it('в чужую будку сено не сдать', () => {
    const { g, b } = pair();
    atKennel(g, b, 0);
    b.load = 30;
    run(g, 0, 30);
    expect(b.load).toBe(30);
    expect(g.dogs[0]).toBeNull();
  });

  it('собака бросается на чужого у стога: укушенный роняет тюк и ранен, второй укус — ноги', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    place(b, a.stackX + 2.6, a.stackY); // у чужого стога
    b.tool = TOOL_RAKE;
    b.load = 10;
    let bites = 0;
    for (let i = 0; i < 200 && bites === 0; i++) {
      step(g, 0);
      if (b.bitBy === 0) bites++;
    }
    expect(bites).toBe(1);
    expect(dog.target).toBe(1);
    expect(b.load).toBe(0);
    expect(g.drops.length).toBe(1);
    expect(b.wound).toBeGreaterThan(0);
    expect(b.crawl).toBe(0);
    expect(a.dogBites).toBe(1);
    // Стоит на месте — после передышки второй укус подрезает ноги, собака идёт домой.
    for (let i = 0; i < 120 && b.crawl === 0; i++) step(g, 0);
    expect(b.crawl).toBeGreaterThan(0);
    expect(dog.target).toBe(-1);
    expect(a.bitBy).toBe(-1); // хозяина не трогает
  });

  it('хозяина и тех, кто далеко от стога, собака не трогает', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    place(a, a.stackX + 2, a.stackY);
    place(b, a.stackX + 9, a.stackY);
    run(g, 0, 120);
    expect(dog.target).toBe(-1);
    expect(a.wound + b.wound).toBe(0);
  });

  it('дальше поводка не гонится', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    place(b, a.stackX + 3, a.stackY);
    b.shield = 100000; // кусать нельзя — проверяем только погоню
    b.tool = TOOL_RAKE;
    run(g, [0, 0], 30);
    expect(dog.target).toBe(1);
    run(g, [0, EAST], 120); // убегает на восток
    expect(Math.hypot(b.x - a.stackX, b.y - a.stackY)).toBeGreaterThan(g.tuning.dogLeash);
    expect(dog.target).toBe(-1);
    expect(Math.hypot(dog.x - a.stackX, dog.y - a.stackY)).toBeLessThan(g.tuning.dogLeash + 1);
  });

  it('к тому, у кого коса, собака заходит со спины', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    // Б стоит у стога лицом к будке, откуда выбежит собака, и ни разу не поворачивается.
    place(b, a.stackX + 3, a.stackY);
    b.dir = 32; // на запад, к стогу и будке
    let at: { x: number; y: number } | null = null;
    for (let i = 0; i < 300 && !at; i++) {
      step(g, 0);
      if (b.bitBy === 0) at = { x: dog.x, y: dog.y };
    }
    expect(at).not.toBeNull();
    // В момент укуса собака у Б за спиной (Б смотрит на запад — значит, она восточнее).
    expect(at!.x).toBeGreaterThan(b.x);
    expect(b.dogCuts).toBe(0); // коса её так и не достала
  });

  it('коса подрезает собаке ноги: ползает и не кусает, потом встаёт', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    place(b, a.stackX + 3, a.stackY);
    b.dir = 32;
    dog.x = b.x - 1.5; // прямо перед косой
    dog.y = b.y;
    step(g, [0, WEST]);
    expect(b.swing).not.toBeNull();
    expect(b.swing!.dog).toBe(0);
    expect(dog.crawl).toBeGreaterThan(0);
    expect(dog.hurtBy).toBe(1);
    expect(a.dogHurt).toBe(true);
    expect(b.dogCuts).toBe(1);
    // Пока ползает — не кусает, даже если стоять рядом.
    place(b, dog.x + 0.9, dog.y);
    b.tool = TOOL_RAKE;
    for (let i = 0; i < g.dogCrawlTicks - 5; i++) {
      step(g, 0);
      expect(b.bitBy).toBe(-1);
    }
    run(g, 0, 10);
    expect(dog.crawl).toBe(0);
  });

  it('собака замечает того, кто подошёл к ней самой, и под косу не лезет', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    const k = g.kennels[0]!;
    const len = Math.hypot(a.stackX - k.x, a.stackY - k.y);
    const ux = (a.stackX - k.x) / len;
    const uy = (a.stackY - k.y) / len;
    // Вор с косой заходит со стороны будки: до стога далеко, сторожевой круг он не задевает.
    place(b, dog.x - ux * 6, dog.y - uy * 6);
    b.tool = TOOL_SCYTHE;
    expect(Math.hypot(b.x - a.stackX, b.y - a.stackY)).toBeGreaterThan(g.tuning.dogGuard + 2);
    let noticedAt = -1;
    let closest = Infinity;
    for (let i = 0; i < 120; i++) {
      step(g, [0, dirFromVector(dog.x - b.x, dog.y - b.y) + 1]); // идёт на собаку, держа её перед собой
      const dist = Math.hypot(dog.x - b.x, dog.y - b.y);
      if (noticedAt < 0 && dog.target === 1) noticedAt = dist;
      if (dist < closest) closest = dist;
    }
    expect(noticedAt).toBeGreaterThan(b.d.reach + 0.6); // заметила раньше, чем коса дотянется
    expect(noticedAt).toBeLessThanOrEqual(g.tuning.dogNear);
    expect(b.dogCuts).toBe(0); // четыре секунды погони — лапы целы
    expect(closest).toBeGreaterThan(b.d.reach + 0.3 + 0.15); // 0,3 — радиус собаки
    expect(b.bitBy).toBe(-1); // и в лоб на косу она не бросалась
  });

  it('от косы собака уходит, а от ружья нет: оно достаёт её на круге обхода', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    arm(g, 1);
    const k = g.kennels[0]!;
    const len = Math.hypot(a.stackX - k.x, a.stackY - k.y);
    place(b, dog.x - ((a.stackX - k.x) / len) * 6, dog.y - ((a.stackY - k.y) / len) * 6);
    b.tool = TOOL_SCYTHE;
    let shotAt = -1;
    for (let i = 0; i < 120 && shotAt < 0; i++) {
      step(g, [0, dirFromVector(dog.x - b.x, dog.y - b.y) + 1]); // идёт на собаку
      if (b.shot) shotAt = Math.hypot(b.shot.tx - b.shot.x, b.shot.ty - b.shot.y);
    }
    expect(g.dogs[0]).toBeNull();
    expect(b.dogsKilled).toBe(1);
    expect(b.dogCuts).toBe(0); // косой так и не достал
    expect(shotAt).toBeGreaterThan(b.d.reach + 0.3); // выстрел — дальше, чем бьёт коса
    expect(a.dogDied).toBe(true); // и хозяин об этом узнал
  });

  it('ружьё убивает собаку; хозяин может купить новую', () => {
    const { g, a, b } = pair();
    const dog = buyDog(g, 0);
    arm(g, 1);
    b.tool = TOOL_SCYTHE;
    place(b, 20, 40);
    b.dir = 0;
    dog.x = 21.5; // перед стволом
    dog.y = 40;
    dog.target = -1;
    step(g, [0, EAST]);
    expect(b.shot).not.toBeNull();
    expect(b.shot!.dog).toBe(0);
    expect(g.dogs[0]).toBeNull();
    expect(b.dogsKilled).toBe(1);
    expect(a.dogDied).toBe(true);
    expect(buyDog(g, 0)).not.toBeNull();
  });

  it('своё ружьё свою собаку не трогает', () => {
    const { g, a } = pair();
    const dog = buyDog(g, 0);
    arm(g, 0);
    a.tool = TOOL_SCYTHE;
    place(a, 20, 40);
    a.dir = 0;
    dog.x = 21.5;
    dog.y = 40;
    step(g, EAST);
    expect(a.shot).toBeNull();
    expect(a.dogCuts).toBe(0);
    expect(g.dogs[0]).not.toBeNull();
  });
});
