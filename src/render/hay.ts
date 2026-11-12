// Кучки сена на поле. Цвет показывает сушку: зелёная → жёлтая → золотая (готова).
// Готовые кучки чуть крупнее и покачиваются — их видно издалека.

import * as THREE from 'three';
import type { Game } from '../sim/game.ts';
import { MAX_PILES } from '../sim/hay.ts';
import type { Look } from './look.ts';

const POP_TIME = 0.28; // секунд «выпрыгивает» новая кучка

export class PilesView {
  readonly mesh: THREE.InstancedMesh;
  private readonly births = new Map<number, number>();
  private readonly wet: THREE.Color;
  private readonly drying: THREE.Color;
  private readonly ready: THREE.Color;
  private readonly color = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(look: Look) {
    // Валок: вытянутый пологий холмик, наполовину в земле — не путать с кустом.
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    geometry.scale(1.45, 0.4, 0.8);
    geometry.translate(0, 0.08, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PILES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(look.pileWet)); // создаёт буфер цветов

    this.wet = new THREE.Color(look.pileWet);
    this.drying = new THREE.Color(look.pileDrying);
    this.ready = new THREE.Color(look.pileReady);
  }

  /** Новая кучка появилась в этот момент — сыграть «выпрыгивание». */
  born(id: number, time: number): void {
    this.births.set(id, time);
  }

  forget(id: number): void {
    this.births.delete(id);
  }

  update(game: Game, time: number): void {
    const piles = game.piles;
    const n = Math.min(piles.length, MAX_PILES);
    for (let i = 0; i < n; i++) {
      const p = piles[i]!;
      const birth = this.births.get(p.id);
      let pop = 1;
      if (birth !== undefined) {
        const t = (time - birth) / POP_TIME;
        if (t >= 1) this.births.delete(p.id);
        else pop = easeOutBack(Math.max(0, t));
      }
      const isReady = p.dry >= 1;
      // Размер по массе: объём растёт как куб радиуса.
      const size = 0.32 * Math.cbrt(p.mass) * pop * (isReady ? 1.12 : 1);
      const bob = isReady ? 0.04 + Math.sin(time * 3.2 + p.id * 1.7) * 0.035 : 0;

      this.quaternion.setFromAxisAngle(this.up, (p.id * 2.399) % (Math.PI * 2));
      this.position.set(p.x, bob, p.y);
      this.scale.set(size, size * (0.9 + ((p.id * 7) % 5) * 0.05), size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);

      if (isReady) {
        // Готовая кучка мягко «дышит» яркостью.
        const glow = 1 + 0.1 * Math.sin(time * 4 + p.id);
        this.color.copy(this.ready).multiplyScalar(glow);
      } else if (p.dry < 0.5) {
        this.color.copy(this.wet).lerp(this.drying, p.dry * 2);
      } else {
        this.color.copy(this.drying).lerp(this.ready, (p.dry - 0.5) * 1.4);
      }
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function easeOutBack(t: number): number {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}
