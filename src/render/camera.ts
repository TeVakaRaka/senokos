// Изометрическая камера: ортографическая, смотрит сверху-сбоку, плавно едет за героем.
// Координаты симуляции (x, y) ложатся на землю как (x, 0, z = y).

import * as THREE from 'three';

const INV_SQRT2 = Math.SQRT1_2;

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  /** Сколько метров сцены помещается по высоте экрана. */
  viewHeight = 15;
  private aspect = 1;
  private readonly target = new THREE.Vector3();
  // Камера стоит со стороны +x, +z и выше: «вверх по экрану» — это в сторону −x, −z.
  private readonly offset = new THREE.Vector3(1, 1.7, 1).normalize().multiplyScalar(70);
  private first = true;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 220);
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.applyFrustum();
  }

  setViewHeight(meters: number): void {
    this.viewHeight = meters;
    this.applyFrustum();
  }

  private applyFrustum(): void {
    const halfH = this.viewHeight / 2;
    const halfW = halfH * this.aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Вести камеру к точке (x, z) на земле. */
  follow(x: number, z: number, dt: number): void {
    if (this.first) {
      this.target.set(x, 0, z);
      this.first = false;
    } else {
      const k = 1 - Math.exp(-dt * 5);
      this.target.x += (x - this.target.x) * k;
      this.target.z += (z - this.target.z) * k;
    }
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }

  /**
   * Вектор на экране (вправо, вверх) → направление на поле в координатах симуляции.
   * Палец вверх по экрану — герой идёт вверх по экрану.
   */
  screenToSim(right: number, up: number): [number, number] {
    return [INV_SQRT2 * (right - up), INV_SQRT2 * (-right - up)];
  }
}
