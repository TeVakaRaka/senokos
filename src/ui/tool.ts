// Кнопка инструмента: в руках либо коса (косит и бьёт), либо грабли (гребут и тащат сено
// из чужого стога). Нажатие меняет одно на другое. После «синтеза» работают оба сразу.

import type { Player } from '../sim/game.ts';

export class ToolButton {
  private readonly root: HTMLElement;
  private key = '';

  /** onPress вызывается на каждое нажатие кнопки или пробела. */
  constructor(onPress: () => void) {
    const root = document.getElementById('tool');
    if (!root) throw new Error('Нет разметки для кнопки инструмента');
    this.root = root;

    // pointerdown, а не click: срабатывает сразу и не теряется, когда второй палец
    // в это время держит джойстик.
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPress();
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.code !== 'KeyE') return;
      e.preventDefault();
      if (!e.repeat && !this.root.hidden) onPress();
    });
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /**
   * Показать, что в руках. hint — какой инструмент сейчас пригодился бы (−1 — подсказки нет).
   * Дёшево: вызывать каждый кадр.
   */
  update(p: Player, hint: number): void {
    const key = `${p.tool}|${p.toolCd > 0 ? 1 : 0}|${p.d.combo ? 1 : 0}|${p.crawl > 0 ? 1 : 0}|${hint}`;
    if (key === this.key) return;
    this.key = key;
    const root = this.root;
    root.dataset.tool = String(p.tool);
    root.classList.toggle('busy', p.toolCd > 0);
    root.classList.toggle('combo', p.d.combo);
    root.classList.toggle('down', p.crawl > 0);
    root.classList.toggle('hint-0', hint === 0);
    root.classList.toggle('hint-1', hint === 1);
  }
}
