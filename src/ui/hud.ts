// Экран поверх игры: сено в стогах (своём и чужих) и полоска до следующего улучшения,
// время до конца дня, полоска тюка над героем и стрелки у края экрана — к своему стогу
// и к соперникам.

import type { Game } from '../sim/game.ts';
import { levelThreshold } from '../sim/perks.ts';
import { DT } from '../sim/tuning.ts';
import type { View } from '../render/view.ts';
import { playerCss } from './players.ts';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el;
}

const ARROW_MARGIN = 34; // пикселей от края экрана
const ALARM_MS = 2500; // сколько стрелка к стогу остаётся красной после кражи

/** Соперник на экране: его счёт в плашке и стрелка к нему. */
interface Foe {
  index: number;
  kg: HTMLElement;
  lastKg: number;
  arrow: HTMLElement;
}

export class Hud {
  private readonly root = $('hud');
  private readonly stackKg = $('hud-stack-kg');
  private readonly xpFill = $('hud-xp-fill');
  private readonly time = $('hud-time');
  private readonly carry = $('carry');
  private readonly carryFill = $('carry-fill');
  private readonly arrow = $('stack-arrow');
  private readonly flashEl = $('flash');
  private readonly me: number;
  private readonly foes: Foe[] = [];
  private lastKg = -1;
  private lastSeconds = -1;
  private alarmUntil = 0;

  /**
   * me — номер своего игрока; players — сколько игроков на поле; foeLabel — подпись
   * счёта соперника, когда он один («кг у бота»).
   */
  constructor(me: number, players: number, foeLabel: string) {
    this.me = me;
    const duel = players > 1;
    this.root.classList.toggle('duel', duel);
    const foeBox = $('hud-foe');
    foeBox.hidden = !duel;
    if (!duel) return;

    $('hud-stack-label').textContent = 'кг у тебя';
    $('hud-me-dot').style.background = playerCss(me);
    foeBox.textContent = '';
    foeBox.classList.toggle('many', players > 2);
    for (let k = 0; k < players; k++) {
      if (k === me) continue;
      const item = document.createElement('span');
      item.className = 'foe-item';
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = playerCss(k);
      const kg = document.createElement('b');
      kg.textContent = '0';
      item.append(dot, ' ', kg);
      foeBox.append(item);

      // Стрелка к сопернику — его цвета. Кладём под плашками, чтобы не лезла поверх окон.
      const arrow = document.createElement('div');
      arrow.className = 'edge-arrow foe';
      arrow.textContent = '➜';
      arrow.style.background = playerCss(k);
      arrow.setAttribute('aria-hidden', 'true');
      this.root.before(arrow);

      this.foes.push({ index: k, kg, lastKg: -1, arrow });
    }
    if (this.foes.length === 1) {
      const label = document.createElement('small');
      label.textContent = ` ${foeLabel}`;
      foeBox.append(label);
    }
  }

  /** Дёшево: вызывать каждый кадр. Текст меняется только когда число изменилось. */
  update(game: Game, view: View): void {
    const p = game.players[this.me]!;
    const kg = Math.floor(p.stacked);
    if (kg !== this.lastKg) {
      this.lastKg = kg;
      this.stackKg.textContent = String(kg);
    }
    // Полоска — путь до следующего улучшения. Опыт — всё привезённое за день:
    // украденное из стога его не уменьшает.
    const from = p.level === 0 ? 0 : levelThreshold(game.tuning, p.level - 1);
    const to = levelThreshold(game.tuning, p.level);
    const progress = Math.max(0, Math.min(1, (p.delivered - from) / (to - from)));
    this.xpFill.style.transform = `scaleX(${progress})`;

    const seconds = Math.max(0, Math.ceil((game.dayTicks - game.tick) * DT));
    if (seconds !== this.lastSeconds) {
      this.lastSeconds = seconds;
      this.time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      this.time.classList.toggle('hurry', seconds <= 20);
    }

    const canvas = view.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    this.updateCarry(game, view);

    // Стрелка к своему стогу: когда есть что везти или когда стог грабят.
    const alarm = performance.now() < this.alarmUntil;
    this.arrow.classList.toggle('alarm', alarm);
    const stack = view.worldToScreen(p.stackX, 1, p.stackY);
    this.pointTo(this.arrow, stack.x, stack.y, w, h, (p.load > 0.001 || alarm) && !game.over);

    for (const foe of this.foes) {
      const q = game.players[foe.index]!;
      const foeKg = Math.floor(q.stacked);
      if (foeKg !== foe.lastKg) {
        foe.lastKg = foeKg;
        foe.kg.textContent = String(foeKg);
      }
      const s = view.worldToScreen(q.x, 1, q.y);
      this.pointTo(foe.arrow, s.x, s.y, w, h, !game.over);
    }
  }

  /** Красная вспышка по краям: подрезали ноги. */
  flash(): void {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth; // перезапустить анимацию
    this.flashEl.classList.add('go');
  }

  /** Свой стог грабят: стрелка к нему краснеет и показывается, даже если тюк пуст. */
  alarm(): void {
    this.alarmUntil = performance.now() + ALARM_MS;
  }

  /** Полоска над героем: сколько сена в тюке, а ползком — сколько ещё ползти. */
  private updateCarry(game: Game, view: View): void {
    const p = game.players[this.me]!;
    const crawling = p.crawl > 0;
    if (!crawling && p.load <= 0.001) {
      this.carry.style.opacity = '0';
      return;
    }
    const cap = p.d.carryCap;
    const s = view.worldToScreen(p.x, crawling ? 1.1 : 2.05, p.y);
    this.carry.style.opacity = '1';
    this.carry.style.transform = `translate(${s.x}px, ${s.y}px)`;
    this.carry.classList.toggle('crawl', crawling);
    this.carry.classList.toggle('full', !crawling && p.load >= cap);
    const share = crawling ? p.crawl / game.crawlTicks : p.load / cap;
    this.carryFill.style.transform = `scaleX(${Math.min(1, share)})`;
  }

  /** Поставить стрелку на край экрана в сторону точки (sx, sy); если точка видна — спрятать. */
  private pointTo(el: HTMLElement, sx: number, sy: number, w: number, h: number, wanted: boolean): void {
    const inside = sx > 0 && sx < w && sy > 60 && sy < h;
    if (!wanted || inside) {
      el.style.opacity = '0';
      return;
    }
    const cx = w / 2;
    const cy = h / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const kx = (w / 2 - ARROW_MARGIN) / Math.max(1e-6, Math.abs(dx));
    const ky = (h / 2 - ARROW_MARGIN - 40) / Math.max(1e-6, Math.abs(dy));
    const k = Math.min(kx, ky);
    el.style.opacity = '1';
    el.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px) rotate(${Math.atan2(dy, dx)}rad)`;
  }
}
