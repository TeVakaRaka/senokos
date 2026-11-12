// Короткое сообщение под верхней плашкой: что только что случилось.

const SHOW_MS = 1900;

export type ToastKind = 'plain' | 'good' | 'bad';

export class Toast {
  private readonly root: HTMLElement;
  private timer = 0;
  private readonly lastAt = new Map<string, number>();

  constructor() {
    const root = document.getElementById('toast');
    if (!root) throw new Error('Нет разметки для сообщений');
    this.root = root;
  }

  /**
   * Показать сообщение. Если задан gapMs, то же самое сообщение не повторяется
   * чаще этого промежутка — чтобы не мелькало.
   */
  show(text: string, kind: ToastKind = 'plain', gapMs = 0): void {
    const now = performance.now();
    if (gapMs > 0) {
      const last = this.lastAt.get(text);
      if (last !== undefined && now - last < gapMs) return;
      this.lastAt.set(text, now);
    }
    this.root.textContent = text;
    this.root.className = kind === 'plain' ? 'show' : `show ${kind}`;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.remove('show'), SHOW_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.remove('show');
  }
}
