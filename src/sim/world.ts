// Препятствия на поле: края, стоги, камни, магазин, будки, заборы и вода. Общие для людей
// и собак.

import type { Game } from './game.ts';
import { KENNEL_RADIUS, SHOP_RADIUS, STACK_RADIUS } from './gen.ts';
import type { Wall } from './nav.ts';

/** Точка, которую двигают на месте (чтобы не заводить новый объект на каждом шаге). */
export interface Spot {
  x: number;
  y: number;
}

/** Не дать телу радиуса r выйти за край поля и войти в препятствие. Меняет spot. */
export function collide(g: Game, spot: Spot, r: number): void {
  const hi = g.tuning.fieldSize - r;
  if (spot.x < r) spot.x = r;
  else if (spot.x > hi) spot.x = hi;
  if (spot.y < r) spot.y = r;
  else if (spot.y > hi) spot.y = hi;

  // Стоги (все — и свой, и чужие), камни, магазин, будки.
  for (let i = 0; i < g.players.length; i++) {
    const owner = g.players[i]!;
    pushOut(spot, owner.stackX, owner.stackY, STACK_RADIUS + r);
  }
  for (let i = 0; i < g.rocks.length; i++) {
    const rock = g.rocks[i]!;
    pushOut(spot, rock.x, rock.y, rock.r + r);
  }
  if (g.shop) pushOut(spot, g.shop.x, g.shop.y, SHOP_RADIUS + r);
  for (let i = 0; i < g.kennels.length; i++) {
    const k = g.kennels[i]!;
    pushOut(spot, k.x, k.y, KENNEL_RADIUS + r);
  }
  for (let i = 0; i < g.walls.length; i++) pushOutWall(spot, g.walls[i]!, r);
}

/** Отодвинуть точку от отрезка-капсулы (забор, кусок реки) по перпендикуляру. */
function pushOutWall(spot: Spot, w: Wall, r: number): void {
  const keep = w.r + r;
  const dx = w.bx - w.ax;
  const dy = w.by - w.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((spot.x - w.ax) * dx + (spot.y - w.ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = w.ax + dx * t;
  const cy = w.ay + dy * t;
  const ox = spot.x - cx;
  const oy = spot.y - cy;
  const d2 = ox * ox + oy * oy;
  if (d2 >= keep * keep) return;
  const dist = Math.sqrt(d2);
  if (dist > 1e-6) {
    spot.x = cx + (ox / dist) * keep;
    spot.y = cy + (oy / dist) * keep;
  } else {
    // Ровно на оси — отодвинуть вбок от отрезка.
    const len = Math.sqrt(len2);
    spot.x = cx - (dy / len) * keep;
    spot.y = cy + (dx / len) * keep;
  }
}

function pushOut(spot: Spot, cx: number, cy: number, keep: number): void {
  const dx = spot.x - cx;
  const dy = spot.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= keep * keep) return;
  const dist = Math.sqrt(d2);
  if (dist > 1e-6) {
    spot.x = cx + (dx / dist) * keep;
    spot.y = cy + (dy / dist) * keep;
  } else {
    spot.x = cx + keep;
  }
}

/**
 * Закрывает ли забор прямую от A до B. Сквозь забор не достают ни коса, ни ружьё, ни зубы
 * собаки. Вода не закрывает: через реку и так не дотянуться.
 */
export function fenced(g: Game, ax: number, ay: number, bx: number, by: number): boolean {
  for (let i = 0; i < g.walls.length; i++) {
    const w = g.walls[i]!;
    if (w.water) continue;
    // Отрезки пересекаются, когда концы каждого лежат по разные стороны от другого.
    const d1 = (bx - ax) * (w.ay - ay) - (by - ay) * (w.ax - ax);
    const d2 = (bx - ax) * (w.by - ay) - (by - ay) * (w.bx - ax);
    if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) continue;
    const d3 = (w.bx - w.ax) * (ay - w.ay) - (w.by - w.ay) * (ax - w.ax);
    const d4 = (w.bx - w.ax) * (by - w.ay) - (w.by - w.ay) * (bx - w.ax);
    if ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) return true;
  }
  return false;
}
