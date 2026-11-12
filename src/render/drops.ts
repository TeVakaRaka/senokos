// Тюки, выроненные на землю (в PvP — когда косарю подрезали ноги). Лежат, пока их не заберут.

import * as THREE from 'three';
import type { Drop } from '../sim/hay.ts';
import { baleScale, buildBale } from './props.ts';

export class DropsView {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, THREE.Group>();
  private readonly seen = new Set<number>();
  private readonly hayColor: number;

  constructor(hayColor: number) {
    this.hayColor = hayColor;
  }

  /** Привести картинку к списку тюков из симуляции. time — часы картинки. */
  sync(drops: readonly Drop[], time: number): void {
    this.seen.clear();
    for (const drop of drops) {
      this.seen.add(drop.id);
      let bale = this.items.get(drop.id);
      if (!bale) {
        bale = buildBale(this.hayColor);
        bale.position.set(drop.x, 0, drop.y);
        // Упал как попало: у каждого тюка свой поворот.
        bale.rotation.y = drop.id * 2.4;
        this.items.set(drop.id, bale);
        this.group.add(bale);
      }
      // Ничей тюк слегка «дышит» — чтобы его было видно в траве.
      bale.scale.setScalar(baleScale(drop.kg) * (1 + 0.05 * Math.sin(time * 5 + drop.id)));
    }
    for (const [id, bale] of this.items) {
      if (this.seen.has(id)) continue;
      this.group.remove(bale);
      this.items.delete(id);
    }
  }

  dispose(): void {
    for (const bale of this.items.values()) this.group.remove(bale);
    this.items.clear();
  }
}
