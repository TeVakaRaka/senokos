// Связь с сервером игры по сети (WebSocket). Сервер собирает игроков в комнату и дальше
// только пересылает сообщения одного остальным.
//
// Сообщения сервера — JSON с полем t: room (кто в комнате), start (поехали), full (мест
// нет), mismatch (разные версии игры), left (игрок вышел), pong (ответ на замер связи).
// От игрока серверу: join, go («начинаем» — от первого в комнате), ping и rtt (замер
// связи: по нему сервер решает, с каким запасом отправлять ввод). Между игроками — строки:
// «i<игрок>,<шаг>,<ввод>» и «h<игрок>,<шаг>,<хеш состояния>».

export type NetProblem = 'full' | 'mismatch' | 'closed';

export interface RoomState {
  count: number; // сколько игроков в комнате
  max: number; // сколько помещается
  you: number; // свой номер в очереди (с нуля)
  host: boolean; // первый в комнате — он начинает игру
  lan: string; // адрес, который надо открыть друзьям
}

export interface NetEvents {
  /** Состав комнаты изменился (пока игра не началась). */
  room?: (state: RoomState) => void;
  /**
   * Игра началась. seed — зерно поля, you — номер своего игрока, players — сколько всего,
   * delay — на сколько шагов вперёд отправлять ввод (одно число на всех).
   */
  start?: (seed: number, you: number, players: number, delay: number) => void;
  /** Замер связи с сервером: время туда и обратно, мс. */
  ping?: (ms: number) => void;
  /** Ввод игрока from на шаг step. */
  input?: (from: number, step: number, input: number) => void;
  /** Хеш состояния у игрока from после step шагов. */
  hash?: (from: number, step: number, hash: number) => void;
  /** Игрок who вышел из идущей игры. */
  gone?: (who: number) => void;
  problem?: (kind: NetProblem) => void;
}

const CODE_I = 105; // «i»
const CODE_H = 104; // «h»
const PING_MS = 1000; // как часто меряем связь, пока ждём начала игры
const PING_KEEP = 5; // по скольким последним замерам считаем

export class NetLink {
  /** Обработчики можно менять на ходу: сначала экран ожидания, потом сама игра. */
  events: NetEvents = {};
  private readonly ws: WebSocket;
  private me = -1; // номер своего игрока — известен с начала игры
  private over = false; // связь закрыта нами или сервер уже назвал причину
  private pinger: ReturnType<typeof setInterval> | null = null;
  private readonly samples: number[] = [];

  /** url — адрес сервера (ws:// или wss://); version — версия игры, у всех должна совпасть. */
  constructor(url: string, room: string, version: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.ws.send(JSON.stringify({ t: 'join', room, v: version }));
      // Пока ждём начала, меряем связь: сервер подберёт по ней запас для ввода.
      const ping = () => this.sendText(`{"t":"ping","n":${performance.now()}}`);
      ping();
      this.pinger = setInterval(ping, PING_MS);
    });
    this.ws.addEventListener('message', (e) => this.onMessage(String(e.data)));
    this.ws.addEventListener('close', () => {
      this.stopPing();
      if (this.over) return;
      this.over = true;
      this.events.problem?.('closed');
    });
  }

  private stopPing(): void {
    if (this.pinger !== null) clearInterval(this.pinger);
    this.pinger = null;
  }

  /** Пришёл ответ на замер: запомнить и сообщить серверу середину последних замеров. */
  private onPong(sentAt: number): void {
    const ms = performance.now() - sentAt;
    if (!(ms >= 0) || ms > 60000) return;
    this.samples.push(ms);
    if (this.samples.length > PING_KEEP) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    const middle = Math.round(sorted[Math.floor(sorted.length / 2)]!);
    this.sendText(`{"t":"rtt","ms":${middle}}`);
    this.events.ping?.(middle);
  }

  private onMessage(text: string): void {
    const kind = text.charCodeAt(0);
    if (kind === CODE_I || kind === CODE_H) {
      const parts = text.slice(1).split(',');
      if (parts.length !== 3) return;
      const from = Number(parts[0]);
      const step = Number(parts[1]);
      const value = Number(parts[2]);
      if (!Number.isFinite(from) || !Number.isFinite(step) || !Number.isFinite(value)) return;
      if (kind === CODE_I) this.events.input?.(from, step, value);
      else this.events.hash?.(from, step, value);
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    if (msg.t === 'room') {
      this.events.room?.({
        count: num(msg.count),
        max: num(msg.max),
        you: num(msg.you),
        host: msg.host === true,
        lan: typeof msg.lan === 'string' ? msg.lan : '',
      });
    } else if (msg.t === 'pong') {
      this.onPong(num(msg.n));
    } else if (msg.t === 'start') {
      if (typeof msg.seed !== 'number' || typeof msg.you !== 'number' || typeof msg.players !== 'number') return;
      this.me = msg.you;
      this.stopPing();
      this.events.start?.(msg.seed, msg.you, msg.players, num(msg.delay));
    } else if (msg.t === 'left') {
      this.events.gone?.(num(msg.who));
    } else if (msg.t === 'full' || msg.t === 'mismatch') {
      this.over = true; // сервер сам закроет связь — второй раз о беде не сообщаем
      this.events.problem?.(msg.t);
    }
  }

  private sendText(text: string): void {
    if (this.ws.readyState === 1) this.ws.send(text);
  }

  /** Первый в комнате говорит: все в сборе, начинаем. */
  go(): void {
    this.sendText('{"t":"go"}');
  }

  sendInput(step: number, input: number): void {
    if (this.me >= 0) this.sendText(`i${this.me},${step},${input}`);
  }

  sendHash(step: number, hash: number): void {
    if (this.me >= 0) this.sendText(`h${this.me},${step},${hash}`);
  }

  close(): void {
    this.over = true;
    this.stopPing();
    this.ws.close();
  }
}
