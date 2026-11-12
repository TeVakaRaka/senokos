// Управление одним пальцем: коснулся в любом месте — там появился джойстик, повёл — герой идёт.
// На компьютере работают мышь и клавиши WASD / стрелки.

const DEAD_ZONE = 8; // пикселей: меньше — считаем, что палец просто лежит
const MAX_RADIUS = 56; // дальше палец «тащит» джойстик за собой

export class Joystick {
  /** Направление в экранных осях: x вправо, y вверх. Длина 0 (нет ввода) или 1. */
  x = 0;
  y = 0;

  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly keys = new Set<string>();
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(surface: HTMLElement, base: HTMLElement, knob: HTMLElement) {
    this.base = base;
    this.knob = knob;

    surface.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return; // второй палец не мешает первому
      this.pointerId = e.pointerId;
      try {
        // Захват: палец может уехать за край экрана, а джойстик продолжит работать.
        surface.setPointerCapture(e.pointerId);
      } catch {
        // Некоторые браузеры не дают захват — управление работает и без него.
      }
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.move(e.clientX, e.clientY);
      this.base.style.opacity = '1';
      this.knob.style.opacity = '1';
      e.preventDefault();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.move(e.clientX, e.clientY);
      e.preventDefault();
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.release();
    };
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('lostpointercapture', release);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (isMoveKey(e.code)) {
        this.keys.add(e.code);
        this.fromKeys();
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (this.keys.delete(e.code)) this.fromKeys();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });
  }

  private move(px: number, py: number): void {
    let dx = px - this.originX;
    let dy = py - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > MAX_RADIUS) {
      // Джойстик едет за пальцем: менять направление можно не возвращаясь к центру.
      const pull = (len - MAX_RADIUS) / len;
      this.originX += dx * pull;
      this.originY += dy * pull;
      dx = px - this.originX;
      dy = py - this.originY;
    }
    if (len > DEAD_ZONE) {
      this.x = dx / len;
      this.y = -dy / len;
    } else {
      this.x = 0;
      this.y = 0;
    }
    this.base.style.transform = `translate(${this.originX}px, ${this.originY}px)`;
    this.knob.style.transform = `translate(${this.originX + dx}px, ${this.originY + dy}px)`;
  }

  private release(): void {
    this.pointerId = null;
    this.base.style.opacity = '0';
    this.knob.style.opacity = '0';
    this.fromKeys();
  }

  private fromKeys(): void {
    if (this.pointerId !== null) return;
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky -= 1;
    const len = Math.hypot(kx, ky);
    this.x = len > 0 ? kx / len : 0;
    this.y = len > 0 ? ky / len : 0;
  }
}

function isMoveKey(code: string): boolean {
  return (
    code === 'KeyW' ||
    code === 'KeyA' ||
    code === 'KeyS' ||
    code === 'KeyD' ||
    code === 'ArrowUp' ||
    code === 'ArrowDown' ||
    code === 'ArrowLeft' ||
    code === 'ArrowRight'
  );
}
