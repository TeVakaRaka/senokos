// Сервер для игры по сети: раздаёт собранную игру (dist/) и собирает игроков в комнату
// (до четырёх). В самой игре он ничего не считает — только пересылает ввод одного игрока
// остальным. Все копии игры считают одно и то же сами: симуляция одинакова на любом устройстве.
//
// Без сторонних пакетов: статика и WebSocket (RFC 6455) — на встроенном http.
// Запуск: npm run host   (сборка + сервер, см. tools/host.mjs)

import { createHash, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Версия сетевого обмена — та же, что NET_PROTOCOL в src/net/protocol.ts. */
export const PROTOCOL = 3;

/** Сколько игроков помещается в комнату — как MAX_PLAYERS там же. */
export const MAX_PLAYERS = 4;

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 16384; // байт; наши сообщения гораздо короче (самое длинное — «визитка» для прямой связи)
const MAX_RELAY = 64; // символов в сообщении, которое пересылается другу
const MAX_ROOMS = 200;
const PING_MS = 10000; // как часто проверяем, что игрок ещё на связи
const TICK_MS = 1000 / 30; // шаг игры
const MIN_DELAY = 3; // запас для ввода в одном Wi-Fi, шагов
const MAX_DELAY = 12; // больше 0,4 с запаса играть уже невозможно
const JITTER_MS = 40; // поправка на неровность связи и на кадры
const DIRECT_JITTER_MS = 55; // то же для прямой связи: мобильный интернет неровнее
const MAX_MISSED = 3; // столько проверок без ответа — и связь считается потерянной

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * На сколько шагов вперёд игрокам отправлять ввод. rtts — время «туда и обратно» от каждого
 * игрока до сервера, мс. Ввод идёт от игрока через сервер к другому игроку: дорога между
 * двумя самыми далёкими — половина суммы их замеров. Запас должен её покрывать, иначе
 * игра пойдёт медленнее настоящего времени.
 */
export function delayFor(rtts) {
  const known = rtts.filter((ms) => Number.isFinite(ms) && ms >= 0).sort((a, b) => b - a);
  if (known.length === 0) return MIN_DELAY;
  const worst = known[0];
  const second = known.length > 1 ? known[1] : known[0];
  const steps = Math.ceil(((worst + second) / 2 + JITTER_MS) / TICK_MS);
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, steps));
}

/**
 * Запас для ввода, когда игроки соединены напрямую. rtt — худшее время «туда и обратно»
 * между двумя игроками, мс: дорога в одну сторону — половина.
 */
export function delayDirect(rtt) {
  if (!Number.isFinite(rtt) || rtt < 0) return MAX_DELAY;
  const steps = Math.ceil((rtt / 2 + DIRECT_JITTER_MS) / TICK_MS);
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, steps));
}

/** Кадр WebSocket от сервера (без маски). */
function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Один подключённый игрок: разбирает входящие кадры, шлёт исходящие. */
class Peer {
  constructor(socket, onText, onGone) {
    this.socket = socket;
    this.onText = onText;
    this.onGone = onGone;
    this.room = null;
    this.index = -1; // номер игрока в начавшейся игре
    this.rtt = NaN; // замер связи от игрока, мс
    this.id = 0; // номер подключения: по нему игроки находят друг друга для прямой связи
    this.directRtt = NaN; // худший замер прямой связи с остальными, мс
    this.directCount = 0; // со сколькими игроками у него прямая связь
    this.version = '';
    this.missed = 0;
    this.gone = false;
    this.buffer = Buffer.alloc(0);
    this.parts = null; // куски сообщения, пришедшего несколькими кадрами
    socket.setNoDelay(true); // ввод идёт сразу, без накопления
    socket.on('data', (chunk) => this.read(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  finish() {
    if (this.gone) return;
    this.gone = true;
    this.socket.destroy();
    this.onGone(this);
  }

  sendText(text) {
    if (!this.gone) this.socket.write(frame(0x1, Buffer.from(text, 'utf8')));
  }

  send(message) {
    this.sendText(JSON.stringify(message));
  }

  ping() {
    if (!this.gone) this.socket.write(frame(0x9, Buffer.alloc(0)));
  }

  /** Сказать последнее слово и закрыть связь. */
  close(message) {
    if (this.gone) return;
    if (message) this.send(message);
    this.socket.end(frame(0x8, Buffer.alloc(0)));
  }

  read(chunk) {
    this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        len = big > BigInt(MAX_FRAME) ? MAX_FRAME + 1 : Number(big);
        offset = 10;
      }
      // Браузер обязан маскировать свои кадры; слишком длинных сообщений у нас не бывает.
      if (!masked || len > MAX_FRAME) {
        this.finish();
        return;
      }
      if (buf.length < offset + 4 + len) return;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buffer = buf.subarray(offset + 4 + len);

      if (opcode === 0x8) {
        this.close(); // просят закрыть — закрываем
        return;
      }
      if (opcode === 0x9) {
        if (!this.gone) this.socket.write(frame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) {
        this.missed = 0;
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) this.parts = [payload];
      else if (opcode === 0x0 && this.parts) this.parts.push(payload);
      else continue;
      if (!fin) {
        if (this.parts.length > 16) {
          this.finish();
          return;
        }
        continue;
      }
      const text = Buffer.concat(this.parts).toString('utf8');
      this.parts = null;
      this.onText(this, text);
      if (this.gone) return;
    }
  }
}

/** Адрес этого компьютера в домашней сети — его открывает второй игрок. */
function lanUrl(port) {
  const nets = networkInterfaces();
  const names = Object.keys(nets).sort((a, b) => (a === 'en0' ? -1 : b === 'en0' ? 1 : a < b ? -1 : 1));
  for (const name of names) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return `http://${net.address}:${port}`;
    }
  }
  return `http://localhost:${port}`;
}

/**
 * Запустить сервер. root — папка со сборкой игры (путь или file-URL); по умолчанию dist/
 * рядом с проектом. Возвращает порт, адрес в домашней сети и функцию остановки.
 */
export async function startServer(options = {}) {
  const port = options.port ?? 4173;
  const host = options.host ?? '0.0.0.0';
  const quiet = options.quiet ?? false;
  const rootOption = options.root ?? new URL('../dist/', import.meta.url);
  const root = resolve(rootOption instanceof URL ? fileURLToPath(rootOption) : String(rootOption));
  let lan = '';

  const log = (text) => {
    if (!quiet) console.log(`${new Date().toLocaleTimeString('ru-RU')}  ${text}`);
  };

  /**
   * Комнаты, где игроки ещё собираются: имя → { name, peers, started }. Начавшаяся игра
   * из списка убирается (её игроки продолжают держаться за неё сами), так что под тем же
   * именем сразу можно собирать следующую.
   */
  const rooms = new Map();
  const peers = new Set();
  let nextId = 1;

  /** Рассказать всем в комнате, кто в ней сейчас. Первый в списке начинает игру. */
  function announce(room) {
    const ids = room.peers.map((p) => p.id);
    room.peers.forEach((p, you) =>
      p.send({ t: 'room', count: ids.length, max: MAX_PLAYERS, you, host: you === 0, lan, id: p.id, ids }),
    );
  }

  function onText(peer, text) {
    const room = peer.room;
    if (room && room.started) {
      // Игра идёт: ввод и хеши уходят остальным как есть. Игрок подписывает сообщение
      // своим номером; чужим номером подписаться нельзя.
      const kind = text.charCodeAt(0);
      if (text.length > MAX_RELAY || (kind !== 105 && kind !== 104)) return;
      if (text.charCodeAt(1) - 48 !== peer.index || text.charCodeAt(2) !== 44) return;
      for (const other of room.peers) if (other !== peer) other.sendText(text);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg) return;

    // Замер связи: игрок шлёт метку, сервер тут же возвращает её; итог замера игрок присылает сам.
    if (msg.t === 'ping') {
      if (typeof msg.n === 'number') peer.send({ t: 'pong', n: msg.n });
      return;
    }
    if (msg.t === 'rtt') {
      if (typeof msg.ms === 'number' && msg.ms >= 0) peer.rtt = Math.min(msg.ms, 5000);
      return;
    }

    // Прямая связь между игроками: сервер только передаёт им «визитки» друг друга.
    if (msg.t === 'sig') {
      if (!room || typeof msg.to !== 'number') return;
      const target = room.peers.find((p) => p.id === msg.to);
      if (target && target !== peer) target.send({ t: 'sig', from: peer.id, data: msg.data });
      return;
    }
    // Игрок сообщает, со сколькими соединился напрямую и какая там связь.
    if (msg.t === 'p2p') {
      peer.directCount = typeof msg.n === 'number' && msg.n >= 0 ? msg.n : 0;
      peer.directRtt = typeof msg.rtt === 'number' && msg.rtt >= 0 ? Math.min(msg.rtt, 5000) : NaN;
      return;
    }

    if (room) {
      // Ждём игроков. Начать может только первый, и только когда есть с кем играть.
      if (msg.t !== 'go' || room.peers[0] !== peer || room.peers.length < 2) return;
      const seed = randomInt(1, 2147483647); // зерно поля придумывает сервер
      // Если каждый соединился с каждым напрямую, ввод пойдёт мимо сервера — запас считаем
      // по прямой связи. Иначе хотя бы одной паре придётся идти через сервер — считаем по ней.
      const others = room.peers.length - 1;
      const direct = room.peers.every((p) => p.directCount >= others && Number.isFinite(p.directRtt));
      const delay = direct
        ? delayDirect(Math.max(...room.peers.map((p) => p.directRtt)))
        : delayFor(room.peers.map((p) => p.rtt));
      room.started = true;
      rooms.delete(room.name);
      room.peers.forEach((p, you) => {
        p.index = you;
        p.send({ t: 'start', seed, you, players: room.peers.length, delay, direct });
      });
      log(
        `комната «${room.name}»: игра началась, игроков: ${room.peers.length}, ` +
          `${direct ? 'прямая связь' : 'связь через сервер'}, запас ввода: ${delay} шаг.`,
      );
      return;
    }

    if (msg.t !== 'join') return;
    const name = typeof msg.room === 'string' && msg.room.length > 0 ? msg.room.slice(0, 32) : 'main';
    const version = typeof msg.v === 'string' ? msg.v.slice(0, 64) : '';
    let target = rooms.get(name);
    if (!target) {
      if (rooms.size >= MAX_ROOMS) {
        peer.close({ t: 'full' });
        return;
      }
      target = { name, peers: [], started: false };
      rooms.set(name, target);
    }
    if (target.peers.length >= MAX_PLAYERS) {
      peer.close({ t: 'full' });
      return;
    }
    if (target.peers.length > 0 && target.peers[0].version !== version) {
      peer.close({ t: 'mismatch' });
      return;
    }
    peer.room = target;
    peer.version = version;
    target.peers.push(peer);
    announce(target);
    log(`комната «${name}»: игроков ${target.peers.length}`);
  }

  function onGone(peer) {
    peers.delete(peer);
    const room = peer.room;
    if (!room) return;
    peer.room = null;
    room.peers = room.peers.filter((p) => p !== peer);
    if (room.started) {
      // Игра продолжается без него: остальные узнают, кто вышел.
      for (const other of room.peers) other.send({ t: 'left', who: peer.index });
      log(`комната «${room.name}»: игрок ${peer.index + 1} вышел из игры`);
      return;
    }
    if (room.peers.length === 0) rooms.delete(room.name);
    else announce(room);
    log(`комната «${room.name}»: игроков ${room.peers.length}`);
  }

  async function onRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const send = (status, type, body) => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': body.length,
        // Сборка меняется между запусками — пусть браузер всегда спрашивает свежую.
        'cache-control': 'no-cache',
        // Игра может лежать на другом адресе (хостинг), а сюда ходить только за комнатой.
        'access-control-allow-origin': '*',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (path === '/api/ping') {
      // По этому ответу игра понимает, что здесь можно играть по сети.
      send(200, TYPES['.json'], Buffer.from(JSON.stringify({ senokos: PROTOCOL, lan })));
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      send(403, TYPES['.txt'], Buffer.from('Нельзя'));
      return;
    }
    try {
      const body = await readFile(file);
      send(200, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body);
    } catch {
      send(404, TYPES['.txt'], Buffer.from('Не найдено'));
    }
  }

  const server = createServer((req, res) => {
    onRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    let path = '';
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // оставим пустым — ниже откажем
    }
    const key = req.headers['sec-websocket-key'];
    if (path !== '/ws' || typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const peer = new Peer(socket, onText, onGone);
    peer.id = nextId++;
    peers.add(peer);
    if (head && head.length > 0) peer.read(head);
  });

  // Телефон мог уснуть или уйти из сети молча: кто долго не отвечает — считается вышедшим.
  const pinger = setInterval(() => {
    for (const peer of peers) {
      if (peer.missed >= MAX_MISSED) {
        peer.finish();
        continue;
      }
      peer.missed++;
      peer.ping();
    }
  }, PING_MS);
  pinger.unref();

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done();
    });
  });
  const actualPort = server.address().port;
  // Адрес, который сервер называет игрокам. На сервере в интернете его задают явно:
  // сам он видит только свои сетевые карты и может назвать не ту.
  lan = typeof options.publicUrl === 'string' && options.publicUrl ? options.publicUrl : lanUrl(actualPort);

  return {
    port: actualPort,
    lan,
    root,
    close: () =>
      new Promise((done) => {
        clearInterval(pinger);
        for (const peer of peers) peer.finish();
        server.close(() => done());
        server.closeAllConnections?.();
      }),
  };
}
