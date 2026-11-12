// Клочки травы, разлетающиеся от взмаха. Чисто для глаз: на счёт не влияют.

import * as THREE from 'three';

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  age: number;
  life: number;
}

export class CutBits {
  readonly mesh: THREE.InstancedMesh;
  private readonly bits: Bit[] = [];
  private readonly capacity: number;
  private readonly dummy = new THREE.Object3D();

  constructor(capacity: number) {
    this.capacity = capacity;
    const geometry = new THREE.PlaneGeometry(0.22, 0.06);
    const material = new THREE.MeshBasicMaterial({ color: 0x9fcf45, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Выбросить клочки из точки среза. dirX/dirZ — куда смотрел герой. */
  spawn(x: number, z: number, dirX: number, dirZ: number, amount: number): void {
    for (let i = 0; i < amount && this.bits.length < this.capacity; i++) {
      const a = Math.random() * Math.PI * 2;
      const side = 0.6 + Math.random() * 1.2;
      this.bits.push({
        x,
        y: 0.25 + Math.random() * 0.3,
        z,
        vx: dirX * 1.2 + Math.cos(a) * side,
        vy: 2.2 + Math.random() * 1.8,
        vz: dirZ * 1.2 + Math.sin(a) * side,
        spin: (Math.random() - 0.5) * 18,
        age: 0,
        life: 0.45 + Math.random() * 0.3,
      });
    }
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i]!;
      b.age += dt;
      if (b.age >= b.life) continue;
      b.vy -= 9.5 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.03) {
        b.y = 0.03;
        b.vx *= 0.5;
        b.vz *= 0.5;
        b.vy = 0;
      }
      this.bits[alive] = b;
      const shrink = 1 - (b.age / b.life) * (b.age / b.life);
      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(b.age * b.spin, b.age * b.spin * 0.7, 0.4);
      this.dummy.scale.setScalar(shrink);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(alive, this.dummy.matrix);
      alive++;
    }
    this.bits.length = alive;
    this.mesh.count = alive;
    if (alive > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
