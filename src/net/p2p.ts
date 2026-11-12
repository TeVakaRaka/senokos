// Прямая связь между игроками (WebRTC). Сервер нужен, только чтобы игроки обменялись
// «визитками»; дальше ввод идёт от устройства к устройству, минуя сервер, — это и убирает
// запаздывание, когда сервер далеко.
//
// Тот же ввод по-прежнему дублируется через сервер: чей экземпляр пришёл первым, тот и
// считается. Поэтому прямая связь — только ускоритель: не получилась или оборвалась —
// игра идёт как раньше, через сервер.
//
// Канал быстрый, но ненадёжный (пакеты не переспрашиваются), поэтому каждый пакет несёт
// не только текущий ввод, но и несколько предыдущих: потерялся один — следующий его покроет.

/** Серверы, которые подсказывают устройству его адрес в интернете (без них связи не будет). */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun.sipnet.ru:3478', 'stun:stun1.l.google.com:19302'] },
];

const PING_MS = 500; // как часто меряем прямую связь
const KEEP = 7; // по скольким последним замерам считаем
const REPEAT = 8; // сколько последних вводов несёт каждый пакет

/** Что игроки передают друг другу через сервер, чтобы соединиться. */
interface Card {
  d?: RTCSessionDescriptionInit | null; // описание соединения
  c?: RTCIceCandidateInit; // один из возможных адресов
}

interface Peer {
  id: number;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  open: boolean;
  samples: number[];
  rtt: number; // середина последних замеров, мс; −1 — ещё не мерили
  ready: boolean; // описание второй стороны получено — можно принимать адреса
  waiting: RTCIceCandidateInit[]; // адреса, пришедшие раньше описания
}

export class Mesh {
  /** Пришёл ввод игрока from на шаг step. */
  onInput: ((from: number, step: number, input: number) => void) | null = null;
  /** Связь с кем-то появилась, пропала или перемерена. */
  onChange: (() => void) | null = null;

  private readonly myId: number;
  private readonly sendCard: (to: number, card: unknown) => void;
  private readonly peers = new Map<number, Peer>();
  private readonly recent: number[] = []; // свои последние вводы, новый — первым
  private timer: ReturnType<typeof setInterval> | null = null;

  /** myId — свой номер в комнате; sendCard — передать «визитку» игроку to через сервер. */
  constructor(myId: number, sendCard: (to: number, card: unknown) => void) {
    this.myId = myId;
    this.sendCard = sendCard;
    this.timer = setInterval(() => {
      for (const peer of this.peers.values()) this.say(peer, `p${performance.now()}`);
    }, PING_MS);
  }

  /** Умеет ли это устройство соединяться напрямую. */
  static supported(): boolean {
    return typeof RTCPeerConnection === 'function';
  }

  /** Кто сейчас в комнате (кроме себя): с новыми соединяемся, ушедших забываем. */
  setPeers(ids: readonly number[]): void {
    for (const [id, peer] of this.peers) {
      if (ids.includes(id)) continue;
      this.drop(peer);
      this.peers.delete(id);
    }
    for (const id of ids) if (id !== this.myId && !this.peers.has(id)) this.connect(id);
    this.onChange?.();
  }

  /** Со сколькими игроками прямая связь есть и измерена. */
  get measured(): number {
    let n = 0;
    for (const peer of this.peers.values()) if (peer.open && peer.rtt >= 0) n++;
    return n;
  }

  /** Худшее время «туда и обратно» среди прямых соединений, мс (−1 — мерить нечего). */
  get rtt(): number {
    let worst = -1;
    for (const peer of this.peers.values()) if (peer.open && peer.rtt > worst) worst = peer.rtt;
    return worst;
  }

  /** Состояние каждого соединения — для отладки. */
  describe(): string[] {
    const lines: string[] = [];
    for (const peer of this.peers.values()) {
      const pc = peer.pc;
      lines.push(
        `${peer.id}: ${pc.signalingState}/${pc.iceGatheringState}/${pc.iceConnectionState}/${pc.connectionState}` +
          ` канал ${peer.dc ? peer.dc.readyState : 'нет'} замер ${Math.round(peer.rtt)}`,
      );
    }
    return lines;
  }

  /** Пришла «визитка» от игрока from. */
  signal(from: number, card: unknown): void {
    if (from === this.myId || typeof card !== 'object' || card === null) return;
    const peer = this.peers.get(from) ?? this.connect(from);
    void this.accept(peer, card as Card).catch(() => {
      // не договорились — останемся на связи через сервер
    });
  }

  /** Отправить всем свой ввод me на шаг step — вместе с несколькими предыдущими. */
  sendInput(me: number, step: number, input: number): void {
    this.recent.unshift(input);
    if (this.recent.length > REPEAT) this.recent.length = REPEAT;
    const text = `i${me},${step},${this.recent.join(',')}`;
    for (const peer of this.peers.values()) this.say(peer, text);
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const peer of this.peers.values()) this.drop(peer);
    this.peers.clear();
  }

  private connect(id: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { id, pc, dc: null, open: false, samples: [], rtt: -1, ready: false, waiting: [] };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendCard(id, { c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed' && pc.connectionState !== 'closed') return;
      peer.open = false;
      this.onChange?.();
    };
    if (this.myId < id) {
      // Звонит тот, у кого номер меньше, второй отвечает — чтобы не позвонить друг другу разом.
      this.attach(peer, pc.createDataChannel('senokos', { ordered: false, maxRetransmits: 0 }));
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.sendCard(id, { d: pc.localDescription }))
        .catch(() => {});
    } else {
      pc.ondatachannel = (e) => this.attach(peer, e.channel);
    }
    return peer;
  }

  private async accept(peer: Peer, card: Card): Promise<void> {
    const pc = peer.pc;
    if (card.d) {
      await pc.setRemoteDescription(card.d);
      peer.ready = true;
      for (const candidate of peer.waiting.splice(0)) await pc.addIceCandidate(candidate);
      if (card.d.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        this.sendCard(peer.id, { d: pc.localDescription });
      }
    }
    if (card.c) {
      if (peer.ready) await pc.addIceCandidate(card.c);
      else peer.waiting.push(card.c);
    }
  }

  private attach(peer: Peer, dc: RTCDataChannel): void {
    peer.dc = dc;
    dc.onopen = () => {
      peer.open = true;
      this.say(peer, `p${performance.now()}`);
      this.onChange?.();
    };
    dc.onclose = () => {
      peer.open = false;
      this.onChange?.();
    };
    dc.onmessage = (e) => this.hear(peer, String(e.data));
  }

  private say(peer: Peer, text: string): void {
    if (!peer.open || !peer.dc || peer.dc.readyState !== 'open') return;
    try {
      peer.dc.send(text);
    } catch {
      // канал закрывается — этот пакет дойдёт через сервер
    }
  }

  private hear(peer: Peer, text: string): void {
    const kind = text.charAt(0);
    if (kind === 'p') {
      this.say(peer, `q${text.slice(1)}`); // вернуть метку отправителю
      return;
    }
    if (kind === 'q') {
      const ms = performance.now() - Number(text.slice(1));
      if (!(ms >= 0) || ms > 60000) return;
      peer.samples.push(ms);
      if (peer.samples.length > KEEP) peer.samples.shift();
      const sorted = [...peer.samples].sort((a, b) => a - b);
      peer.rtt = sorted[Math.floor(sorted.length / 2)]!;
      this.onChange?.();
      return;
    }
    if (kind !== 'i' || !this.onInput) return;
    const parts = text.slice(1).split(',');
    const from = Number(parts[0]);
    const step = Number(parts[1]);
    if (!Number.isInteger(from) || !Number.isInteger(step)) return;
    // Первое число — ввод на шаг step, дальше — на предыдущие шаги.
    for (let k = 2; k < parts.length; k++) {
      const input = Number(parts[k]);
      if (Number.isInteger(input)) this.onInput(from, step - (k - 2), input);
    }
  }

  private drop(peer: Peer): void {
    peer.open = false;
    try {
      peer.dc?.close();
      peer.pc.close();
    } catch {
      // уже закрыто
    }
  }
}
