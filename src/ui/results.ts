// Итоги дня: сколько сена в стогу, лучший результат, кнопка «Ещё раз».

export interface DayResult {
  stacked: number; // кг в стогу
  mownShare: number; // доля скошенного поля 0…1
  groundKg: number; // сено, оставшееся на земле и в охапке
  perks: number;
  best: number; // лучший результат до этого дня (0 — не было)
}

export class Results {
  private readonly root: HTMLElement;
  visible = false;

  constructor() {
    const root = document.getElementById('results');
    if (!root) throw new Error('Нет разметки для итогов');
    this.root = root;
  }

  show(r: DayResult, onAgain: () => void): void {
    const kg = Math.floor(r.stacked);
    const record = kg > r.best;
    this.root.innerHTML = `
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
      </div>`;
    this.root.querySelector('#results-again')!.addEventListener('click', onAgain);
    this.root.hidden = false;
    this.visible = true;
  }
}
