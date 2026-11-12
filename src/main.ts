// Точка входа: собирает симуляцию, картинку и управление, крутит игровой цикл.
//
// Параметры адреса:
//   ?seed=123     — зерно поля (по умолчанию — номер сегодняшнего дня)
//   ?auto=1       — играет бот
//   ?debug=1      — панель с ползунками баланса
//   ?q=low        — простое качество картинки
//   ?look=a|b|c   — вариант внешнего вида (июль, август, игрушка)
//   ?selftest=1   — проверка одинаковости расчётов на этом устройстве

import './ui/ui.css';
import { botInput, createBot } from './sim/bot.ts';
import { createGame, step, type Game } from './sim/game.ts';
import { hashGame, hashTuning, hex8 } from './sim/hash.ts';
import { Recorder } from './sim/replay.ts';
import { cloneTuning, DEFAULT_TUNING, DT, type Tuning } from './sim/tuning.ts';
import { Sound } from './audio/audio.ts';
import { lookById, LOOKS } from './render/look.ts';
import { QUALITY_HIGH, QUALITY_LOW, View } from './render/view.ts';
import { Joystick } from './ui/joystick.ts';
import { Platform } from './platform/platform.ts';

const params = new URLSearchParams(location.search);
const TUNING_KEY = 'senokos.tuning';

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

if (params.has('selftest')) {
  void runSelftest();
} else {
  // Оболочку готовим заранее, но игру не ждём: если Telegram тормозит, сайт всё равно стартует.
  void platform.init();
  startGame();
}

function startGame(): void {
  const seed = Number(params.get('seed')) || todaySeed();
  const tuning = loadTuning();
  const game = createGame(seed, tuning);
  const autopilot = params.has('auto');
  const bot = createBot(seed);
  const recorder = new Recorder();

  const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
  const quality = params.get('q') === 'low' || (params.get('q') !== 'high' && lowEnd) ? QUALITY_LOW : QUALITY_HIGH;

  const canvas = $('game') as HTMLCanvasElement;
  const look = lookById(params.get('look'));
  const view = new View(canvas, game, quality, look);
  const sound = new Sound();
  const joystick = new Joystick($('touch'), $('stick-base'), $('stick-knob'));

  const overlay = $('overlay');
  const overlayText = $('overlay-text');
  const overlayButton = $('overlay-button');
  const hudMown = $('hud-mown');
  const hudTime = $('hud-time');
  const debugLine = $('debug-line');

  let started = autopilot;
  let lostContext = false;
  overlay.hidden = started;
  overlayButton.addEventListener('click', () => {
    started = true;
    overlay.hidden = true;
    sound.unlock();
    platform.setPlaying(true);
  });
  document.addEventListener('visibilitychange', () => sound.setActive(!document.hidden));
  // В Telegram игру можно свернуть, не закрывая: тогда пауза и тишина.
  platform.onActiveChange((active) => sound.setActive(active && !document.hidden));

  // Переключатель вида травы: перезагружает страницу с другим ?look=.
  const lookRow = $('look-row');
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
    overlayText.textContent = 'Картинка сбросилась. Обновите страницу, чтобы продолжить.';
    overlayButton.textContent = 'Обновить';
    overlayButton.onclick = () => location.reload();
    overlay.hidden = false;
  });

  window.addEventListener('resize', () => view.resize());
  window.visualViewport?.addEventListener('resize', () => view.resize());

  function playerInput(): number {
    if (joystick.x === 0 && joystick.y === 0) return 0;
    const [wx, wy] = view.iso.screenToSim(joystick.x, joystick.y);
    const turn = Math.atan2(wy, wx) / (Math.PI * 2);
    return ((Math.round(turn * 64) % 64) + 64) % 64 + 1;
  }

  let last = performance.now();
  let acc = 0;
  let fps = 60;
  let hudTimer = 0;
  let frozen = false; // отладочная пауза: кадры идут только по команде advance()

  /** Один шаг симуляции вместе с событиями для картинки и вибрацией. */
  function tick(): void {
    const input = autopilot ? botInput(game, bot) : playerInput();
    recorder.push(input);
    step(game, input);
    const swing = view.onStep(game);
    if (swing && swing.cut > 0) {
      sound.swing(swing.cut / 25);
      platform.haptic();
    }
  }

  function updateHud(): void {
    const share = Math.round((game.cutTufts / Math.max(1, game.field.count)) * 100);
    hudMown.innerHTML = `Скошено ${share} % <small>· ${Math.round(game.cutKg)} кг</small>`;
    const seconds = Math.floor(game.tick * DT);
    hudTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    debugLine.textContent = `${Math.round(fps)} к/с · ${Math.round(view.triangles / 1000)} тыс. треуг. · ${view.qualityName} · ${look.title}`;
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // вкладка была свёрнута или кадр завис — не догоняем рывком
    if (dt <= 0 || frozen) return;
    fps += (1 / dt - fps) * 0.05;

    const running = started && !document.hidden && !lostContext && platform.active;
    if (running) {
      acc += dt;
      while (acc >= DT) {
        tick();
        acc -= DT;
      }
    }

    if (!lostContext) view.render(game, running ? acc / DT : 1, dt);

    hudTimer += dt;
    if (hudTimer > 0.2) {
      hudTimer = 0;
      updateHud();
    }
  }
  requestAnimationFrame(frame);

  if (params.has('debug')) void openDebugPanel(tuning);

  // Для отладки из консоли браузера и для покадровых снимков.
  Object.assign(window, {
    senokos: {
      game,
      view,
      recorder,
      hash: () => hex8(hashGame(game)),
      freeze: (on: boolean) => {
        frozen = on;
        last = performance.now();
      },
      /** Прокрутить игру на заданное число шагов, рисуя каждый. Работает на паузе. */
      advance: (ticks: number) => {
        for (let i = 0; i < ticks; i++) {
          tick();
          view.render(game, 1, DT);
        }
        updateHud();
      },
      /** Прокрутить до ближайшего взмаха и ещё на несколько шагов после него. */
      advanceToSwing: (after: number) => {
        for (let i = 0; i < 600; i++) {
          tick();
          view.render(game, 1, DT);
          if (game.swing) break;
        }
        for (let i = 0; i < after; i++) {
          tick();
          view.render(game, 1, DT);
        }
        updateHud();
      },
    },
  });
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
  runs: { seed: number; hash: string }[];
}

/** Проигрывает контрольные забеги бота и сравнивает хеши с посчитанными на Маке. */
async function runSelftest(): Promise<void> {
  for (const id of ['game', 'touch', 'stick-base', 'stick-knob', 'hud', 'debug-line', 'overlay']) {
    $(id).style.display = 'none';
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
    const g: Game = createGame(run.seed);
    const bot = createBot(run.seed);
    for (let i = 0; i < ref.ticks; i++) step(g, botInput(g, bot));
    const got = hex8(hashGame(g));
    const ok = got === run.hash;
    if (!ok) allOk = false;
    rows.push(
      `<li>зерно ${run.seed}: <code>${got}</code> — ${ok ? '<span class="ok">совпало</span>' : `<span class="bad">расхождение</span>, ждали <code>${run.hash}</code>`}</li>`,
    );
  }
  const ms = Math.round(performance.now() - started);

  box.innerHTML = `
    <h1>Самопроверка расчётов</h1>
    <p class="${allOk ? 'ok' : 'bad'}">${allOk ? 'Это устройство считает так же, как эталон.' : 'Расчёты расходятся с эталоном.'}</p>
    <ul>${rows.join('')}</ul>
    <p>Эталон посчитан в ${ref.engine}. Здесь: ${ref.runs.length} забега по ${Math.round(ref.ticks * DT)} с за ${ms} мс.</p>
    <p><code>${navigator.userAgent}</code></p>`;
}
