// Итоги дня. В одиночку: сколько сена в стогу и лучший результат. С соперниками:
// какое место, счёт каждого и чем запомнился день.

export interface DayResult {
  stacked: number; // кг в стогу
  mownShare: number; // доля скошенного поля 0…1
  groundKg: number; // сено, оставшееся на земле и в тюке
  perks: number;
  best: number; // лучший результат до этого дня (0 — не было)
}

/** Счёт одного игрока в итогах. */
export interface Score {
  kg: number; // кг в стогу
  label: string; // «у тебя», «у бота», «у синего»
  ink: string; // цвет цифры
  me: boolean;
}

export interface MatchResult {
  scores: Score[]; // по одному на игрока
  hits: number; // сколько раз подрезал ноги
  hurt: number; // сколько раз подрезали самого
  knocked: number; // кг, выбитых из чужих тюков
  stolen: number; // кг, утащенных из чужих стогов
  lost: number; // кг, утащенных из своего
  shot: number; // скольких подстрелил из ружья
  shotDown: number; // сколько раз подстрелили самого
  perks: number;
  wins: number; // побед всего, считая этот день (0 игр — строка не показывается)
  games: number;
}

export class Results {
  private readonly root: HTMLElement;
  visible = false;

  constructor() {
    const root = document.getElementById('results');
    if (!root) throw new Error('Нет разметки для итогов');
    this.root = root;
  }

  show(r: DayResult, onAgain: () => void, onMenu: () => void): void {
    const kg = Math.floor(r.stacked);
    const record = kg > r.best;
    this.open(
      `
      <div class="results-card">
        <p class="results-kicker">День окончен</p>
        <p class="results-kg"><b>${kg}</b> кг</p>
        <p class="results-sub">в стогу${record && r.best > 0 ? ' · новый рекорд!' : ''}</p>
        <dl>
          <div><dt>Скошено поля</dt><dd>${Math.round(r.mownShare * 100)} %</dd></div>
          <div><dt>Осталось на земле</dt><dd>${Math.round(r.groundKg)} кг</dd></div>
          <div><dt>Улучшений</dt><dd>${r.perks}</dd></div>
          <div><dt>Лучший результат</dt><dd>${Math.max(kg, r.best)} кг</dd></div>
        </dl>
        <button type="button" id="results-again">Ещё раз</button>
        <button type="button" id="results-menu">Сменить режим</button>
      </div>`,
      onAgain,
      onMenu,
    );
  }

  showMatch(r: MatchResult, onAgain: () => void, onMenu: () => void): void {
    const mine = Math.floor(r.scores.find((s) => s.me)?.kg ?? 0);
    const others = r.scores.filter((s) => !s.me).map((s) => Math.floor(s.kg));
    const place = 1 + others.filter((kg) => kg > mine).length;
    const tied = place === 1 && others.some((kg) => kg === mine);
    const outcome = place > 1 ? 'lose' : tied ? 'draw' : 'win';
    const title =
      outcome === 'win' ? 'Победа!' : outcome === 'draw' ? 'Ничья' : others.length === 1 ? 'Поражение' : `${place}-е место`;
    // Свой счёт — первым, остальные — по убыванию.
    const order = [...r.scores].sort((a, b) => (a.me ? -1 : b.me ? 1 : b.kg - a.kg));
    const boxes = order
      .map((s) => `<span><b style="color:${s.ink}">${Math.floor(s.kg)}</b> кг ${s.label}</span>`)
      .join('');
    this.open(
      `
      <div class="results-card ${outcome}">
        <p class="results-kicker">День окончен</p>
        <p class="results-title">${title}</p>
        <p class="results-duel">${boxes}</p>
        <dl class="compact">
          <div><dt>Подрезал ног</dt><dd>${r.hits}</dd></div>
          <div><dt>Подрезали тебе</dt><dd>${r.hurt}</dd></div>
          <div><dt>Выбил из тюков</dt><dd>${Math.round(r.knocked)} кг</dd></div>
          <div><dt>Утащил из стогов</dt><dd>${Math.round(r.stolen)} кг</dd></div>
          <div><dt>Утащили у тебя</dt><dd>${Math.round(r.lost)} кг</dd></div>
          <div><dt>Подстрелил</dt><dd>${r.shot}</dd></div>
          <div><dt>Подстрелили тебя</dt><dd>${r.shotDown}</dd></div>
          <div><dt>Улучшений</dt><dd>${r.perks}</dd></div>
          ${r.games > 0 ? `<div class="wide"><dt>Побед</dt><dd>${r.wins} из ${r.games}</dd></div>` : ''}
        </dl>
        <button type="button" id="results-again">Ещё раз</button>
        <button type="button" id="results-menu">Сменить режим</button>
      </div>`,
      onAgain,
      onMenu,
    );
  }

  private open(html: string, onAgain: () => void, onMenu: () => void): void {
    this.root.innerHTML = html;
    this.root.querySelector('#results-again')!.addEventListener('click', onAgain);
    this.root.querySelector('#results-menu')!.addEventListener('click', onMenu);
    this.root.hidden = false;
    this.visible = true;
  }
}
