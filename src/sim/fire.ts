// Спички и пожар. Со спичками (находка на поле) достаточно подойти к чужому стогу — он
// загорается и теряет сено, пока хозяин или его напарник не подойдёт тушить, пока не
// прогорит положенное время или пока сено не кончится. Сгоревшее пропадает совсем.
// Если у стога взведён капкан, поджигатель попадает в него, а спички остаются при нём.

import { acting, allies } from './combat.ts';
import type { Game, Player } from './game.ts';
import { spring, trapAt } from './trap.ts';
import { DT } from './tuning.ts';

/** У кого «числится» огонь на общем стоге: у напарника с наименьшим номером. */
export function stackHead(g: Game, q: Player): Player {
  for (let k = 0; k < q.id; k++) {
    const m = g.players[k]!;
    if (m.stackX === q.stackX && m.stackY === q.stackY) return m;
  }
  return q;
}

/** Сколько сена в стоге игрока q вместе с напарниками, которые делят его. */
export function stackKg(g: Game, q: Player): number {
  let kg = 0;
  for (let k = 0; k < g.players.length; k++) {
    const m = g.players[k]!;
    if (m.stackX === q.stackX && m.stackY === q.stackY) kg += m.stacked;
  }
  return kg;
}

/** Игрок со спичками у чужого стога: поджигает его (или попадает в капкан). */
export function arson(g: Game, p: Player): void {
  if (!p.matches) return;
  const r = g.tuning.stackReach;
  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (q === p || allies(g, p, q)) continue;
    const dx = p.x - q.stackX;
    const dy = p.y - q.stackY;
    if (dx * dx + dy * dy > r * r) continue;
    const head = stackHead(g, q);
    if (head.fire > 0 || stackKg(g, q) <= 0) continue;
    const owner = trapAt(g, q);
    if (owner) {
      spring(g, owner, p);
      return;
    }
    head.fire = g.fireTicks;
    head.litBy = p.id;
    p.lit = head.id;
    p.matches = false;
    return;
  }
}

/** Горящие стоги теряют сено; хозяин или напарник рядом — тушит. */
export function burn(g: Game): void {
  const t = g.tuning;
  const r2 = t.stackReach * t.stackReach;
  for (let k = 0; k < g.players.length; k++) {
    const q = g.players[k]!;
    if (q.fire === 0) continue;
    // Тушит тот из своих, кто на ногах и стоит у стога.
    let saver: Player | null = null;
    for (let j = 0; j < g.players.length && !saver; j++) {
      const m = g.players[j]!;
      if (!allies(g, q, m) || !acting(m)) continue;
      const dx = m.x - q.stackX;
      const dy = m.y - q.stackY;
      if (dx * dx + dy * dy <= r2) saver = m;
    }
    if (saver) {
      q.fire = 0;
      saver.doused = true;
      continue;
    }
    // Горит: сено уходит из стога — сначала у того, на ком огонь, потом у напарников.
    let left = t.fireRate * DT;
    for (let j = 0; j < g.players.length && left > 0; j++) {
      const m = g.players[j]!;
      if (m.stackX !== q.stackX || m.stackY !== q.stackY || m.stacked <= 0) continue;
      const kg = m.stacked < left ? m.stacked : left;
      m.stacked -= kg;
      if (m.stacked < 1e-9) m.stacked = 0;
      m.burnt += kg;
      m.burntKg += kg;
      g.burntKg += kg;
      left -= kg;
    }
    q.fire--;
    if (stackKg(g, q) <= 0) q.fire = 0;
  }
}
