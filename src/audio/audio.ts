// Звук. Браузеры разрешают его только после касания, поэтому unlock() вызывается
// из нажатия на кнопку «Играть».
//
// Записи: взмах косы и грабли. Синтез: выгрузка в стог, новое улучшение, смена инструмента
// и звуки PvP (подрезал, подрезали, стог грабят) — им не нужны файлы.

type AudioContextCtor = typeof AudioContext;

const SWING_FILES = 8;
const RAKE_FILES = 8;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private swings: AudioBuffer[] = [];
  private rakes: AudioBuffer[] = [];
  private lastSwing = -1;
  private lastRake = -1;
  private lastRakeAt = 0;
  private lastThumpAt = 0;
  private lastAlarmAt = 0;
  private noiseBuffer: AudioBuffer | null = null;

  /** Включить звук и подгрузить записи. Вызывать из обработчика нажатия. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    void ctx.resume();

    for (let i = 1; i <= SWING_FILES; i++) {
      void this.load(`./audio/scythe${i}.mp3`).then((b) => b && this.swings.push(b));
    }
    for (let i = 1; i <= RAKE_FILES; i++) {
      void this.load(`./audio/rake${i}.mp3`).then((b) => b && this.rakes.push(b));
    }
  }

  private async load(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const data = await (await fetch(url)).arrayBuffer();
      return await this.ctx.decodeAudioData(data);
    } catch {
      return null; // без звука играть можно
    }
  }

  /** Звук уже разрешён браузером и играет. */
  isRunning(): boolean {
    return this.running() !== null;
  }

  private running(): AudioContext | null {
    const ctx = this.ctx;
    return ctx && this.master && ctx.state === 'running' ? ctx : null;
  }

  private play(buffers: AudioBuffer[], last: number, volume: number, rateSpread: number): number {
    const ctx = this.running();
    if (!ctx || buffers.length === 0) return last;
    let index = Math.floor(Math.random() * buffers.length);
    if (index === last) index = (index + 1) % buffers.length; // не повторять запись подряд
    const source = ctx.createBufferSource();
    source.buffer = buffers[index]!;
    source.playbackRate.value = 1 - rateSpread / 2 + Math.random() * rateSpread;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master!);
    source.start();
    return index;
  }

  /** Взмах косы. strength 0…1 — сколько травы срезано; volume — тише для дальнего соперника. */
  swing(strength: number, volume = 1): void {
    const level = (0.5 + 0.5 * Math.min(1, Math.max(0, strength))) * volume;
    this.lastSwing = this.play(this.swings, this.lastSwing, level, 0.16);
  }

  /** Грабли сгребают сено. */
  rake(): void {
    const now = performance.now();
    if (now - this.lastRakeAt < 330) return;
    this.lastRakeAt = now;
    this.lastRake = this.play(this.rakes, this.lastRake, 0.45, 0.2);
  }

  /** Сено ушло в стог: мягкий глухой удар. */
  thump(): void {
    const ctx = this.running();
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastThumpAt < 320) return;
    this.lastThumpAt = now;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Сменил инструмент: короткий сухой щелчок. */
  swap(): void {
    this.noise(0.05, 0.16, 2200, 'bandpass');
    this.tone(330, 0.02, 0.07, 0.05, 'triangle');
  }

  /** Подрезал соперника: свист лезвия и глухой удар. */
  slash(): void {
    this.noise(0.16, 0.32, 3200, 'highpass');
    this.sweep(1100, 320, 0.14, 0.12, 'triangle');
    this.sweep(140, 50, 0.22, 0.3, 'sine', 0.05);
  }

  /** Косой по тюку: глухой хлопок, сено разлетается. */
  whack(): void {
    this.noise(0.14, 0.3, 700, 'lowpass');
    this.sweep(180, 70, 0.16, 0.22, 'sine');
  }

  /** Подрезали самого: низкий «ой» и удар. */
  ouch(): void {
    this.sweep(300, 85, 0.42, 0.2, 'sawtooth');
    this.noise(0.22, 0.34, 520, 'lowpass');
    this.sweep(120, 45, 0.3, 0.32, 'sine', 0.04);
  }

  /** Свой стог грабят: два коротких тревожных гудка, не чаще раза в три секунды. */
  alarm(): void {
    const now = performance.now();
    if (now - this.lastAlarmAt < 3000) return;
    this.lastAlarmAt = now;
    this.tone(740, 0, 0.11, 0.07, 'square');
    this.tone(587, 0.13, 0.16, 0.07, 'square');
  }

  /** Новое улучшение: два мягких тона вверх (один раз, когда появляются карточки). */
  levelUp(): void {
    if (!this.running()) return;
    this.tone(523.3, 0, 0.3, 0.1, 'triangle'); // до
    this.tone(784, 0.11, 0.42, 0.1, 'triangle'); // соль
  }

  private tone(freq: number, delay: number, length: number, volume: number, type: OscillatorType): void {
    const ctx = this.running();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /** Тон, который съезжает с одной частоты на другую. */
  private sweep(from: number, to: number, length: number, volume: number, type: OscillatorType, delay = 0): void {
    const ctx = this.running();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /** Короткий шум через фильтр: свист, шорох, удар. */
  private noise(length: number, volume: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.running();
    if (!ctx) return;
    if (!this.noiseBuffer) {
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    source.start(t);
    source.stop(t + length + 0.02);
  }

  /** Вкладку свернули или вернули. */
  setActive(active: boolean): void {
    if (!this.ctx) return;
    if (active) void this.ctx.resume();
    else void this.ctx.suspend();
  }
}
