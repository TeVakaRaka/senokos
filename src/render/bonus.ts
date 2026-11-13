// Находки на поле: точило, сапоги, спички. Висят над землёй, вертятся и светятся кольцом —
// чтобы их было видно издали.

import * as THREE from 'three';
import { BONUS_BOOTS, BONUS_WHET } from '../sim/bonus.ts';
import type { Bonus } from '../sim/game.ts';

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/** Цвет кольца и подписи находки — по её виду. */
export const BONUS_COLORS = [0x49c2e8, 0x6fd45c, 0xff7a2f];

function buildWhet(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.24), lambert(0x7b8794));
  stone.rotation.z = 0.35;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.25), lambert(0xc9d3dc));
  edge.rotation.z = 0.35;
  edge.position.y = 0.09;
  const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }));
  spark.position.set(0.3, 0.26, 0);
  g.add(stone, edge, spark);
  return g;
}

function buildBoots(): THREE.Group {
  const g = new THREE.Group();
  const leather = lambert(0x7a4a24);
  const sole = lambert(0x2f2620);
  for (const z of [-0.14, 0.14]) {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.18), leather);
    shaft.position.set(-0.06, 0.18, z);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.18), leather);
    foot.position.set(0.04, 0.02, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.19), sole);
    base.position.set(0.04, -0.07, z);
    g.add(shaft, foot, base);
  }
  return g;
}

function buildMatches(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.28), lambert(0x2f5fb0));
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.08, 0.2), lambert(0xf3e6c4));
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.035), lambert(0xe8d6a8));
  stick.position.set(0.05, 0.16, 0);
  stick.rotation.z = 0.5;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: 0xff4a2a }));
  head.position.set(0.22, 0.26, 0);
  g.add(box, label, stick, head);
  return g;
}

interface Item {
  group: THREE.Group;
  model: THREE.Group;
  ring: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export class BonusView {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, Item>();

  /** Привести картинку в соответствие со списком находок на поле. */
  sync(bonuses: readonly Bonus[], time: number): void {
    for (const [id, item] of this.items) {
      if (bonuses.some((b) => b.id === id)) continue;
      this.group.remove(item.group);
      item.material.dispose();
      this.items.delete(id);
    }
    for (const b of bonuses) {
      let item = this.items.get(b.id);
      if (!item) {
        const model = b.kind === BONUS_WHET ? buildWhet() : b.kind === BONUS_BOOTS ? buildBoots() : buildMatches();
        model.scale.setScalar(1.7);
        const material = new THREE.MeshBasicMaterial({
          color: BONUS_COLORS[b.kind]!,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.92, 32), material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        const group = new THREE.Group();
        group.add(model, ring);
        group.position.set(b.x, 0, b.y);
        this.group.add(group);
        item = { group, model, ring, material };
        this.items.set(b.id, item);
      }
      const pulse = 0.5 + 0.5 * Math.sin(time * 5 + b.id);
      item.model.position.y = 0.75 + 0.12 * Math.sin(time * 2.4 + b.id);
      item.model.rotation.y = time * 1.6 + b.id;
      item.ring.scale.setScalar(0.9 + 0.3 * pulse);
      item.material.opacity = 0.35 + 0.45 * pulse;
    }
  }

  dispose(): void {
    for (const item of this.items.values()) item.material.dispose();
    this.items.clear();
  }
}
