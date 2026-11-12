// Карточки перков: игра на паузе, игрок нажимает одну из трёх.

import { PERK_ARC, PERK_CARRY, PERK_RAKE, PERK_RATE, PERK_REACH } from '../sim/perks.ts';
import type { Tuning } from '../sim/tuning.ts';

interface PerkText {
  icon: string;
  title: string;
  describe: (t: Tuning) => string;
}

const TEXTS: Record<number, PerkText> = {
  [PERK_ARC]: {
    icon: '🌀',
    title: 'Шире взмах',
    describe: (t) => `Дуга косы на ${t.arcPerLevel}° шире`,
  },
  [PERK_REACH]: {
    icon: '📏',
    title: 'Длиннее коса',
    describe: (t) => `Достаёт на ${fmt(t.reachPerLevel * 100)} см дальше и косит быстрее`,
  },
  [PERK_RATE]: {
    icon: '⚡',
    title: 'Чаще взмах',
    describe: (t) => `Взмах на ${fmt(t.ratePerLevel * 100)}% быстрее`,
  },
  [PERK_CARRY]: {
    icon: '🌾',
    title: 'Больше тюк',
    describe: (t) => `В тюк влезает на ${fmt(t.carryPerLevel)} кг больше`,
  },
  [PERK_RAKE]: {
    icon: '🧹',
    title: 'Шире грабли',
    describe: (t) => `Гребут на ${fmt(t.rakePerLevel * 200)} см шире`,
  },
};

function fmt(v: number): string {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

const INPUT_LOCK_MS = 400; // первые мгновения карточки не нажимаются — чтобы не выбрать случайно

export class PerkCards {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private shownAt = 0;
  visible = false;

  constructor() {
    const root = document.getElementById('perks');
    const list = document.getElementById('perk-list');
    if (!root || !list) throw new Error('Нет разметки для карточек перков');
    this.root = root;
    this.list = list;
  }

  show(offer: readonly number[], levels: readonly number[], maxLevel: number, t: Tuning, onPick: (index: number) => void): void {
    this.list.textContent = '';
    this.shownAt = performance.now();
    offer.forEach((perk, index) => {
      const text = TEXTS[perk]!;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'perk';
      const level = levels[perk]! + 1;
      const pips = Array.from({ length: maxLevel }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      card.innerHTML = `
        <span class="perk-icon" aria-hidden="true">${text.icon}</span>
        <span class="perk-body">
          <b>${text.title}</b>
          <small>${text.describe(t)}</small>
          <span class="pips" aria-label="уровень ${level} из ${maxLevel}">${pips}</span>
        </span>`;
      card.addEventListener('click', () => {
        if (performance.now() - this.shownAt < INPUT_LOCK_MS) return;
        this.hide();
        onPick(index);
      });
      this.list.appendChild(card);
    });
    this.root.hidden = false;
    this.visible = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.visible = false;
  }
}
