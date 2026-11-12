// Точка входа: собирает симуляцию, картинку и управление, крутит игровой цикл.
//
// Параметры адреса:
//   ?mode=solo|pvp|net — один на поле, против бота или с друзьями по сети (до четырёх)
//                        (по умолчанию — как в прошлый раз; net работает, когда игру
//                        раздаёт сервер из tools/server.mjs: npm run host)
//   ?room=имя      — комната для игры по сети (по умолчанию одна на сервер)
//   ?go=1          — начать сразу, без заставки
//   ?seed=123      — зерно поля (по умолчанию — номер сегодняшнего дня)
//   ?auto=1        — за игрока играет бот
//   ?debug=1       — панель с ползунками баланса
//   ?q=low         — простое качество картинки
//   ?look=a|b|c    — вариант внешнего вида (июль, август, игрушка)
//   ?selftest=1    — проверка одинаковости расчётов на этом устройстве

import './ui/ui.css';
import { autoplay } from './sim/autoplay.ts';
import { botInput, createBot, type Bot } from './sim/bot.ts';
import { nearestTuft, standingWithin } from './sim/field.ts';
import { createGame, INPUT_SWAP, step, TOOL_RAKE, TOOL_SCYTHE, type Game, type Player } from './sim/game.ts';
import { dropsKg, groundKg, isDry } from './sim/hay.ts';
import { CHOICE_BASE } from './sim/perks.ts';
import { hashGame, hashTuning, hex8 } from './sim/hash.ts';
import { Recorder } from './sim/replay.ts';
import { cloneTuning, DEFAULT_TUNING, DT, type Tuning } from './sim/tuning.ts';
import { NetLink, type RoomState } from './net/link.ts';
import { Lockstep } from './net/lockstep.ts';
import { Mesh } from './net/p2p.ts';
import { DEFAULT_ROOM, HASH_EVERY, INPUT_DELAY, NET_PROTOCOL } from './net/protocol.ts';
import { Sound } from './audio/audio.ts';
import { lookById, LOOKS } from './render/look.ts';
import { QUALITY_HIGH, QUALITY_LOW, View, type StepFx } from './render/view.ts';
import { Hud } from './ui/hud.ts';
import { Joystick } from './ui/joystick.ts';
import { PerkCards } from './ui/perkCards.ts';
import { colorName, colorWhose, playerCss, playerInk } from './ui/players.ts';
import { Results } from './ui/results.ts';
import { Toast } from './ui/toast.ts';
import { ToolButton } from './ui/tool.ts';
import { Platform } from './platform/platform.ts';

type Mode = 'solo' | 'pvp' | 'net';

/** Всё для игры по сети. */
interface NetSetup {
  link: NetLink;
  lock: Lockstep;
  direct: boolean; // все игроки соединены друг с другом напрямую, мимо сервера
  via: { direct: number; relay: number }; // сколько вводов пришло первым напрямую и через сервер
}

/** С чем запускается день. */
interface Setup {
  mode: Mode;
  seed: number;
  me: number; // номер своего игрока: по сети он у каждого свой
  players: number; // сколько игроков на поле
  counted: boolean; // идёт ли итог в счёт побед
  net: NetSetup | null;
}

const params = new URLSearchParams(location.search);
const TUNING_KEY = 'senokos.tuning';
const BEST_KEY = 'senokos.best';
const MODE_KEY = 'senokos.mode';
const PVP_KEY = 'senokos.pvp';

const COUNTDOWN_MS = 3000; // отсчёт перед игрой по сети
const CHOICE_TIMEOUT_MS = 12000; // по сети улучшение выбирается само, если тянуть: друг ждёт
const MAX_CATCH_UP = 6; // сколько шагов за кадр можно сделать, догоняя
/** По сети вместе играют только одинаковые версии: тот же обмен и те же числа баланса. */
const NET_VERSION = `${NET_PROTOCOL}.${hex8(hashTuning(DEFAULT_TUNING))}`;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // хранилище недоступно (приватный режим)
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // хранилище недоступно — просто не запомнится
  }
}

function readBest(): number {
  return Number(readStored(BEST_KEY)) || 0;
}

/** Сколько сыграно против бота и сколько из этого побед. */
function readPvp(): { games: number; wins: number } {
  try {
    const saved = JSON.parse(readStored(PVP_KEY) ?? '{}') as { games?: number; wins?: number };
    return { games: Number(saved.games) || 0, wins: Number(saved.wins) || 0 };
  } catch {
    return { games: 0, wins: 0 };
  }
}

/** Режим, в который играли в прошлый раз (игра по сети сюда не попадает). */
function storedMode(): 'solo' | 'pvp' {
  return readStored(MODE_KEY) === 'pvp' ? 'pvp' : 'solo';
}

function readMode(): Mode {
  const asked = params.get('mode');
  if (asked === 'pvp' || asked === 'solo' || asked === 'net') return asked;
  return storedMode();
}

/** Открыть игру заново в нужном режиме: сразу в бой или на заставку. */
function restart(mode: Mode, autostart: boolean): void {
  const next = new URLSearchParams(location.search);
  next.set('mode', mode);
  if (autostart) next.set('go', '1');
  else next.delete('go');
  const query = `?${next.toString()}`;
  if (query === location.search) location.reload();
  else location.search = query;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el;
}

function todaySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function loadTuning(): Tuning {
  const t = cloneTuning(DEFAULT_TUNING);
  if (!params.has('debug')) return t;
  try {
    const saved = sessionStorage.getItem(TUNING_KEY);
    if (saved) Object.assign(t, JSON.parse(saved));
  } catch {
    // хранилище недоступно (приватный режим) — играем со стандартными числами
  }
  return t;
}

const platform = new Platform();

/**
 * Где сервер игры по сети. Либо он сам раздаёт эту страницу, либо игра лежит на обычном
 * хостинге, а адрес сервера записан рядом, в net.json. Возвращает адрес (http…) или null.
 */
async function findServer(): Promise<string | null> {
  const answers = async (base: string): Promise<boolean> => {
    try {
      const r = await fetch(`${base}/api/ping`, { cache: 'no-store' });
      if (!r.ok) return false;
      return ((await r.json()) as { senokos?: number }).senokos === NET_PROTOCOL;
    } catch {
      return false; // сервера нет или это не он
    }
  };
  const here = new URL('.', location.href).href.replace(/\/+$/, '');
  if (await answers(here)) return here;
  try {
    const r = await fetch('./net.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const config = (await r.json()) as { server?: unknown };
    if (typeof config.server !== 'string' || !/^https?:\/\//.test(config.server)) return null;
    const base = config.server.replace(/\/+$/, '');
    return (await answers(base)) ? base : null;
  } catch {
    return null;
  }
}

if (params.has('selftest')) void runSelftest();
else boot();

function boot(): void {
  // Оболочку готовим заранее, но игру не ждём: если Telegram тормозит, сайт всё равно стартует.
  const platformReady = platform.init();
  const mode = readMode();
  if (mode === 'net') {
    runLobby(platformReady);
    return;
  }
  const fixedSeed = Number(params.get('seed'));
  // В одиночку поле на весь день одно — результаты можно сравнивать. Против бота каждый
  // раз новое, иначе бот ходил бы одинаково.
  const seed = fixedSeed || (mode === 'pvp' ? todaySeed() * 100 + (readPvp().games % 100) : todaySeed());
  // Показ бота и забеги с заданным зерном в счёт побед не идут.
  startGame(platformReady, {
    mode,
    seed,
    me: 0,
    players: mode === 'pvp' ? 2 : 1,
    counted: !fixedSeed && !params.has('auto'),
    net: null,
  });
}

/**
 * Комната перед игрой по сети: найти сервер, подключиться, дождаться друзей и начать.
 * Поле создаётся только после этого: его зерно присылает сервер, одно на всех.
 */
function runLobby(platformReady: Promise<void>): void {
  const text = $('overlay-text');
  const action = $('overlay-action');
  const startButton = $('overlay-start') as HTMLButtonElement;
  const share = $('overlay-share');
  $('mode-row').hidden = true;
  $('look-row').hidden = true;
  $('hud').hidden = true;
  action.textContent = 'Отмена';
  action.hidden = false;
  action.onclick = () => restart(storedMode(), false);
  text.textContent = 'Подключаюсь к серверу…';

  const room = (params.get('room') || DEFAULT_ROOM).slice(0, 32);

  // Какой адрес назвать друзьям. Открыто на самом компьютере с сервером — адрес этого
  // компьютера в сети; иначе — тот, по которому зашли сами: он годится и остальным.
  const host = location.hostname;
  const onServer = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const homeNet = onServer || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const page = `${location.origin}${location.pathname}`.replace(/\/$/, '');
  // Ссылка сразу в эту комнату — другу не надо искать кнопку.
  const invite = new URL(location.href);
  invite.search = room === DEFAULT_ROOM ? '?mode=net' : `?mode=net&room=${encodeURIComponent(room)}`;
  invite.hash = '';

  void findServer().then((server) => {
    if (server) {
      openRoom(server);
      return;
    }
    text.textContent = 'Сервер игры по сети сейчас не работает. Сыграть можно одному или против бота.';
    action.textContent = 'В меню';
  });

  function openRoom(server: string): void {
    const link = new NetLink(`${server.replace(/^http/, 'ws')}/ws`, room, NET_VERSION);
    startButton.onclick = () => link.go();

    // «Позвать друзей»: поделиться ссылкой или скопировать её (браузер даёт это только по https).
    const canShare = typeof navigator.share === 'function';
    const canCopy = typeof navigator.clipboard?.writeText === 'function';
    share.hidden = onServer || (!canShare && !canCopy);
    share.onclick = () => {
      const copied = () => {
        share.textContent = 'Ссылка скопирована';
        window.setTimeout(() => (share.textContent = 'Позвать друзей'), 1600);
      };
      if (canShare) void navigator.share({ title: 'Сенокос', text: 'Заходи косить', url: invite.href }).catch(() => {});
      else void navigator.clipboard.writeText(invite.href).then(copied, () => {});
    };

    let pingMs = -1;
    let lastState: RoomState | null = null;
    let mesh: Mesh | null = null; // прямая связь с остальными игроками
    let roomChangedAt = performance.now();
    const via = { direct: 0, relay: 0 };
    const draw = () => {
      const state = lastState;
      if (!state) return;
      text.textContent = '';
      text.append(`В комнате игроков: ${state.count} из ${state.max}.`, document.createElement('br'));
      if (platform.telegram) {
        // В Telegram адрес не нужен: друзьям достаточно открыть того же бота.
        text.append('Друзья открывают этого же бота: «Играть» → «С друзьями».');
      } else {
        const address = document.createElement('b');
        address.textContent = onServer ? state.lan || page : page;
        text.append(
          homeNet ? 'Друзья открывают в том же Wi‑Fi адрес' : 'Друзья открывают адрес',
          document.createElement('br'),
          address,
          document.createElement('br'),
          'и нажимают «С друзьями».',
        );
      }
      if (!state.host) text.append(document.createElement('br'), 'Игру начнёт тот, кто зашёл первым.');
      if (pingMs >= 0) text.append(document.createElement('br'), `Связь с сервером: ${pingMs} мс.`);
      if (state.count > 1) {
        // Напрямую ввод идёт от игрока к игроку, мимо сервера, — так гораздо быстрее.
        const all = mesh !== null && mesh.measured >= state.count - 1;
        const line = all
          ? `Прямая связь с друзьями: ${Math.round(mesh!.rtt)} мс.`
          : performance.now() - roomChangedAt < 8000 && mesh !== null
            ? 'Прямая связь устанавливается…'
            : 'Прямой связи нет: игра пойдёт через сервер и будет запаздывать.';
        text.append(document.createElement('br'), line);
      }
      // Начинает первый в комнате — когда все в сборе.
      startButton.hidden = !state.host;
      startButton.disabled = state.count < 2;
      startButton.textContent = state.count < 2 ? 'Ждём друзей…' : `Начать игру: ${state.count}`;
    };

    // Для отладки из консоли: состояние прямой связи в комнате.
    Object.assign(window, {
      senokosRoom: {
        direct: () => (mesh ? { measured: mesh.measured, rtt: mesh.rtt, peers: mesh.describe() } : null),
        via,
      },
    });

    link.events = {
      room: (state) => {
        lastState = state;
        roomChangedAt = performance.now();
        // С каждым, кто в комнате, пробуем соединиться напрямую.
        if (!mesh && state.id > 0 && Mesh.supported()) {
          const created = new Mesh(state.id, (to, card) => link.signal(to, card));
          created.onChange = () => {
            link.reportDirect(created.rtt, created.measured);
            draw();
          };
          mesh = created;
        }
        mesh?.setPeers(state.ids.filter((id) => id !== state.id));
        draw();
        window.setTimeout(draw, 8200); // если прямой связи так и нет — сказать об этом
      },
      ping: (ms) => {
        pingMs = ms;
        draw();
      },
      signal: (from, card) => mesh?.signal(from, card),
      start: (seed, you, players, delay, direct) => {
        // Запас для ввода назначает сервер — один на всех, по замеру связи игроков.
        const steps = Math.max(INPUT_DELAY, Math.min(15, Math.round(delay) || INPUT_DELAY));
        const fast = mesh;
        // Свой ввод уходит двумя дорогами: напрямую (быстро) и через сервер (наверняка).
        const lock = new Lockstep(you, players, steps, (step, input) => {
          link.sendInput(step, input);
          fast?.sendInput(you, step, input);
        });
        // Ввод остальных начинает приходить уже во время отсчёта — копим его с первой секунды.
        // Чей экземпляр пришёл первым, тот и считается.
        link.events = {
          input: (from, step, input) => {
            if (lock.receive(from, step, input)) via.relay++;
          },
        };
        if (fast) {
          fast.onChange = null;
          fast.onInput = (from, step, input) => {
            if (lock.receive(from, step, input)) via.direct++;
          };
        }
        $('hud').hidden = false;
        action.hidden = true;
        startButton.hidden = true;
        share.hidden = true;
        startGame(platformReady, {
          mode: 'net',
          seed,
          me: you,
          players,
          counted: false,
          net: { link, lock, direct, via },
        });
      },
      problem: (kind) => {
        startButton.hidden = true;
        share.hidden = true;
        text.textContent =
          kind === 'full'
            ? 'В комнате нет мест. Подождите, пока там доиграют, и зайдите снова.'
            : kind === 'mismatch'
              ? 'У друзей другая версия игры. Закройте игру и откройте заново — на всех устройствах.'
              : 'Связь с сервером игры по сети пропала. Попробуйте зайти ещё раз.';
        action.textContent = 'В меню';
      },
    };
  }
}

function startGame(platformReady: Promise<void>, setup: Setup): void {
  const { mode, seed, net } = setup;
  const ME = setup.me;
  const duel = setup.players > 1;
  // Как называть соперника k: кто он («Бот», «Друг», «Синий») и чей («бота», «друга», «синего»).
  const who = (k: number): string => {
    if (!net) return 'Бот';
    if (setup.players === 2) return 'Друг';
    const name = colorName(k);
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  const whose = (k: number): string => (!net ? 'бота' : setup.players === 2 ? 'друга' : colorWhose(k));
  const pvp = readPvp();
  // По сети числа баланса у всех обязаны совпадать — отладочные ползунки там не действуют.
  const tuning = net ? cloneTuning(DEFAULT_TUNING) : loadTuning();
  const game = createGame(seed, tuning, setup.players);
  const me = game.players[ME]!;
  const autopilot = params.has('auto');
  // За кого играют боты: за соперника — когда он не человек; за своего — только в режиме показа.
  const bots: (Bot | null)[] = game.players.map((p) =>
    p.id === ME ? (autopilot ? createBot(seed, p.id) : null) : net ? null : createBot(seed, p.id),
  );
  const recorder = new Recorder();
  const frameInputs = new Array<number>(game.players.length).fill(0);

  const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
  const quality = params.get('q') === 'low' || (params.get('q') !== 'high' && lowEnd) ? QUALITY_LOW : QUALITY_HIGH;

  const canvas = $('game') as HTMLCanvasElement;
  const look = lookById(params.get('look'));
  const view = new View(canvas, game, quality, look, ME);
  const sound = new Sound();
  const joystick = new Joystick($('touch'), $('stick-base'), $('stick-knob'));

  const overlay = $('overlay');
  const overlayText = $('overlay-text');
  const overlayAction = $('overlay-action');
  const modeRow = $('mode-row');
  const lookRow = $('look-row');
  const countdown = $('countdown');
  const debugLine = $('debug-line');
  const hud = new Hud(ME, game.players.length, `кг у ${whose((ME + 1) % game.players.length)}`);
  const cards = new PerkCards();
  const results = new Results();
  const toast = new Toast();
  let swapQueued = false; // нажата кнопка инструмента — уйдёт в ввод ближайшего шага
  const tool = new ToolButton(() => {
    swapQueued = true;
  });

  let started = false;
  let startAt = 0; // по сети: в какой момент (часы кадра, мс) кончится отсчёт и начнётся день
  let lostContext = false;
  let halted = false; // по сети: связь оборвалась, день не доигран

  /** Начать день. byTouch — из нажатия на кнопку: только тогда браузер даёт включить звук. */
  function begin(byTouch: boolean): void {
    started = true;
    overlay.hidden = true;
    tool.setVisible(true);
    if (byTouch) sound.unlock();
    void platformReady.then(() => platform.setPlaying(true));
  }

  /** Показать заставку с сообщением и одной кнопкой «В меню» (обрыв связи, сбой картинки). */
  function showStop(message: string, button: string, onClick: () => void): void {
    cards.hide();
    toast.hide();
    tool.setVisible(false);
    countdown.hidden = true;
    overlayText.textContent = message;
    modeRow.hidden = true;
    lookRow.hidden = true;
    overlayAction.textContent = button;
    overlayAction.hidden = false;
    overlayAction.onclick = onClick;
    overlay.hidden = false;
  }

  // Отсчёт: цифра и подпись, какого ты цвета, — чтобы найти себя на поле.
  const countdownDigit = document.createElement('b');
  const countdownLabel = document.createElement('small');
  const swatch = document.createElement('i');
  swatch.style.background = playerCss(ME);
  countdownLabel.append(swatch, `ты — ${colorName(ME)}`);
  countdown.textContent = '';
  countdown.append(countdownDigit, countdownLabel);

  if (net) {
    // По сети день начинается у всех после короткого отсчёта.
    overlay.hidden = true;
    tool.setVisible(true);
    startAt = performance.now() + COUNTDOWN_MS;
    void platformReady.then(() => platform.setPlaying(true));
    if (!net.direct) toast.show('Прямой связи нет — управление будет запаздывать', 'bad');
    const stop = (message: string) => {
      if (game.over || halted) return;
      halted = true;
      platform.setPlaying(false);
      showStop(message, 'В меню', () => restart(storedMode(), false));
    };
    net.link.events.problem = () => stop('Связь с сервером потеряна. День не доигран.');
    net.link.events.gone = (k) => {
      // Вышедший дальше стоит на месте; остальные доигрывают. Один в поле — не игра.
      net.lock.drop(k);
      if (game.over || halted) return;
      if (net.lock.others === 0) stop(setup.players === 2 ? 'Друг отключился. День не доигран.' : 'Все соперники вышли. День не доигран.');
      else toast.show(`${who(k)} вышел из игры`, 'plain');
    };
  } else {
    // Режим, в который играли в прошлый раз, уже загружен и стартует сразу; другой — с перезагрузкой.
    const choose = (wanted: 'solo' | 'pvp') => {
      writeStored(MODE_KEY, wanted);
      if (wanted === mode) begin(true);
      else restart(wanted, true);
    };
    const soloButton = $('play-solo');
    const pvpButton = $('play-pvp');
    const netButton = $('play-net');
    soloButton.classList.toggle('primary', mode === 'solo');
    pvpButton.classList.toggle('primary', mode === 'pvp');
    soloButton.addEventListener('click', () => choose('solo'));
    pvpButton.addEventListener('click', () => choose('pvp'));
    netButton.addEventListener('click', () => restart('net', false));
    // Кнопка «С друзьями» есть, только пока работает сервер игры по сети.
    void findServer().then((server) => {
      if (server) netButton.hidden = false;
    });

    if (params.has('go') || autopilot) begin(false);
  }

  // При старте без нажатия на кнопку звук включится с первым касанием: раньше браузер не даёт.
  const wake = () => {
    if (!started && startAt === 0) return;
    sound.unlock();
    if (!sound.isRunning()) return;
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.removeEventListener(type, wake);
  };
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(type, wake);

  document.addEventListener('visibilitychange', () => sound.setActive(!document.hidden));
  // В Telegram игру можно свернуть, не закрывая: тогда пауза и тишина.
  platform.onActiveChange((active) => sound.setActive(active && !document.hidden));

  // Переключатель вида травы: перезагружает страницу с другим ?look=.
  for (const option of LOOKS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = option.title;
    chip.setAttribute('aria-pressed', String(option.id === look.id));
    chip.addEventListener('click', () => {
      if (option.id === look.id) return;
      const next = new URLSearchParams(location.search);
      next.set('look', option.id);
      location.search = next.toString();
    });
    lookRow.appendChild(chip);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lostContext = true;
    showStop('Картинка сбросилась. Обновите страницу, чтобы продолжить.', 'Обновить', () => location.reload());
  });

  window.addEventListener('resize', () => view.resize());
  window.visualViewport?.addEventListener('resize', () => view.resize());

  /** Ввод своего игрока на шаг: направление пальца плюс кнопка инструмента. */
  function playerInput(): number {
    let input = 0;
    if (joystick.x !== 0 || joystick.y !== 0) {
      const [wx, wy] = view.iso.screenToSim(joystick.x, joystick.y);
      const turn = Math.atan2(wy, wx) / (Math.PI * 2);
      input = ((Math.round(turn * 64) % 64) + 64) % 64 + 1;
    }
    if (swapQueued) {
      swapQueued = false;
      input += INPUT_SWAP;
    }
    return input;
  }

  let last = performance.now();
  let acc = 0;
  let fps = 60;
  let debugTimer = 0;
  let hintTimer = 0;
  let hint = -1; // какой инструмент сейчас пригодился бы
  let frozen = false; // отладочная пауза: кадры идут только по команде advance()

  // Только для игры по сети.
  let pendingChoice = 0; // выбранное улучшение: уйдёт другу с вводом ближайшего шага
  let choiceSent = false; // выбор сделан и уже в пути — карточки больше не показывать
  let cardsShownAt = 0;
  let waitingFor = 0; // сколько секунд подряд нет ввода друга
  let desynced = false;
  let hashChecks = 0; // сколько раз состояние совпало с чужим
  const myHashes = new Map<number, number>(); // свой хеш по числу шагов
  const theirHashes = new Map<number, [number, number][]>(); // чужие: [игрок, хеш]

  /** Звук, вибрация и подсказки по событиям шага. */
  function react(fx: StepFx): void {
    if (fx.swung) {
      sound.swing(fx.swingCut / 25);
      platform.haptic();
    }
    if (fx.foeSwing > 0.05) sound.swing(0.3, 0.45 * fx.foeSwing);
    if (fx.raked > 0 || fx.stole > 0) sound.rake();
    if (fx.unloaded > 0 || fx.picked > 0) sound.thump();
    if (fx.swapped) sound.swap();
    if (fx.hit) {
      sound.slash();
      platform.haptic('heavy');
      toast.show(fx.hitLoot > 0.5 ? 'Подрезал! Его тюк упал — забирай' : 'Подрезал!', 'good');
    }
    if (fx.knock > 0) {
      sound.whack();
      platform.haptic('heavy');
      toast.show(`Выбил ${Math.round(fx.knock)} кг сена из тюка!`, 'good');
    }
    if (fx.hurt) {
      sound.ouch();
      platform.haptic('heavy');
      hud.flash();
      toast.show(fx.dropped > 0.5 ? 'Тебе подрезали ноги — тюк упал!' : 'Тебе подрезали ноги!', 'bad');
    }
    if (fx.lost > 0) {
      sound.whack();
      platform.haptic('heavy');
      toast.show('По тюку! Сено выбили — уноси ноги', 'bad');
    }
    if (fx.robbed > 0) {
      sound.alarm();
      hud.alarm();
      toast.show(`${who(fx.robber)} тащит сено из твоего стога!`, 'bad', 4000);
    }
    if (fx.stole > 0) toast.show('Тащишь сено из чужого стога', 'good', 6000);
  }

  /** Один шаг симуляции (или выбор улучшения) вместе с эффектами, звуком и вибрацией. */
  function apply(inputs: readonly number[]): void {
    recorder.pushAll(inputs);
    const hadCombo = me.d.combo;
    step(game, inputs);
    react(view.onStep(game));
    if (!hadCombo && me.d.combo) toast.show('Синтез! Коса и грабли работают вместе', 'good');
  }

  function tick(): void {
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      frameInputs[i] = bot ? botInput(game, bot) : playerInput();
    }
    apply(frameInputs);
  }

  function anyOffer(): boolean {
    for (const p of game.players) if (p.offer !== null) return true;
    return false;
  }

  /** Боты выбирают улучшение сразу. Возвращает true, если кто-то из них выбрал. */
  function botsChoose(): boolean {
    let chose = false;
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const choosing = bot !== null && bot !== undefined && game.players[i]!.offer !== null;
      frameInputs[i] = choosing ? botInput(game, bot) : 0;
      if (choosing) chose = true;
    }
    if (chose) apply(frameInputs);
    return chose;
  }

  /** Игра ждёт: выбор улучшения или конец дня. Показать нужный экран. */
  function handleWaiting(): void {
    botsChoose();
    if (me.offer !== null && !bots[ME]) {
      if (!cards.visible) {
        swapQueued = false;
        sound.levelUp();
        cards.show(me.offer, me.perks, game.tuning.perkMaxLevel, game.tuning, (index) => {
          frameInputs.fill(0);
          frameInputs[ME] = CHOICE_BASE + index;
          apply(frameInputs);
          last = performance.now();
        });
      }
      return;
    }
    if (game.over && !results.visible) showResults();
  }

  // ——— Игра по сети ———

  /** Что свой игрок нажимает сейчас: по сети это сработает через несколько шагов. */
  function sampleInput(): number {
    const bot = bots[ME];
    if (bot) return botInput(game, bot);
    if (pendingChoice !== 0) {
      const choice = pendingChoice;
      pendingChoice = 0;
      return choice;
    }
    return playerInput();
  }

  /** Сверить состояние с остальными, когда все прошли одно и то же число шагов. */
  function compareHashes(steps: number): void {
    const mine = myHashes.get(steps);
    const theirs = theirHashes.get(steps);
    if (mine === undefined || theirs === undefined) return;
    theirHashes.delete(steps);
    for (const [from, hash] of theirs) {
      if (hash === mine) hashChecks++;
      if (hash === mine || desynced) continue;
      desynced = true;
      console.warn(`Игры разошлись на шаге ${steps}: у меня ${hex8(mine)}, у игрока ${from} — ${hex8(hash)}`);
      toast.show('Игры разошлись: счёт у вас может не совпасть', 'bad');
    }
    // Свои старые хеши больше не понадобятся.
    for (const key of myHashes.keys()) if (key < steps - HASH_EVERY * 4) myHashes.delete(key);
  }

  /** После каждого шага по сети: выбор улучшения дошёл? пора сверить состояние? */
  function afterNetStep(link: NetLink, lock: Lockstep): void {
    if (me.offer === null) choiceSent = false;
    if (lock.done % HASH_EVERY !== 0) return;
    const hash = hashGame(game);
    myHashes.set(lock.done, hash);
    link.sendHash(lock.done, hash);
    compareHashes(lock.done);
  }

  /** По сети: карточки улучшений (время стоит у обоих, пока кто-то выбирает) и итоги. */
  function netWaiting(now: number): void {
    if (game.over) {
      if (!results.visible) showResults();
      return;
    }
    if (me.offer !== null && !bots[ME] && !choiceSent) {
      if (!cards.visible) {
        swapQueued = false;
        sound.levelUp();
        cardsShownAt = now;
        cards.show(me.offer, me.perks, game.tuning.perkMaxLevel, game.tuning, (index) => {
          pendingChoice = CHOICE_BASE + index;
          choiceSent = true;
        });
      } else if (now - cardsShownAt > CHOICE_TIMEOUT_MS) {
        // Друг ждёт: если долго не выбирать, берётся первая карточка.
        cards.hide();
        pendingChoice = CHOICE_BASE;
        choiceSent = true;
      }
    }
    if (me.offer === null) {
      const chooser = game.players.find((p) => p.offer !== null);
      if (chooser) toast.show(`${who(chooser.id)} выбирает улучшение…`, 'plain', 2500);
    }
  }

  if (net) {
    net.link.events.hash = (from, steps, hash) => {
      const list = theirHashes.get(steps);
      if (list) list.push([from, hash]);
      else theirHashes.set(steps, [[from, hash]]);
      compareHashes(steps);
    };
  }

  function showResults(): void {
    platform.setPlaying(false);
    tool.setVisible(false);
    toast.hide();
    cards.hide();
    const again = () => restart(mode, mode !== 'net');
    const menu = () => restart(mode === 'net' ? storedMode() : mode, false);
    if (duel) {
      if (setup.counted) {
        pvp.games++;
        if (game.players.every((p) => p === me || Math.floor(p.stacked) < Math.floor(me.stacked))) pvp.wins++;
        writeStored(PVP_KEY, JSON.stringify(pvp));
      }
      results.showMatch(
        {
          scores: game.players.map((p) => ({
            kg: p.stacked,
            label: p === me ? 'у тебя' : `у ${whose(p.id)}`,
            ink: playerInk(p.id),
            me: p === me,
          })),
          hits: me.hits,
          hurt: me.hurt,
          knocked: me.knocked,
          stolen: me.stolen,
          lost: me.robbed,
          perks: me.level,
          wins: setup.counted ? pvp.wins : 0,
          games: setup.counted ? pvp.games : 0,
        },
        again,
        menu,
      );
      return;
    }
    const best = readBest();
    const kg = Math.floor(me.stacked);
    if (kg > best) writeStored(BEST_KEY, String(kg));
    results.show(
      {
        stacked: me.stacked,
        mownShare: me.cutTufts / Math.max(1, game.field.count),
        groundKg: groundKg(game) + dropsKg(game) + me.load,
        perks: me.level,
        best,
      },
      again,
      menu,
    );
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    update(now);
  }

  /** Один кадр: шаги симуляции за прошедшее время, экраны ожидания, картинка. */
  function update(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // вкладка была свёрнута или кадр завис — не догоняем рывком
    if (dt <= 0 || frozen) return;
    fps += (1 / dt - fps) * 0.05;

    // Отсчёт перед игрой по сети.
    if (!started && startAt > 0) {
      const left = startAt - now;
      if (left <= 0) {
        started = true;
        countdown.hidden = true;
      } else {
        const digit = String(Math.ceil(left / 1000));
        if (countdownDigit.textContent !== digit) countdownDigit.textContent = digit;
        countdown.hidden = false;
      }
    }

    let alpha = 1; // доля пути между прошлым и текущим шагом — для плавной картинки
    if (net) {
      const { link, lock } = net;
      if (started && !halted && !lostContext && !game.over) {
        acc += dt;
        let steps = 0;
        // Шаг делается, только когда известен ввод друга; отставание догоняем понемногу.
        while (acc >= DT && steps < MAX_CATCH_UP && lock.ready && !game.over) {
          lock.advance(sampleInput(), frameInputs);
          apply(frameInputs);
          afterNetStep(link, lock);
          acc -= DT;
          steps++;
        }
        if (lock.ready) {
          waitingFor = 0;
          if (acc > DT * MAX_CATCH_UP) acc = DT * MAX_CATCH_UP;
        } else {
          // Ввод друга ещё в пути: игра стоит, время не копится.
          if (acc > DT) acc = DT;
          waitingFor += dt;
          if (waitingFor > 0.7) toast.show(setup.players === 2 ? 'Ждём друга…' : 'Ждём остальных…', 'plain', 1500);
        }
        // Пока кто-то выбирает улучшение, шаги идут, а время стоит — картинку не двигаем.
        if (!anyOffer() && !game.over) alpha = Math.min(1, acc / DT);
      }
      if (started && !halted) netWaiting(now);
    } else {
      const waiting = anyOffer() || game.over;
      const running = started && !document.hidden && !lostContext && platform.active && !waiting;
      if (running) {
        acc += dt;
        while (acc >= DT) {
          tick();
          acc -= DT;
          if (anyOffer() || game.over) {
            acc = 0;
            break;
          }
        }
        alpha = acc / DT;
      }
      if (started && (anyOffer() || game.over)) handleWaiting();
    }

    if (!lostContext) view.render(game, alpha, dt);
    hud.update(game, view);

    hintTimer += dt;
    if (hintTimer > 0.2) {
      hintTimer = 0;
      hint = toolHint(game, me);
    }
    tool.update(me, hint);

    debugTimer += dt;
    if (debugTimer > 0.5) {
      debugTimer = 0;
      debugLine.textContent = `${Math.round(fps)} к/с · ${Math.round(view.triangles / 1000)} тыс. треуг. · ${view.qualityName} · ${look.title}`;
    }
  }
  requestAnimationFrame(frame);

  if (params.has('debug') && !net) void openDebugPanel(tuning);

  /** Шаг для отладочной прокрутки: боты выбирают сами; на своём выборе прокрутка встаёт. */
  function debugStep(): boolean {
    if (net) return false; // по сети шаги идут только вместе с другом — см. pump()
    if (anyOffer()) {
      botsChoose();
      if (anyOffer()) return false;
    }
    tick();
    view.render(game, 1, DT);
    return true;
  }

  // Для отладки из консоли браузера и для покадровых снимков.
  Object.assign(window, {
    senokos: {
      game,
      view,
      recorder,
      sound,
      lock: net ? net.lock : null,
      /** По сети: сколько шагов пройдено, сколько сверок состояния сошлось, не разошлись ли игры. */
      sync: () =>
        net
          ? {
              done: net.lock.done,
              checks: hashChecks,
              desynced,
              others: net.lock.others,
              direct: net.direct,
              via: net.via,
            }
          : null,
      hash: () => hex8(hashGame(game)),
      freeze: (on: boolean) => {
        frozen = on;
        last = performance.now();
      },
      /** Прокрутить игру на заданное число шагов, рисуя каждый. Работает на паузе. */
      advance: (ticks: number) => {
        for (let i = 0; i < ticks && !game.over; i++) if (!debugStep()) break;
        hud.update(game, view);
        tool.update(me, toolHint(game, me));
      },
      /** Прокрутить до события: 'swing' — свой взмах, 'hit' — кому-то подрезали ноги. */
      advanceTo: (what: 'swing' | 'hit' | 'hurt' | 'steal', after = 0, limit = 5400) => {
        const happened = () =>
          what === 'swing'
            ? me.swing !== null
            : what === 'hurt'
              ? me.hitBy >= 0
              : what === 'steal'
                ? game.players.some((p) => p.stolenKg > 0)
                : game.players.some((p) => p.hitBy >= 0);
        let found = false;
        for (let i = 0; i < limit && !game.over; i++) {
          if (!debugStep()) break;
          if (happened()) {
            found = true;
            break;
          }
        }
        for (let i = 0; i < after && !game.over; i++) if (!debugStep()) break;
        hud.update(game, view);
        tool.update(me, toolHint(game, me));
        return found;
      },
      /** Прокрутить до ближайшего взмаха и ещё на несколько шагов после него. */
      advanceToSwing: (after: number) => {
        for (let i = 0; i < 600 && !game.over; i++) {
          if (!debugStep() || me.swing) break;
        }
        for (let i = 0; i < after && !game.over; i++) if (!debugStep()) break;
        hud.update(game, view);
      },
      /** Прожить кадр в заданный момент времени (мс) — как это сделал бы браузер. */
      frameAt: (now: number) => update(now),
      /**
       * Гнать кадры заданное число секунд без requestAnimationFrame (он стоит, когда
       * панель браузера скрыта). Между кадрами страница успевает принять сообщения сети.
       * После ускоренной прокрутки обычные кадры встанут, пока настоящие часы не догонят.
       */
      pump: (seconds: number, rate = 1) => {
        const from = performance.now();
        const end = from + seconds * 1000;
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          // rate > 1 — часы идут быстрее настоящих: так день по сети проматывается за секунды.
          update(from + (performance.now() - from) * rate);
          if (performance.now() < end) channel.port2.postMessage(0);
        };
        channel.port2.postMessage(0);
      },
      /** Нажать кнопку инструмента. */
      swap: () => {
        swapQueued = true;
      },
      /** Показать экран ожидания (улучшение или итоги), если он нужен. */
      showWaiting: () => (net ? netWaiting(performance.now()) : handleWaiting()),
    },
  });
}

/**
 * Подсказка на кнопке инструмента: какой сейчас пригодился бы (−1 — подсказки нет).
 * С косой рядом с сухим сеном или чужим стогом — грабли; с граблями в стоячей траве,
 * когда грести нечего, — коса.
 */
function toolHint(game: Game, p: Player): number {
  if (game.over || p.d.combo || p.crawl > 0 || p.toolCd > 0) return -1;
  const f = game.field;
  let atFoeStack = false;
  for (const q of game.players) {
    if (q === p || q.stacked < 1) continue;
    const dx = p.x - q.stackX;
    const dy = p.y - q.stackY;
    if (dx * dx + dy * dy <= game.tuning.stackReach * game.tuning.stackReach) atFoeStack = true;
  }
  const room = p.load < p.d.carryCap - 0.01;
  if (p.tool === TOOL_SCYTHE) {
    if (!room) return -1;
    if (atFoeStack) return TOOL_RAKE;
    const dry = nearestTuft(f, p.x, p.y, p.d.rakeRadius + 0.6, (i) => f.hay[i]! > 0 && isDry(game, i));
    return dry >= 0 ? TOOL_RAKE : -1;
  }
  // С граблями: тюк ещё не тяжёлый, грести рядом нечего, а трава стоит — пора косить.
  if (atFoeStack || p.load > p.d.carryCap * 0.6) return -1;
  const dry = nearestTuft(f, p.x, p.y, 3, (i) => f.hay[i]! > 0 && isDry(game, i));
  if (dry >= 0) return -1;
  return standingWithin(f, p.x, p.y, p.d.reach) ? TOOL_SCYTHE : -1;
}

/** Панель с ползунками. Числа действуют со следующего забега: страница перезагружается. */
async function openDebugPanel(current: Tuning): Promise<void> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'Баланс (со следующего забега)' });
  const draft = cloneTuning(current);
  gui.add(draft, 'reach', 1, 5, 0.1).name('радиус косы, м');
  gui.add(draft, 'arcDeg', 60, 300, 5).name('дуга, градусы');
  gui.add(draft, 'swingPeriod', 0.3, 2, 0.05).name('период взмаха, с');
  gui.add(draft, 'stepFrac', 0.2, 1, 0.05).name('шаг косаря, доля радиуса');
  gui.add(draft, 'runSpeed', 2, 9, 0.25).name('бег, м/с');
  gui.add(draft, 'wadeFactor', 0.2, 1, 0.05).name('брод, множитель');
  gui.add(draft, 'fieldSize', 16, 64, 4).name('поле, м');
  gui.add(draft, 'coverage', 0.3, 1.5, 0.05).name('доля травы');
  gui.add(draft, 'grassTypes', 1, 2, 1).name('видов травы');
  gui.add(draft, 'dayLength', 30, 300, 10).name('длина дня, с');
  gui.add(draft, 'dryTime', 4, 40, 1).name('сушка, с');
  gui.add(draft, 'carryCap', 4, 40, 1).name('тюк, кг');
  gui.add(draft, 'carrySlow', 0, 0.8, 0.05).name('груз тормозит, доля');
  gui.add(draft, 'rakeRadius', 0.5, 3, 0.1).name('ширина граблей, м');
  gui.add(draft, 'yesterdayKg', 0, 40, 1).name('вчерашнее сено, кг');
  gui.add(draft, 'swapTime', 0, 1.5, 0.05).name('смена инструмента, с');
  gui.add(draft, 'crawlTime', 1, 10, 0.5).name('ползёт, с');
  gui.add(draft, 'crawlFactor', 0.1, 1, 0.05).name('ползком, множитель');
  gui.add(draft, 'shieldTime', 0, 8, 0.5).name('неуязвим после, с');
  gui.add(draft, 'stealRate', 0, 20, 1).name('кража из стога, кг/с');
  gui.add(
    {
      restart: () => {
        sessionStorage.setItem(TUNING_KEY, JSON.stringify(draft));
        location.reload();
      },
    },
    'restart',
  ).name('▶ Заново с этими числами');
  gui.add(
    {
      reset: () => {
        sessionStorage.removeItem(TUNING_KEY);
        location.reload();
      },
    },
    'reset',
  ).name('Сбросить к стандартным');
}

interface SelftestRef {
  ticks: number;
  tuning: string;
  engine: string;
  runs: { seed: number; players?: number; hash: string }[];
}

/** Проигрывает контрольные забеги ботов и сравнивает хеши с посчитанными на Маке. */
async function runSelftest(): Promise<void> {
  for (const el of Array.from(document.body.children)) {
    if (el instanceof HTMLElement && el.tagName !== 'SCRIPT') el.style.display = 'none';
  }
  const box = document.createElement('div');
  box.id = 'selftest';
  document.body.appendChild(box);
  box.innerHTML = '<h1>Самопроверка расчётов</h1><p>Считаю…</p>';

  let ref: SelftestRef;
  try {
    ref = (await (await fetch('./selftest.json', { cache: 'no-store' })).json()) as SelftestRef;
  } catch {
    box.innerHTML =
      '<h1>Самопроверка расчётов</h1><p class="bad">Нет файла selftest.json. Он создаётся командой npm run build.</p>';
    return;
  }

  const rows: string[] = [];
  let allOk = hex8(hashTuning(DEFAULT_TUNING)) === ref.tuning;
  const started = performance.now();
  for (const run of ref.runs) {
    const players = run.players ?? 1;
    const got = hex8(hashGame(autoplay(run.seed, ref.ticks, DEFAULT_TUNING, players).game));
    const ok = got === run.hash;
    if (!ok) allOk = false;
    rows.push(
      `<li>зерно ${run.seed}, ${players === 1 ? 'один косарь' : 'двое'}: <code>${got}</code> — ${ok ? '<span class="ok">совпало</span>' : `<span class="bad">расхождение</span>, ждали <code>${run.hash}</code>`}</li>`,
    );
  }
  const ms = Math.round(performance.now() - started);

  box.innerHTML = `
    <h1>Самопроверка расчётов</h1>
    <p class="${allOk ? 'ok' : 'bad'}">${allOk ? 'Это устройство считает так же, как эталон.' : 'Расчёты расходятся с эталоном.'}</p>
    <ul>${rows.join('')}</ul>
    <p>Эталон посчитан в ${ref.engine}. Здесь: забегов — ${ref.runs.length}, по ${Math.round(ref.ticks * DT)} с каждый, за ${ms} мс.</p>
    <p><code>${navigator.userAgent}</code></p>`;
}
