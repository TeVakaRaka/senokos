// Экран поверх игры: сено в стогу и полоска до следующего перка, время до конца дня,
// полоска охапки над героем и стрелка к стогу, когда он за краем экрана.

import type { Game } from '../sim/game.ts';
import { levelThreshold } from '../sim/perks.ts';
import { DT } from '../sim/tuning.ts';
import type { View } from '../render/view.ts';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el;
}

const ARROW_MARGIN = 34; // пикселей от края экрана

export class Hud {
  private readonly stackKg = $('hud-stack-kg');
  private readonly xpFill = $('hud-xp-fill');
  private readonly time = $('hud-time');
  private readonly carry = $('carry');
  private readonly carryFill = $('carry-fill');
  private readonly arrow = $('stack-arrow');
  private lastKg = -1;
  private lastSeconds = -1;

  /** Дёшево: вызывать каждый кадр. Текст меняется только когда число изменилось. */
  update(game: Game, view: View): void {
    const kg = Math.floor(game.stacked);
    if (kg !== this.lastKg) {
      this.lastKg = kg;
      this.stackKg.textContent = String(kg);
    }
    const from = game.level === 0 ? 0 : levelThreshold(game.tuning, game.level - 1);
    const to = levelThreshold(game.tuning, game.level);
    const progress = Math.max(0, Math.min(1, (game.stacked - from) / (to - from)));
    this.xpFill.style.transform = `scaleX(${progress})`;

    const seconds = Math.max(0, Math.ceil((game.dayTicks - game.tick) * DT));
    if (seconds !== this.lastSeconds) {
      this.lastSeconds = seconds;
      this.time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      this.time.classList.toggle('hurry', seconds <= 20);
    }

    this.updateCarry(game, view);
    this.updateArrow(game, view);
  }

  private updateCarry(game: Game, view: View): void {
    const h = game.hero;
    const cap = game.d.carryCap;
    if (h.load <= 0.001) {
      this.carry.style.opacity = '0';
      return;
    }
    const p = view.worldToScreen(h.x, 2.05, h.y);
    this.carry.style.opacity = '1';
    this.carry.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.carryFill.style.transform = `scaleX(${Math.min(1, h.load / cap)})`;
    this.carry.classList.toggle('full', h.load >= cap);
  }

  private updateArrow(game: Game, view: View): void {
    const canvas = view.renderer.domElement;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    const s = view.worldToScreen(game.stackX, 1, game.stackY);
    const inside = s.x > 0 && s.x < w && s.y > 60 && s.y < hgt;
    // Стрелка нужна, только когда есть что нести и стога не видно.
    if (inside || game.hero.load <= 0.001) {
      this.arrow.style.opacity = '0';
      return;
    }
    const cx = w / 2;
    const cy = hgt / 2;
    const dx = s.x - cx;
    const dy = s.y - cy;
    // Точка на краю экрана в сторону стога.
    const kx = (w / 2 - ARROW_MARGIN) / Math.max(1e-6, Math.abs(dx));
    const ky = (hgt / 2 - ARROW_MARGIN - 40) / Math.max(1e-6, Math.abs(dy));
    const k = Math.min(kx, ky);
    const ax = cx + dx * k;
    const ay = cy + dy * k;
    const angle = Math.atan2(dy, dx);
    this.arrow.style.opacity = '1';
    this.arrow.style.transform = `translate(${ax}px, ${ay}px) rotate(${angle}rad)`;
  }
}
