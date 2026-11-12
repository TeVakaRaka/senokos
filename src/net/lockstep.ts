// Игра по сети «шаг в шаг». У каждого игрока своя копия симуляции; по сети идёт только
// ввод — по байту на шаг. Шаг выполняется, когда известен ввод всех, поэтому все копии
// считают одно и то же (симуляция одинакова на любом устройстве).
//
// Свой ввод уходит остальным с запасом: нажатое сейчас сработает через delay шагов. За это
// время ввод успевает дойти, и игра не ждёт сеть на каждом шаге.
//
// Здесь нет ни сети, ни браузера — только учёт ввода; отправка передаётся снаружи.

export class Lockstep {
  /** Сколько шагов уже выполнено. */
  done = 0;
  private readonly me: number;
  private readonly players: number;
  private readonly delay: number;
  private readonly send: (step: number, input: number) => void;
  /** Ввод каждого игрока по номеру шага. */
  private readonly inputs: number[][] = [];
  /** Кто вышел из игры: дальше он просто стоит. */
  private readonly gone: boolean[] = [];

  /**
   * me — номер своего игрока; players — сколько игроков всего; delay — на сколько шагов
   * вперёд уходит ввод; send — отправить остальным свой ввод на шаг step.
   */
  constructor(me: number, players: number, delay: number, send: (step: number, input: number) => void) {
    this.me = me;
    this.players = players;
    this.delay = delay;
    this.send = send;
    for (let k = 0; k < players; k++) {
      // Первые delay шагов никто ничего не нажимал — это известно всем без пересылки.
      this.inputs.push(new Array<number>(delay).fill(0));
      this.gone.push(false);
    }
  }

  /**
   * Пришёл ввод игрока from на шаг step. Мусор (не тот игрок, шаг, не число) отбрасывается.
   * Один и тот же ввод может прийти дважды — напрямую и через сервер: считается первый.
   * Возвращает true, если ввод был новым.
   */
  receive(from: number, step: number, input: number): boolean {
    if (!Number.isInteger(from) || from < 0 || from >= this.players || from === this.me) return false;
    if (!Number.isInteger(step) || !Number.isInteger(input)) return false;
    if (step < this.delay || step > this.done + 100000) return false;
    const list = this.inputs[from]!;
    if (list[step] !== undefined) return false; // повтор: первое слово дороже второго
    list[step] = input & 255;
    return true;
  }

  /**
   * Игрок вышел. Всё, что он успел прислать, остаётся в силе (у всех оставшихся это одни
   * и те же шаги), дальше его ввод считается пустым — он стоит на месте.
   */
  drop(from: number): void {
    if (from >= 0 && from < this.players && from !== this.me) this.gone[from] = true;
  }

  /** Сколько других игроков ещё в игре. */
  get others(): number {
    let n = 0;
    for (let k = 0; k < this.players; k++) if (k !== this.me && !this.gone[k]) n++;
    return n;
  }

  /** Известен ли ввод всех на следующий шаг. Если нет — игра ждёт. */
  get ready(): boolean {
    for (let k = 0; k < this.players; k++) {
      if (k === this.me || this.gone[k]) continue;
      if (this.inputs[k]![this.done] === undefined) return false;
    }
    return true;
  }

  /**
   * Выполнить шаг. sample — что свой игрок нажимает сейчас: это уйдёт остальным и сработает
   * через delay шагов. В frame кладётся ввод всех игроков на текущий шаг.
   */
  advance(sample: number, frame: number[]): void {
    if (!this.ready) throw new Error('Нет ввода других игроков на этот шаг');
    const target = this.done + this.delay;
    const input = sample & 255;
    this.inputs[this.me]![target] = input;
    this.send(target, input);
    for (let k = 0; k < this.players; k++) {
      const known = this.inputs[k]![this.done];
      frame[k] = known === undefined ? 0 : known; // пусто бывает только у вышедшего
    }
    this.done++;
  }
}
