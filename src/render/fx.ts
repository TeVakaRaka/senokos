// Летящие клочки: трава от взмаха, сено из-под граблей в тюк и из тюка в стог, брызги крови,
// дробь из ружья.
// Чисто для глаз: на счёт не влияют.

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
  gravity: number;
  r: number;
  g: number;
  b: number;
}

export class CutBits {
  readonly mesh: THREE.InstancedMesh;
  private readonly bits: Bit[] = [];
  private readonly capacity: number;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly grass = new THREE.Color(0x9fcf45);

  constructor(capacity: number) {
    this.capacity = capacity;
    const geometry = new THREE.PlaneGeometry(0.22, 0.06);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, this.grass);
  }

  private push(bit: Omit<Bit, 'r' | 'g' | 'b'>, color: THREE.Color): void {
    if (this.bits.length >= this.capacity) return;
    this.bits.push({ ...bit, r: color.r, g: color.g, b: color.b });
  }

  /** Трава из-под косы. dirX/dirZ — куда смотрел герой. */
  spawn(x: number, z: number, dirX: number, dirZ: number, amount: number): void {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const side = 0.6 + Math.random() * 1.2;
      this.push(
        {
          x,
          y: 0.25 + Math.random() * 0.3,
          z,
          vx: dirX * 1.2 + Math.cos(a) * side,
          vy: 2.2 + Math.random() * 1.8,
          vz: dirZ * 1.2 + Math.sin(a) * side,
          spin: (Math.random() - 0.5) * 18,
          age: 0,
          life: 0.45 + Math.random() * 0.3,
          gravity: 9.5,
        },
        this.grass,
      );
    }
  }

  /** Клочки летят дугой из одной точки в другую (в тюк, в стог). */
  spawnToward(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, amount: number, color: number): void {
    this.color.setHex(color);
    for (let i = 0; i < amount; i++) {
      const life = 0.32 + Math.random() * 0.14;
      const gravity = 14;
      const sx = fx + (Math.random() - 0.5) * 0.4;
      const sz = fz + (Math.random() - 0.5) * 0.4;
      // Начальная скорость, чтобы за life долететь до цели по параболе.
      this.push(
        {
          x: sx,
          y: fy,
          z: sz,
          vx: (tx - sx) / life,
          vy: (ty - fy) / life + (gravity * life) / 2,
          vz: (tz - sz) / life,
          spin: (Math.random() - 0.5) * 16,
          age: 0,
          life,
          gravity,
        },
        this.color,
      );
    }
  }

  /** Брызги во все стороны из одной точки (кровь, когда подрезали ноги). */
  burst(x: number, y: number, z: number, amount: number, color: number): void {
    this.color.setHex(color);
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = 1 + Math.random() * 3.2;
      this.push(
        {
          x,
          y,
          z,
          vx: Math.cos(a) * out,
          vy: 2.4 + Math.random() * 3.2,
          vz: Math.sin(a) * out,
          spin: (Math.random() - 0.5) * 20,
          age: 0,
          life: 0.5 + Math.random() * 0.45,
          gravity: 12,
        },
        this.color,
      );
    }
  }

  /**
   * Дробь: быстрые искры веером из точки (x, y, z) в сторону (dirX, dirZ), до range метров.
   * halfArc — половина ширины веера, радианы.
   */
  spray(x: number, y: number, z: number, dirX: number, dirZ: number, halfArc: number, range: number, amount: number, color: number): void {
    this.color.setHex(color);
    const base = Math.atan2(dirZ, dirX);
    for (let i = 0; i < amount; i++) {
      const a = base + (Math.random() * 2 - 1) * halfArc;
      const life = 0.1 + Math.random() * 0.08;
      const speed = (range * (0.75 + Math.random() * 0.35)) / life;
      this.push(
        {
          x,
          y,
          z,
          vx: Math.cos(a) * speed,
          vy: (Math.random() - 0.3) * 1.5,
          vz: Math.sin(a) * speed,
          spin: (Math.random() - 0.5) * 30,
          age: 0,
          life,
          gravity: 2,
        },
        this.color,
      );
    }
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i]!;
      b.age += dt;
      if (b.age >= b.life) continue;
      b.vy -= b.gravity * dt;
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
      const k = b.age / b.life;
      const shrink = 1 - k * k;
      this.dummy.position.set(b.x, b.y, b.z);
      this.dummy.rotation.set(b.age * b.spin, b.age * b.spin * 0.7, 0.4);
      this.dummy.scale.setScalar(shrink);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(alive, this.dummy.matrix);
      this.color.setRGB(b.r, b.g, b.b);
      this.mesh.setColorAt(alive, this.color);
      alive++;
    }
    this.bits.length = alive;
    this.mesh.count = alive;
    if (alive > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
