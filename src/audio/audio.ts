// Звук. Браузеры разрешают его только после касания, поэтому unlock() вызывается
// из нажатия на кнопку «Играть».

const SWING_FILES = 8;

type AudioContextCtor = typeof AudioContext;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private swings: AudioBuffer[] = [];
  private lastSwing = -1;

  /** Включить звук и подгрузить записи взмахов. Вызывать из обработчика нажатия. */
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
      void this.load(`./audio/scythe${i}.mp3`).then((buffer) => {
        if (buffer) this.swings.push(buffer);
      });
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

  /** Взмах косы. strength 0…1 — сколько травы срезано. */
  swing(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.swings.length === 0 || ctx.state !== 'running') return;
    // Не повторяем одну и ту же запись дважды подряд.
    let index = Math.floor(Math.random() * this.swings.length);
    if (index === this.lastSwing) index = (index + 1) % this.swings.length;
    this.lastSwing = index;

    const source = ctx.createBufferSource();
    source.buffer = this.swings[index]!;
    source.playbackRate.value = 0.93 + Math.random() * 0.16;
    const gain = ctx.createGain();
    gain.gain.value = 0.5 + 0.5 * Math.min(1, Math.max(0, strength));
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  /** Вкладку свернули или вернули. */
  setActive(active: boolean): void {
    if (!this.ctx) return;
    if (active) void this.ctx.resume();
    else void this.ctx.suspend();
  }
}
