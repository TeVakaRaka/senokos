// Игра по сети: учёт ввода «шаг в шаг», сервер-комната и вся цепочка целиком —
// несколько копий игры через настоящий сервер приходят к одному и тому же состоянию.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NetLink, type NetProblem, type RoomState } from '../src/net/link.ts';
import { Lockstep } from '../src/net/lockstep.ts';
import { INPUT_DELAY, MAX_PLAYERS, NET_PROTOCOL } from '../src/net/protocol.ts';
import { botInput, createBot, type Bot } from '../src/sim/bot.ts';
import { createGame, step, type Game } from '../src/sim/game.ts';
import { hashGame } from '../src/sim/hash.ts';
import { Rng } from '../src/sim/rng.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';
import {
  delayDirect,
  delayFor,
  MAX_PLAYERS as SERVER_MAX,
  PROTOCOL,
  startServer,
  type GameServer,
} from '../tools/server.mjs';

const EAST = 1;
const WEST = 33;

describe('учёт ввода «шаг в шаг»', () => {
  it('первые шаги идут без пересылки, дальше игра ждёт ввод остальных', () => {
    const lock = new Lockstep(0, 2, 3, () => {});
    const frame = [9, 9];
    for (let i = 0; i < 3; i++) {
      expect(lock.ready).toBe(true);
      lock.advance(EAST, frame);
      expect(frame).toEqual([0, 0]); // первые шаги никто ничего не нажимал
    }
    expect(lock.done).toBe(3);
    expect(lock.ready).toBe(false);
    expect(() => lock.advance(EAST, frame)).toThrow();
    lock.receive(1, 3, WEST);
    expect(lock.ready).toBe(true);
  });

  it('свой ввод срабатывает ровно через задержку и уходит остальным с номером шага', () => {
    const sent: [number, number][] = [];
    const lock = new Lockstep(1, 2, 3, (s, i) => sent.push([s, i]));
    const frame = [0, 0];
    for (let n = 0; n < 8; n++) lock.receive(0, 3 + n, 0);
    lock.advance(EAST, frame); // шаг 0: нажатое уйдёт на шаг 3
    lock.advance(0, frame);
    lock.advance(0, frame);
    expect(frame[1]).toBe(0);
    lock.advance(0, frame); // шаг 3
    expect(frame[1]).toBe(EAST);
    expect(sent.slice(0, 2)).toEqual([
      [3, EAST],
      [4, 0],
    ]);
  });

  it('втроём шаг ждёт каждого', () => {
    const lock = new Lockstep(1, 3, 2, () => {});
    const frame = [0, 0, 0];
    lock.advance(0, frame);
    lock.advance(0, frame);
    lock.receive(0, 2, EAST);
    expect(lock.ready).toBe(false); // третий ещё молчит
    lock.receive(2, 2, WEST);
    expect(lock.ready).toBe(true);
    lock.advance(0, frame);
    expect(frame).toEqual([EAST, 0, WEST]);
  });

  it('мусор и повторы не принимаются', () => {
    const lock = new Lockstep(0, 2, 3, () => {});
    const frame = [0, 0];
    lock.receive(1, 1, EAST); // шаг из тех, что идут без пересылки
    lock.receive(1, 3.5, EAST);
    lock.receive(1, Number.NaN, EAST);
    lock.receive(1, 3, Number.NaN);
    lock.receive(0, 3, EAST); // «от себя» по сети не приходит
    lock.receive(5, 3, EAST); // такого игрока нет
    for (let i = 0; i < 3; i++) lock.advance(0, frame);
    expect(lock.ready).toBe(false);
    // Один и тот же ввод приходит двумя дорогами — напрямую и через сервер. Считается первый.
    expect(lock.receive(1, 3, EAST)).toBe(true);
    expect(lock.receive(1, 3, EAST)).toBe(false);
    expect(lock.receive(1, 3, WEST)).toBe(false); // повтор другого содержания — остаётся первое
    lock.advance(0, frame);
    expect(frame[1]).toBe(EAST);
  });

  it('вышедший больше не задерживает игру: что прислал — в силе, дальше стоит', () => {
    const lock = new Lockstep(0, 3, 2, () => {});
    const frame = [0, 0, 0];
    lock.advance(0, frame);
    lock.advance(0, frame);
    lock.receive(1, 2, EAST);
    lock.receive(2, 2, WEST);
    lock.receive(2, 3, WEST);
    expect(lock.others).toBe(2);
    lock.drop(1); // игрок 1 вышел, успев прислать ввод только на шаг 2
    expect(lock.others).toBe(1);
    lock.advance(0, frame);
    expect(frame).toEqual([0, EAST, WEST]); // присланное сработало
    expect(lock.ready).toBe(true); // шаг 3: от вышедшего ничего не ждём
    lock.advance(0, frame);
    expect(frame).toEqual([0, 0, WEST]);
    expect(lock.ready).toBe(false); // а игрока 2 по-прежнему ждём
  });
});

/** Копия игры у одного из игроков; за него играет бот. */
interface Side {
  game: Game;
  bot: Bot;
  lock: Lockstep;
  frame: number[];
  frames: number[][];
  tryStep(): boolean;
}

function side(
  seed: number,
  me: number,
  players: number,
  send: (step: number, input: number) => void,
  delay = INPUT_DELAY,
): Side {
  const game = createGame(seed, DEFAULT_TUNING, players);
  const bot = createBot(seed, me);
  const lock = new Lockstep(me, players, delay, send);
  const frame = new Array<number>(players).fill(0);
  const frames: number[][] = [];
  return {
    game,
    bot,
    lock,
    frame,
    frames,
    tryStep() {
      if (!lock.ready) return false;
      // Каждый видит только свою копию и решает только за своего игрока.
      lock.advance(botInput(game, bot), frame);
      frames.push(frame.slice());
      step(game, frame);
      return true;
    },
  };
}

/**
 * Несколько копий игры без сети: сообщения ходят через очереди с неровной задержкой.
 * Идут, пока done(копии) не станет верно; больше limit шагов ни одна копия не делает.
 */
function playInMemory(seed: number, players: number, done: (sides: Side[]) => boolean, limit = Infinity): Side[] {
  // queues[to] — сообщения, летящие к игроку to: [от кого, шаг, ввод].
  const queues: [number, number, number][][] = Array.from({ length: players }, () => []);
  const sides: Side[] = [];
  for (let me = 0; me < players; me++) {
    sides.push(
      side(seed, me, players, (s, i) => {
        for (let to = 0; to < players; to++) if (to !== me) queues[to]!.push([me, s, i]);
      }),
    );
  }
  const chance = new Rng(seed ^ 0x5eed);
  let rounds = 0;
  while (!done(sides)) {
    if (++rounds > 600000) throw new Error('копии игры встали');
    for (let k = 0; k < players; k++) {
      // Сеть: за круг доходит сколько-то сообщений, по порядку.
      const queue = queues[k]!;
      for (let n = chance.int(5); n > 0 && queue.length > 0; n--) sides[k]!.lock.receive(...queue.shift()!);
      // Устройства: то один успевает шаг, то другой.
      if (sides[k]!.lock.done < limit && chance.int(10) < 8) sides[k]!.tryStep();
    }
  }
  return sides;
}

describe('копии игры у разных игроков', () => {
  it('вдвоём при неровной сети считают одно и то же', () => {
    const steps = 1500;
    const [a, b] = playInMemory(21, 2, (s) => s.every((x) => x.lock.done === steps), steps) as [Side, Side];
    expect(hashGame(a.game)).toBe(hashGame(b.game));
    expect(a.game.tick).toBe(b.game.tick);
    expect(a.game.tick).toBeGreaterThan(1000); // игра шла, а не стояла на выборе улучшений
    expect(a.frames).toEqual(b.frames);
  }, 20000);

  it('никто не убегает вперёд дальше задержки ввода', () => {
    let worst = 0;
    playInMemory(22, 3, (s) => {
      const counts = s.map((x) => x.lock.done);
      worst = Math.max(worst, Math.max(...counts) - Math.min(...counts));
      return counts.every((n) => n >= 600);
    });
    expect(worst).toBeLessThanOrEqual(INPUT_DELAY);
  });

  it('полный день вдвоём: оба видят один итог, улучшения выбираются по сети', () => {
    const [a, b] = playInMemory(23, 2, (s) => s.every((x) => x.game.over)) as [Side, Side];
    expect(hashGame(a.game)).toBe(hashGame(b.game));
    for (const g of [a.game, b.game]) {
      expect(g.players[0]!.level).toBeGreaterThan(2);
      expect(g.players[1]!.level).toBeGreaterThan(2);
    }
    expect(a.game.players.map((p) => p.stacked)).toEqual(b.game.players.map((p) => p.stacked));
  }, 20000);

  it('втроём и вчетвером все копии сходятся', () => {
    for (const players of [3, 4]) {
      const steps = 700;
      const sides = playInMemory(30 + players, players, (s) => s.every((x) => x.lock.done === steps), steps);
      const hash = hashGame(sides[0]!.game);
      for (const s of sides) {
        expect(hashGame(s.game)).toBe(hash);
        expect(s.game.players.length).toBe(players);
      }
      expect(sides[0]!.game.tick).toBeGreaterThan(400);
    }
  }, 30000);

  it('с большим запасом для ввода (как через интернет) копии сходятся так же', () => {
    const delay = 9;
    const queues: [number, number, number][][] = [[], []];
    const sides = [0, 1].map((me) =>
      side(26, me, 2, (s, i) => queues[1 - me]!.push([me, s, i]), delay),
    );
    while (sides.some((x) => x.lock.done < 700)) {
      for (let k = 0; k < 2; k++) {
        for (const m of queues[k]!.splice(0)) sides[k]!.lock.receive(...m);
        if (sides[k]!.lock.done < 700) sides[k]!.tryStep();
      }
    }
    expect(hashGame(sides[0]!.game)).toBe(hashGame(sides[1]!.game));
    // Нажатое срабатывает через delay шагов: первые delay кадров пусты у обоих.
    expect(sides[0]!.frames.slice(0, delay).every((f) => f[0] === 0 && f[1] === 0)).toBe(true);
    expect(sides[0]!.frames.slice(delay, delay + 60).some((f) => f[0] !== 0)).toBe(true);
  });

  it('тот же ввод, проигранный без сети, даёт то же состояние', () => {
    const [a] = playInMemory(24, 2, (s) => s.every((x) => x.lock.done === 900), 900) as [Side, Side];
    const again = createGame(24, DEFAULT_TUNING, 2);
    for (const frame of a.frames) step(again, frame);
    expect(hashGame(again)).toBe(hashGame(a.game));
  });

  it('один из трёх вышел — двое доигрывают и по-прежнему сходятся', () => {
    const players = 3;
    const queues: [number, number, number][][] = [[], [], []];
    const sides: Side[] = [];
    for (let me = 0; me < players; me++) {
      sides.push(
        side(40, me, players, (s, i) => {
          for (let to = 0; to < players; to++) if (to !== me) queues[to]!.push([me, s, i]);
        }),
      );
    }
    const deliver = (to: number) => {
      for (const m of queues[to]!.splice(0)) sides[to]!.lock.receive(...m);
    };
    // Все трое играют 300 шагов.
    while (sides.some((s) => s.lock.done < 300)) {
      for (let k = 0; k < players; k++) {
        deliver(k);
        if (sides[k]!.lock.done < 300) sides[k]!.tryStep();
      }
    }
    // Третий выходит. Всё, что он отправил, остальным доходит — потом весть об уходе.
    deliver(0);
    deliver(1);
    sides[0]!.lock.drop(2);
    sides[1]!.lock.drop(2);
    while (sides[0]!.lock.done < 900 || sides[1]!.lock.done < 900) {
      for (let k = 0; k < 2; k++) {
        deliver(k);
        if (sides[k]!.lock.done < 900) sides[k]!.tryStep();
      }
    }
    expect(hashGame(sides[0]!.game)).toBe(hashGame(sides[1]!.game));
    expect(sides[0]!.game.tick).toBeGreaterThan(600);
    // Вышедший с какого-то шага стоит на месте.
    const last = sides[0]!.frames[sides[0]!.frames.length - 1]!;
    expect(last[2]).toBe(0);
  }, 20000);
});

/** Игрок, подключённый к серверу: копит всё, что ему пришло. */
interface Client {
  link: NetLink;
  rooms: RoomState[];
  starts: { seed: number; you: number; players: number; delay: number }[];
  pings: number[];
  inputs: [number, number, number][];
  hashes: [number, number, number][];
  gone: number[];
  problems: NetProblem[];
}

function until(check: () => boolean, ms = 3000): Promise<void> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const poll = () => {
      if (check()) done();
      else if (Date.now() - started > ms) fail(new Error('не дождались'));
      else setTimeout(poll, 5);
    };
    poll();
  });
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('сервер игры по сети', () => {
  let server: GameServer;
  let ws = '';
  const open: NetLink[] = [];

  beforeAll(async () => {
    // Вместо сборки игры раздаём папку с тестами — содержимое серверу всё равно.
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, root: new URL('./', import.meta.url) });
    ws = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterAll(async () => {
    for (const link of open) link.close();
    await server.close();
  });

  function connect(room: string, version = 'v1'): Client {
    const link = new NetLink(ws, room, version);
    open.push(link);
    const c: Client = { link, rooms: [], starts: [], pings: [], inputs: [], hashes: [], gone: [], problems: [] };
    link.events = {
      room: (state) => c.rooms.push(state),
      start: (seed, you, players, delay) => c.starts.push({ seed, you, players, delay }),
      ping: (ms) => c.pings.push(ms),
      input: (from, s, i) => c.inputs.push([from, s, i]),
      hash: (from, s, h) => c.hashes.push([from, s, h]),
      gone: (who) => c.gone.push(who),
      problem: (kind) => c.problems.push(kind),
    };
    return c;
  }

  /** Последнее, что игрок знает о комнате. */
  const room = (c: Client): RoomState => c.rooms[c.rooms.length - 1]!;

  /** Собрать в комнате n игроков и начать игру. */
  async function party(name: string, n: number): Promise<Client[]> {
    const clients: Client[] = [];
    for (let i = 0; i < n; i++) {
      const c = connect(name);
      clients.push(c);
      await until(() => c.rooms.length > 0 && room(c).count === i + 1);
    }
    clients[0]!.link.go();
    await until(() => clients.every((c) => c.starts.length === 1));
    return clients;
  }

  it('сервер и игра говорят на одном языке', () => {
    expect(PROTOCOL).toBe(NET_PROTOCOL);
    expect(SERVER_MAX).toBe(MAX_PLAYERS);
  });

  it('отвечает на проверку и раздаёт файлы, но только из своей папки', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const answer = await fetch(`${base}/api/ping`);
    // Игра, лежащая на другом адресе, тоже должна суметь спросить сервер.
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    const ping = (await answer.json()) as { senokos: number; lan: string };
    expect(ping.senokos).toBe(NET_PROTOCOL);
    expect(ping.lan).toMatch(/^http:\/\/.+:\d+$/);

    const file = await fetch(`${base}/util.ts`);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain('Общие помощники тестов');

    expect((await fetch(`${base}/нет-такого.js`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/..%2fpackage.json`)).status).not.toBe(200);
    expect((await fetch(`${base}/util.ts`, { method: 'POST' })).status).toBe(405);
  });

  it('игроки собираются в комнате: каждый знает, сколько их и кто начинает', async () => {
    const a = connect('lobby');
    await until(() => a.rooms.length === 1);
    expect(room(a)).toMatchObject({ count: 1, max: MAX_PLAYERS, you: 0, host: true, lan: server.lan });
    expect(room(a).id).toBeGreaterThan(0);
    expect(room(a).ids).toEqual([room(a).id]);

    const b = connect('lobby');
    await until(() => b.rooms.length === 1 && a.rooms.length === 2);
    expect(room(a).count).toBe(2);
    expect(room(b)).toMatchObject({ count: 2, max: MAX_PLAYERS, you: 1, host: false, lan: server.lan });
    // Каждый знает номера подключений всех в комнате — по ним игроки соединяются напрямую.
    expect(room(b).ids).toEqual([room(a).id, room(b).id]);
    expect(room(a).ids).toEqual(room(b).ids);
    expect(room(a).id).not.toBe(room(b).id);
    expect(a.starts.length + b.starts.length).toBe(0); // сама игра не начинается
  });

  it('начать может только первый и только когда есть с кем играть', async () => {
    const a = connect('go');
    await until(() => a.rooms.length === 1);
    a.link.go(); // один в комнате — рано
    const b = connect('go');
    await until(() => b.rooms.length === 1);
    b.link.go(); // второй начинать не вправе
    await pause(40);
    expect(a.starts.length + b.starts.length).toBe(0);

    a.link.go();
    await until(() => a.starts.length === 1 && b.starts.length === 1);
    // Оба на одном компьютере: связь мгновенная, запас для ввода — наименьший.
    expect(a.starts[0]).toEqual({ seed: a.starts[0]!.seed, you: 0, players: 2, delay: INPUT_DELAY });
    expect(b.starts[0]).toEqual({ seed: a.starts[0]!.seed, you: 1, players: 2, delay: INPUT_DELAY });
    expect(a.starts[0]!.seed).toBeGreaterThan(0);
  });

  it('запас для ввода подбирается по связи двух самых далёких игроков', () => {
    expect(delayFor([])).toBe(INPUT_DELAY);
    expect(delayFor([4, 9])).toBe(INPUT_DELAY); // один Wi-Fi
    expect(delayFor([Number.NaN, Number.NaN])).toBe(INPUT_DELAY); // замеров ещё нет
    // 180 и 220 мс туда-обратно: дорога между игроками 200 мс, с поправкой 240 — это 8 шагов.
    expect(delayFor([180, 220])).toBe(8);
    expect(delayFor([220, 180])).toBe(8);
    // Третий, близкий, ничего не меняет; считаются двое самых далёких.
    expect(delayFor([180, 10, 220])).toBe(8);
    expect(delayFor([10, 12, 300])).toBe(6); // (300 + 12) / 2 + 40 = 196 мс
    expect(delayFor([300])).toBe(11); // известен один замер — считаем, что второй такой же
    expect(delayFor([3000, 3000])).toBe(12); // больше не назначаем: играть так всё равно нельзя
    // Чем хуже связь, тем больше запас — и никогда не меньше, чем в одном Wi-Fi.
    let last = 0;
    for (let ms = 0; ms <= 600; ms += 20) {
      const d = delayFor([ms, ms]);
      expect(d).toBeGreaterThanOrEqual(Math.max(last, INPUT_DELAY));
      last = d;
    }
  });

  it('запас для ввода при прямой связи считается по дороге между игроками', () => {
    expect(delayDirect(4)).toBe(INPUT_DELAY); // одна сеть
    expect(delayDirect(60)).toBe(INPUT_DELAY); // один город: 30 мс в одну сторону + поправка
    expect(delayDirect(100)).toBe(4);
    expect(delayDirect(200)).toBe(5);
    expect(delayDirect(480)).toBe(9); // те же 480 мс через сервер дали бы наибольший запас
    expect(delayDirect(Number.NaN)).toBe(12);
    expect(delayDirect(5000)).toBe(12);
    // Прямая связь всегда не хуже дороги через сервер с тем же замером.
    for (let ms = 0; ms <= 800; ms += 25) expect(delayDirect(ms)).toBeLessThanOrEqual(delayFor([ms, ms]));
  });

  it('«визитки» для прямой связи доходят только адресату', async () => {
    const a = connect('cards');
    const b = connect('cards');
    const c = connect('cards');
    await until(() => [a, b, c].every((x) => x.rooms.length > 0 && room(x).count === 3));
    const got: Record<string, [number, unknown][]> = { a: [], b: [], c: [] };
    a.link.events.signal = (from, data) => got.a!.push([from, data]);
    b.link.events.signal = (from, data) => got.b!.push([from, data]);
    c.link.events.signal = (from, data) => got.c!.push([from, data]);

    a.link.signal(room(b).id, { d: { type: 'offer', sdp: 'привет' } });
    c.link.signal(room(a).id, { c: { candidate: 'адрес' } });
    a.link.signal(999999, { d: null }); // такого игрока нет
    a.link.signal(room(a).id, { d: null }); // самому себе — тоже никуда
    await until(() => got.b!.length === 1 && got.a!.length === 1);
    await pause(30);
    expect(got.b).toEqual([[room(a).id, { d: { type: 'offer', sdp: 'привет' } }]]);
    expect(got.a).toEqual([[room(c).id, { c: { candidate: 'адрес' } }]]);
    expect(got.c).toEqual([]);
  });

  it('все соединились напрямую — запас считается по прямой связи; иначе — по дороге через сервер', async () => {
    const raw = (name: string): Promise<{ ws: WebSocket; got: Record<string, unknown>[] }> =>
      new Promise((done) => {
        const socket = new WebSocket(ws);
        const got: Record<string, unknown>[] = [];
        socket.addEventListener('message', (e) => got.push(JSON.parse(String(e.data)) as Record<string, unknown>));
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ t: 'join', room: name, v: 'v1' }));
          done({ ws: socket, got });
        });
      });
    const started = (x: { got: Record<string, unknown>[] }) => x.got.find((m) => m.t === 'start');

    // Оба далеко от сервера (480 мс), но друг с другом соединились напрямую (60 мс).
    const a = await raw('direct');
    await until(() => a.got.some((m) => m.t === 'room'));
    const b = await raw('direct');
    await until(() => b.got.some((m) => m.t === 'room'));
    for (const x of [a, b]) {
      x.ws.send(JSON.stringify({ t: 'rtt', ms: 480 }));
      x.ws.send(JSON.stringify({ t: 'p2p', rtt: 60, n: 1 }));
    }
    await pause(30);
    a.ws.send(JSON.stringify({ t: 'go' }));
    await until(() => started(a) !== undefined && started(b) !== undefined);
    expect(started(a)).toMatchObject({ delay: INPUT_DELAY, direct: true });
    expect(started(b)).toMatchObject({ delay: INPUT_DELAY, direct: true });

    // То же, но один из двоих напрямую не соединился.
    const c = await raw('half');
    await until(() => c.got.some((m) => m.t === 'room'));
    const d = await raw('half');
    await until(() => d.got.some((m) => m.t === 'room'));
    for (const x of [c, d]) x.ws.send(JSON.stringify({ t: 'rtt', ms: 480 }));
    c.ws.send(JSON.stringify({ t: 'p2p', rtt: 60, n: 1 }));
    d.ws.send(JSON.stringify({ t: 'p2p', rtt: -1, n: 0 }));
    await pause(30);
    c.ws.send(JSON.stringify({ t: 'go' }));
    await until(() => started(c) !== undefined && started(d) !== undefined);
    expect(started(c)).toMatchObject({ delay: 12, direct: false });
    for (const x of [a, b, c, d]) x.ws.close();
  });

  it('игрок меряет связь с сервером, пока ждёт начала', async () => {
    const a = connect('ping');
    await until(() => a.pings.length >= 1);
    expect(a.pings[0]).toBeGreaterThanOrEqual(0);
    expect(a.pings[0]).toBeLessThan(500);
  });

  it('сервер назначает всем один запас по присланным замерам', async () => {
    // Два «далёких» игрока: говорим с сервером напрямую и присылаем свои замеры сами.
    const raw = (): Promise<{ ws: WebSocket; got: Record<string, unknown>[] }> =>
      new Promise((done) => {
        const socket = new WebSocket(ws);
        const got: Record<string, unknown>[] = [];
        socket.addEventListener('message', (e) => got.push(JSON.parse(String(e.data)) as Record<string, unknown>));
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ t: 'join', room: 'far', v: 'v1' }));
          done({ ws: socket, got });
        });
      });
    const a = await raw();
    await until(() => a.got.some((m) => m.t === 'room'));
    const b = await raw();
    await until(() => b.got.some((m) => m.t === 'room'));

    a.ws.send(JSON.stringify({ t: 'ping', n: 12345.5 }));
    await until(() => a.got.some((m) => m.t === 'pong'));
    expect(a.got.find((m) => m.t === 'pong')).toEqual({ t: 'pong', n: 12345.5 });

    a.ws.send(JSON.stringify({ t: 'rtt', ms: 180 }));
    b.ws.send(JSON.stringify({ t: 'rtt', ms: 220 }));
    await pause(30);
    a.ws.send(JSON.stringify({ t: 'go' }));
    await until(() => a.got.some((m) => m.t === 'start') && b.got.some((m) => m.t === 'start'));
    expect(a.got.find((m) => m.t === 'start')).toMatchObject({ you: 0, players: 2, delay: 8 });
    expect(b.got.find((m) => m.t === 'start')).toMatchObject({ you: 1, players: 2, delay: 8 });
    a.ws.close();
    b.ws.close();
  });

  it('втроём: у всех одно зерно и свои номера', async () => {
    const clients = await party('three', 3);
    expect(clients.map((c) => c.starts[0]!.you)).toEqual([0, 1, 2]);
    expect(new Set(clients.map((c) => c.starts[0]!.seed)).size).toBe(1);
    expect(clients.every((c) => c.starts[0]!.players === 3)).toBe(true);
  });

  it('ввод и хеши пересылаются всем остальным, а не себе и не в чужую комнату', async () => {
    const [a, b, c] = (await party('relay', 3)) as [Client, Client, Client];
    const outsider = connect('other');
    await until(() => outsider.rooms.length === 1);

    a.link.sendInput(3, 17);
    a.link.sendInput(4, 129);
    c.link.sendHash(150, 4000000000);
    await until(() => b.inputs.length === 2 && c.inputs.length === 2 && a.hashes.length === 1 && b.hashes.length === 1);
    expect(b.inputs).toEqual([
      [0, 3, 17],
      [0, 4, 129],
    ]);
    expect(c.inputs).toEqual(b.inputs);
    expect(a.hashes).toEqual([[2, 150, 4000000000]]);
    expect(a.inputs.length).toBe(0);
    expect(c.hashes.length).toBe(0);
    expect(outsider.inputs.length).toBe(0);
  });

  it('пока игра не началась, ввод никуда не уходит', async () => {
    const a = connect('early');
    const b = connect('early');
    await until(() => a.rooms.length > 0 && b.rooms.length > 0 && room(a).count === 2 && room(b).count === 2);
    a.link.sendInput(3, 5); // номера у игрока ещё нет — ничего не отправится
    await pause(40);
    expect(b.inputs.length).toBe(0);
  });

  it('пятому в комнате отказывают', async () => {
    const four: Client[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = connect('full');
      four.push(c);
      await until(() => c.rooms.length > 0);
    }
    const extra = connect('full');
    await until(() => extra.problems.length === 1);
    expect(extra.problems).toEqual(['full']);
    await pause(40);
    expect(extra.problems).toEqual(['full']); // закрытие связи после отказа — не вторая беда
    expect(four.every((c) => c.problems.length === 0)).toBe(true);
  });

  it('разные версии игры вместе не играют', async () => {
    const a = connect('versions', 'v1');
    await until(() => a.rooms.length === 1);
    const b = connect('versions', 'v2');
    await until(() => b.problems.length === 1);
    expect(b.problems).toEqual(['mismatch']);
    expect(room(a).count).toBe(1);
    // Первый всё ещё ждёт: игрок с той же версией к нему попадёт.
    const c = connect('versions', 'v1');
    await until(() => c.rooms.length === 1 && room(a).count === 2);
  });

  it('кто-то ушёл до начала — остальные видят, что их стало меньше; первым становится следующий', async () => {
    const a = connect('shrink');
    const b = connect('shrink');
    const c = connect('shrink');
    await until(() => [a, b, c].every((x) => x.rooms.length > 0 && room(x).count === 3));
    const first = [a, b, c].find((x) => room(x).host)!;
    const rest = [a, b, c].filter((x) => x !== first);
    first.link.close();
    await until(() => rest.every((x) => room(x).count === 2));
    expect(rest.filter((x) => room(x).host).length).toBe(1);
    expect(rest.every((x) => x.gone.length === 0)).toBe(true);
  });

  it('игрок вышел из идущей игры — остальные узнают кто; под тем же именем собирается новая комната', async () => {
    const [a, b, c] = (await party('leave', 3)) as [Client, Client, Client];
    b.link.close();
    await until(() => a.gone.length === 1 && c.gone.length === 1);
    expect(a.gone).toEqual([1]);
    expect(c.gone).toEqual([1]);
    expect(a.problems.length + b.problems.length + c.problems.length).toBe(0);

    // Оставшиеся продолжают обмениваться вводом.
    a.link.sendInput(10, 7);
    await until(() => c.inputs.length === 1);

    // А имя комнаты свободно для новой компании.
    const next = connect('leave');
    await until(() => next.rooms.length === 1);
    expect(room(next)).toMatchObject({ count: 1, host: true });
  });

  it('чужим номером подписаться нельзя', async () => {
    const [a, b] = (await party('spoof', 2)) as [Client, Client];
    // Игрок 1 пытается отправить ввод от имени игрока 0 в обход NetLink.
    const raw = new WebSocket(ws);
    await new Promise<void>((done) => raw.addEventListener('open', () => done()));
    raw.send('i0,3,17'); // не в комнате — никуда
    b.link.sendInput(3, 9);
    await until(() => a.inputs.length === 1);
    expect(a.inputs).toEqual([[1, 3, 9]]);
    raw.close();
  });

  it('сервер остановлен — игрок узнаёт, что связи нет', async () => {
    const extra = await startServer({ port: 0, host: '127.0.0.1', quiet: true, root: new URL('./', import.meta.url) });
    const problems: NetProblem[] = [];
    let joined = false;
    const link = new NetLink(`ws://127.0.0.1:${extra.port}/ws`, 'x', 'v1');
    link.events = { room: () => (joined = true), problem: (kind) => problems.push(kind) };
    await until(() => joined);
    await extra.close();
    await until(() => problems.length === 1);
    expect(problems).toEqual(['closed']);
  });

  it('три копии игры через сервер приходят к одному состоянию', async () => {
    const steps = 600;
    const players = 3;

    function play(host: boolean): Promise<{ hash: number; tick: number; you: number; seed: number }> {
      return new Promise((done) => {
        const link = new NetLink(ws, 'match', 'v1');
        open.push(link);
        let s: Side | null = null;
        let you = -1;
        let seed = 0;
        let finished = false;
        const pump = () => {
          if (!s || finished) return;
          while (s.lock.done < steps && s.tryStep()) {
            // идём, пока известен ввод остальных
          }
          if (s.lock.done >= steps) {
            finished = true;
            done({ hash: hashGame(s.game), tick: s.game.tick, you, seed });
          }
        };
        link.events = {
          room: (state) => {
            if (host && state.host && state.count === players) link.go();
          },
          start: (gotSeed, gotYou, count, delay) => {
            seed = gotSeed;
            you = gotYou;
            s = side(seed, you, count, (stepNo, input) => link.sendInput(stepNo, input), delay);
            pump();
          },
          input: (from, stepNo, input) => {
            s?.lock.receive(from, stepNo, input);
            pump();
          },
        };
      });
    }

    // Первый подключившийся — тот, кто начинает; дождёмся, пока соберутся все трое.
    const first = play(true);
    await pause(60);
    const results = await Promise.all([first, play(false), play(false)]);
    expect(new Set(results.map((r) => r.seed)).size).toBe(1);
    expect(results.map((r) => r.you).sort()).toEqual([0, 1, 2]);
    expect(new Set(results.map((r) => r.hash)).size).toBe(1);
    expect(new Set(results.map((r) => r.tick)).size).toBe(1);
    expect(results[0]!.tick).toBeGreaterThan(350);
  }, 30000);
});
