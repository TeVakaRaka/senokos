// Звук. Браузеры разрешают его только после касания, поэтому unlock() вызывается
// из нажатия на кнопку «Играть».
//
// Записи: взмах косы и грабли (подбор сена). Синтез: звон «готово», выгрузка в стог,
// новый уровень — им не нужны файлы.

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
  private lastChimeAt = 0;
  private chimeStep = 0;
  private lastRakeAt = 0;
  private lastThumpAt = 0;

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

  /** Взмах косы. strength 0…1 — сколько травы срезано. */
  swing(strength: number): void {
    const volume = 0.5 + 0.5 * Math.min(1, Math.max(0, strength));
    this.lastSwing = this.play(this.swings, this.lastSwing, volume, 0.16);
  }

  /** Сено подобрано в охапку. */
  pickup(): void {
    const now = performance.now();
    if (now - this.lastRakeAt < 180) return;
    this.lastRakeAt = now;
    this.lastRake = this.play(this.rakes, this.lastRake, 0.55, 0.2);
  }

  /** Кучка высохла: короткий звон. Несколько подряд идут ступенями вверх. */
  chime(): void {
    const ctx = this.running();
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastChimeAt < 90) return;
    this.chimeStep = now - this.lastChimeAt < 900 ? (this.chimeStep + 1) % 5 : 0;
    this.lastChimeAt = now;
    const notes = [1318.5, 1480, 1661.2, 1760, 1975.5]; // ми, фа-диез, соль-диез, ля, си
    this.tone(notes[this.chimeStep]!, 0.0, 0.32, 0.12, 'sine');
    this.tone(notes[this.chimeStep]! * 2, 0.0, 0.18, 0.04, 'sine');
  }

  /** Сено ушло в стог: мягкий глухой удар. */
  thump(): void {
    const ctx = this.running();
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastThumpAt < 160) return;
    this.lastThumpAt = now;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Новый уровень: короткое восходящее арпеджио. */
  levelUp(): void {
    if (!this.running()) return;
    const notes = [523.3, 659.3, 784, 1046.5]; // до, ми, соль, до
    notes.forEach((f, i) => this.tone(f, i * 0.07, 0.28, 0.16, 'triangle'));
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

  /** Вкладку свернули или вернули. */
  setActive(active: boolean): void {
    if (!this.ctx) return;
    if (active) void this.ctx.resume();
    else void this.ctx.suspend();
  }
}
