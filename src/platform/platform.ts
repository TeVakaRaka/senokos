// Где запущена игра: обычный сайт или Mini App внутри Telegram.
//
// Внутри Telegram скрипт telegram-web-app.js подгружается только тогда, когда страницу
// открыл сам Telegram (он кладёт параметры запуска в адрес после #). На обычном сайте
// ничего лишнего не грузится.

interface TelegramWebApp {
  version: string;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  lockOrientation?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  isActive?: boolean;
  onEvent(event: string, handler: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SCRIPT_URL = 'https://telegram.org/js/telegram-web-app.js';
const BACKGROUND = '#3d632c';

export class Platform {
  /** Игра открыта как Mini App в Telegram. */
  readonly telegram: boolean;
  /** Mini App не свёрнут (в Telegram его можно свернуть, не закрывая). */
  active = true;
  private app: TelegramWebApp | null = null;
  private lastHaptic = 0;
  private readonly listeners: ((active: boolean) => void)[] = [];

  constructor() {
    const hash = location.hash;
    this.telegram = hash.includes('tgWebAppData') || hash.includes('tgWebAppPlatform');
  }

  /** Подготовить оболочку. На обычном сайте сразу готово. */
  async init(): Promise<void> {
    if (!this.telegram) return;
    try {
      await loadScript(SCRIPT_URL);
    } catch {
      return; // скрипт не загрузился — играем как на обычном сайте
    }
    const app = window.Telegram?.WebApp;
    if (!app) return;
    this.app = app;

    app.ready();
    app.expand();
    const at = (v: string) => app.isVersionAtLeast(v);
    // Главное: свайп вниз больше не сворачивает игру, палец свободно водит косаря.
    if (at('7.7')) app.disableVerticalSwipes?.();
    if (at('6.1')) {
      app.setHeaderColor?.(BACKGROUND);
      app.setBackgroundColor?.(BACKGROUND);
    }
    if (at('7.10')) app.setBottomBarColor?.(BACKGROUND);
    if (at('8.0')) {
      app.requestFullscreen?.();
      app.lockOrientation?.();
      app.onEvent('activated', () => this.setActive(true));
      app.onEvent('deactivated', () => this.setActive(false));
    }
  }

  /** Короткая отдача в руку на взмахе. В Telegram работает и на iPhone. */
  haptic(): void {
    const now = performance.now();
    if (now - this.lastHaptic < 120) return;
    this.lastHaptic = now;
    const tg = this.app?.HapticFeedback;
    if (tg && this.app!.isVersionAtLeast('6.1')) {
      tg.impactOccurred('light');
      return;
    }
    // Обычный сайт: вибрация есть только на Android и только после первого касания.
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
  }

  /** Спрашивать ли подтверждение при закрытии (во время забега — да). */
  setPlaying(playing: boolean): void {
    if (!this.app || !this.app.isVersionAtLeast('6.2')) return;
    if (playing) this.app.enableClosingConfirmation?.();
    else this.app.disableClosingConfirmation?.();
  }

  onActiveChange(listener: (active: boolean) => void): void {
    this.listeners.push(listener);
  }

  private setActive(active: boolean): void {
    this.active = active;
    for (const listener of this.listeners) listener(active);
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Не загрузился ${src}`));
    document.head.appendChild(script);
  });
}
