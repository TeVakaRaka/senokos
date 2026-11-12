// Прямая связь между игроками. Настоящего WebRTC в тестах нет, поэтому вместо него —
// подставные соединения с теми же правилами: «визитки» ходят через сервер (здесь — через
// очередь), адреса нельзя принимать раньше описания, канал открывается, когда обе стороны
// договорились, а пакеты в канале могут теряться.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Lockstep } from '../src/net/lockstep.ts';
import { Mesh } from '../src/net/p2p.ts';

interface Description {
  type: string;
  sdp: string;
}

/** Правила подставной сети: задержка канала и какие пакеты терять. */
const net = { delayMs: 4, lose: (_n: number): boolean => false, sent: 0 };

class FakeChannel {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  other: FakeChannel | null = null;

  send(text: string): void {
    if (this.readyState !== 'open') throw new Error('канал закрыт');
    const other = this.other!;
    if (net.lose(net.sent++)) return;
    setTimeout(() => {
      if (other.readyState === 'open') other.onmessage?.({ data: text });
    }, net.delayMs);
  }

  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.onclose?.();
    this.other?.close();
  }
}

class FakeConnection {
  static count = 0;
  static all = new Map<string, FakeConnection>();
  static channels = 0; // сколько каналов создано всего — по одному на пару

  readonly name = `pc${++FakeConnection.count}`;
  localDescription: Description | null = null;
  remote: Description | null = null;
  signalingState = 'stable';
  iceGatheringState = 'new';
  iceConnectionState = 'new';
  connectionState = 'new';
  onicecandidate: ((e: { candidate: { toJSON(): unknown } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: FakeChannel }) => void) | null = null;
  private channel: FakeChannel | null = null;
  private heard = false; // получил адрес второй стороны
  private closed = false;

  constructor() {
    FakeConnection.all.set(this.name, this);
  }

  createDataChannel(): FakeChannel {
    FakeConnection.channels++;
    this.channel = new FakeChannel();
    return this.channel;
  }

  async createOffer(): Promise<Description> {
    return { type: 'offer', sdp: this.name };
  }

  async createAnswer(): Promise<Description> {
    if (this.remote?.type !== 'offer') throw new Error('отвечать не на что');
    return { type: 'answer', sdp: this.name };
  }

  async setLocalDescription(d: Description): Promise<void> {
    this.localDescription = d;
    // Свой адрес становится известен чуть позже описания — как в жизни.
    setTimeout(() => this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `адрес ${this.name}` }) } }), 1);
  }

  async setRemoteDescription(d: Description): Promise<void> {
    this.remote = d;
    this.tryConnect();
  }

  async addIceCandidate(): Promise<void> {
    if (!this.remote) throw new Error('адрес пришёл раньше описания');
    this.heard = true;
    this.tryConnect();
    FakeConnection.all.get(this.remote.sdp)?.tryConnect();
  }

  /** Обе стороны знают описание и адрес друг друга — канал открывается. */
  private tryConnect(): void {
    if (this.closed || this.connectionState === 'connected' || !this.remote || !this.heard) return;
    const other = FakeConnection.all.get(this.remote.sdp);
    if (!other || other.closed || !other.remote || !other.heard || other.remote.sdp !== this.name) return;
    const caller = this.channel ? this : other;
    const callee = caller === this ? other : this;
    const far = new FakeChannel();
    caller.channel!.other = far;
    far.other = caller.channel!;
    this.connectionState = 'connected';
    other.connectionState = 'connected';
    callee.ondatachannel?.({ channel: far });
    caller.channel!.open();
    far.open();
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
    this.channel?.close();
    this.onconnectionstatechange?.();
  }
}

/** Комната из нескольких игроков: «визитки» ходят между ними с небольшой задержкой. */
function party(ids: number[], signalMs = 2): Map<number, Mesh> {
  const meshes = new Map<number, Mesh>();
  for (const id of ids) {
    meshes.set(
      id,
      new Mesh(id, (to, card) => {
        const copy = JSON.parse(JSON.stringify(card)) as unknown; // как после дороги через сервер
        setTimeout(() => meshes.get(to)?.signal(id, copy), signalMs);
      }),
    );
  }
  for (const [id, mesh] of meshes) mesh.setPeers(ids.filter((other) => other !== id));
  return meshes;
}

function until(check: () => boolean, ms = 3000): Promise<void> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const poll = () => {
      if (check()) done();
      else if (Date.now() - started > ms) fail(new Error('не дождались'));
      else setTimeout(poll, 3);
    };
    poll();
  });
}

const open: Mesh[] = [];
function track(meshes: Map<number, Mesh>): Map<number, Mesh> {
  open.push(...meshes.values());
  return meshes;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeConnection;
});

afterEach(() => {
  for (const mesh of open.splice(0)) mesh.close();
  net.delayMs = 4;
  net.lose = () => false;
  net.sent = 0;
});

describe('прямая связь между игроками', () => {
  it('двое соединяются и меряют связь друг с другом', async () => {
    expect(Mesh.supported()).toBe(true);
    const before = FakeConnection.channels;
    const meshes = track(party([1, 2]));
    const a = meshes.get(1)!;
    const b = meshes.get(2)!;
    expect(a.measured).toBe(0);
    expect(a.rtt).toBe(-1);
    await until(() => a.measured === 1 && b.measured === 1);
    // Туда и обратно — две задержки канала.
    expect(a.rtt).toBeGreaterThanOrEqual(net.delayMs * 2 - 1);
    expect(a.rtt).toBeLessThan(200);
    // Звонит тот, у кого номер меньше; второй только отвечает — канал на пару один.
    expect(FakeConnection.channels - before).toBe(1);
  });

  it('вчетвером каждый соединяется с каждым', async () => {
    const before = FakeConnection.channels;
    const meshes = track(party([5, 9, 12, 20]));
    await until(() => [...meshes.values()].every((m) => m.measured === 3));
    expect(FakeConnection.channels - before).toBe(6); // шесть пар
  });

  it('адрес, пришедший раньше описания, дожидается своей очереди', async () => {
    // «Визитки» идут дольше, чем готовятся адреса: адрес звонящего обгонит ответ на звонок.
    const meshes = track(party([1, 2], 0));
    await until(() => [...meshes.values()].every((m) => m.measured === 1));
  });

  it('о переменах узнаёт тот, кто слушает', async () => {
    const meshes = track(party([1, 2]));
    let changes = 0;
    meshes.get(1)!.onChange = () => changes++;
    await until(() => meshes.get(1)!.measured === 1);
    expect(changes).toBeGreaterThan(0);
  });

  it('ввод доходит напрямую, с номером игрока и шага', async () => {
    const meshes = track(party([1, 2]));
    const a = meshes.get(1)!;
    const b = meshes.get(2)!;
    await until(() => a.measured === 1 && b.measured === 1);
    const got: [number, number, number][] = [];
    b.onInput = (from, step, input) => got.push([from, step, input]);
    a.sendInput(0, 3, 17);
    await until(() => got.length > 0);
    expect(got).toEqual([[0, 3, 17]]);
    a.sendInput(0, 4, 129);
    await until(() => got.length >= 3);
    // Второй пакет несёт и новый ввод, и предыдущий — на случай, если первый потерялся.
    expect(got.slice(1)).toEqual([
      [0, 4, 129],
      [0, 3, 17],
    ]);
  });

  it('потерянные пакеты покрываются следующими: до игры доходит каждый шаг', async () => {
    const meshes = track(party([1, 2]));
    const a = meshes.get(1)!;
    const b = meshes.get(2)!;
    await until(() => a.measured === 1 && b.measured === 1);
    net.lose = (n) => n % 3 !== 0; // теряются два пакета из трёх
    const lock = new Lockstep(1, 2, 3, () => {});
    let accepted = 0;
    b.onInput = (from, step, input) => {
      if (lock.receive(from, step, input)) accepted++;
    };
    const total = 60;
    for (let step = 3; step < 3 + total; step++) a.sendInput(0, step, 1 + (step % 60));
    net.lose = () => false;
    a.sendInput(0, 3 + total, 5); // последний пакет доходит и несёт хвост
    await until(() => accepted === total + 1);
    // Шаги идут подряд, без дыр: игра может выполнить их все.
    const frame = [0, 0];
    for (let n = 0; n < 3 + total; n++) {
      expect(lock.ready).toBe(true);
      lock.advance(0, frame);
      if (n >= 3) expect(frame[0]).toBe(1 + (n % 60));
    }
  });

  it('ушедшего из комнаты забывают, с новым соединяются', async () => {
    const meshes = track(party([1, 2, 3]));
    const a = meshes.get(1)!;
    await until(() => [...meshes.values()].every((m) => m.measured === 2));
    // Третий вышел.
    meshes.get(3)!.close();
    a.setPeers([2]);
    meshes.get(2)!.setPeers([1]);
    expect(a.measured).toBe(1);
    // Пришёл четвёртый.
    const d = new Mesh(4, (to, card) => setTimeout(() => meshes.get(to)?.signal(4, JSON.parse(JSON.stringify(card))), 2));
    open.push(d);
    meshes.set(4, d);
    // Остальные шлют ему «визитки» через ту же комнату.
    d.setPeers([1, 2]);
    a.setPeers([2, 4]);
    meshes.get(2)!.setPeers([1, 4]);
    await until(() => a.measured === 2 && d.measured === 2);
  });

  it('напрямую ввод приходит раньше, чем через сервер, а считается один раз', async () => {
    // Две дороги: прямая (4 мс) и через сервер (60 мс). Игра должна идти на прямой.
    const meshes = track(party([1, 2]));
    const a = meshes.get(1)!;
    const b = meshes.get(2)!;
    await until(() => a.measured === 1 && b.measured === 1);

    const via = { direct: 0, relay: 0 };
    const relayMs = 60;
    const locks: Lockstep[] = [];
    const sides = [a, b];
    for (let me = 0; me < 2; me++) {
      const mesh = sides[me]!;
      locks.push(
        new Lockstep(me, 2, 3, (step, input) => {
          mesh.sendInput(me, step, input); // напрямую
          setTimeout(() => {
            if (locks[1 - me]!.receive(me, step, input)) via.relay++; // через сервер
          }, relayMs);
        }),
      );
    }
    for (let me = 0; me < 2; me++) {
      sides[me]!.onInput = (from, step, input) => {
        if (locks[me]!.receive(from, step, input)) via.direct++;
      };
    }

    const frames: number[][][] = [[], []];
    const started = Date.now();
    const steps = 40;
    await new Promise<void>((done) => {
      const tick = () => {
        for (let me = 0; me < 2; me++) {
          const lock = locks[me]!;
          if (lock.done < steps && lock.ready) {
            const frame = [0, 0];
            lock.advance(1 + ((lock.done + me) % 64), frame);
            frames[me]!.push(frame);
          }
        }
        if (locks.every((l) => l.done === steps)) done();
        else setTimeout(tick, 2);
      };
      tick();
    });
    const took = Date.now() - started;
    expect(frames[0]).toEqual(frames[1]); // обе копии видят один и тот же ввод
    expect(via.direct).toBeGreaterThan(steps); // почти весь ввод пришёл напрямую
    expect(via.direct).toBeGreaterThan(via.relay * 5);
    // Через сервер 40 шагов заняли бы не меньше 40 × 60 / 3 = 800 мс.
    expect(took).toBeLessThan(600);
  });
});
