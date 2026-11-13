// Дождь: тёмное пятно от тучи на земле и косые струи в его пределах.

import * as THREE from 'three';

const STREAKS = 260;
const TOP = 7; // с какой высоты падают струи, м

export class RainView {
  readonly group = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly streaks: THREE.InstancedMesh;
  private readonly offsets = new Float32Array(STREAKS * 3); // x, z в долях радиуса и фаза
  private readonly matrix = new THREE.Matrix4();
  private readonly radius: number;

  constructor(radius: number) {
    this.radius = radius;
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 40),
      new THREE.MeshBasicMaterial({ color: 0x14202e, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.05;
    const drop = new THREE.BoxGeometry(0.035, 0.75, 0.035);
    this.streaks = new THREE.InstancedMesh(
      drop,
      new THREE.MeshBasicMaterial({ color: 0xcfe4f5, transparent: true, opacity: 0.55, depthWrite: false }),
      STREAKS,
    );
    this.streaks.frustumCulled = false;
    // Струи раскиданы по кругу равномерно (не зависит от игры — только картинка).
    for (let i = 0; i < STREAKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      this.offsets[i * 3] = Math.cos(a) * r;
      this.offsets[i * 3 + 1] = Math.sin(a) * r;
      this.offsets[i * 3 + 2] = Math.random();
    }
    this.group.add(this.shadow, this.streaks);
    this.group.visible = false;
  }

  /** Показать тучу с центром в (x, z) или спрятать. */
  update(visible: boolean, x: number, z: number, time: number): void {
    this.group.visible = visible;
    if (!visible) return;
    this.shadow.position.set(x, 0.05, z);
    const m = this.matrix;
    for (let i = 0; i < STREAKS; i++) {
      const fall = (time * 1.9 + this.offsets[i * 3 + 2]!) % 1;
      const y = TOP * (1 - fall);
      m.makeRotationZ(0.22);
      // Ветер сносит струю вбок, пока она падает.
      m.setPosition(x + this.offsets[i * 3]! * this.radius - fall * 1.4, y, z + this.offsets[i * 3 + 1]! * this.radius);
      this.streaks.setMatrixAt(i, m);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    (this.shadow.material as THREE.Material).dispose();
    (this.streaks.material as THREE.Material).dispose();
  }
}
