// Предметы PvP: ружьё, ларёк в центре поля, будки у стогов, ружьё на земле.

import * as THREE from 'three';

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/**
 * Двустволка длиной около метра. Ствол смотрит вдоль +x, приклад — в −x.
 * У группы есть дочерний объект «muzzle» — точка у дула (для вспышки выстрела).
 */
export function buildGun(): THREE.Group {
  const group = new THREE.Group();
  const wood = lambert(0x7a4a24);
  const metal = lambert(0x34373c);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.085, 0.07), wood);
  stock.position.set(-0.3, -0.03, 0);
  stock.rotation.z = 0.18;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.065), wood);
  grip.position.set(-0.1, -0.005, 0);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.08), metal);
  receiver.position.set(0.02, 0.01, 0);
  const barrelGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6);
  barrelGeo.rotateZ(Math.PI / 2);
  const left = new THREE.Mesh(barrelGeo, metal);
  left.position.set(0.33, 0.02, -0.022);
  const right = new THREE.Mesh(barrelGeo, metal);
  right.position.set(0.33, 0.02, 0.022);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.07), wood);
  fore.position.set(0.18, -0.02, 0);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0.6, 0.02, 0);
  group.add(stock, grip, receiver, left, right, fore, muzzle);
  return group;
}

/** Вывеска с надписью — рисуется на холсте один раз. */
function signTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3e6c4';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#7a4a24';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#5a2f14';
  ctx.font = 'bold 76px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Ларёк в центре поля. За прилавком растёт стог из сданного сена; на прилавке лежит
 * ружьё, пока его не купили. Лицом — к камере.
 */
export class ShopView {
  readonly group = new THREE.Group();
  private readonly hay: THREE.Mesh;
  private readonly gun: THREE.Group;
  private readonly goods = new THREE.Group();
  private bounce = 0;

  constructor(x: number, z: number, hayColor: number) {
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI / 4; // местная +z смотрит на камеру
    const wood = lambert(0xb98a52);
    const darkWood = lambert(0x8b5e34);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.0), darkWood);
    floor.position.y = 0.06;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.5), wood);
    counter.position.set(0, 0.51, 0.7);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.07, 0.64), darkWood);
    top.position.set(0, 0.99, 0.7);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 0.1), lambert(0xa77a48));
    back.position.set(0, 1.0, -0.92);
    const sideGeo = new THREE.BoxGeometry(0.1, 1.3, 1.7);
    const sideL = new THREE.Mesh(sideGeo, wood);
    sideL.position.set(-1.22, 0.71, -0.08);
    const sideR = new THREE.Mesh(sideGeo, wood);
    sideR.position.set(1.22, 0.71, -0.08);
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.25, 6);
    const postL = new THREE.Mesh(postGeo, darkWood);
    postL.position.set(-1.22, 1.12, 0.92);
    const postR = new THREE.Mesh(postGeo, darkWood);
    postR.position.set(1.22, 1.12, 0.92);
    inner.add(floor, counter, top, back, sideL, sideR, postL, postR);

    // Полосатый навес.
    const red = lambert(0xd8503f);
    const cream = lambert(0xf3e6c4);
    const stripeGeo = new THREE.BoxGeometry(0.46, 0.05, 2.1);
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? red : cream);
      stripe.position.set(-1.15 + i * 0.46, 2.18, 0.02);
      stripe.rotation.x = 0.22;
      inner.add(stripe);
    }

    // Вывеска над навесом.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.42),
      new THREE.MeshBasicMaterial({ map: signTexture('РУЖЬЁ'), side: THREE.DoubleSide }),
    );
    sign.position.set(0, 2.62, 0.62);
    inner.add(sign);

    // Сено за прилавком — растёт по мере того, как его сдают.
    this.hay = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.1, 9), lambert(hayColor));
    this.hay.position.set(0, 0.12, -0.3);
    inner.add(this.hay);

    // Ружьё на прилавке, пока не купили.
    this.gun = buildGun();
    this.gun.position.set(0, 1.07, 0.72);
    this.gun.rotation.x = Math.PI / 2; // лежит на боку
    this.gun.scale.setScalar(1.2);
    inner.add(this.gun);

    // Когда ружьё продано, на прилавке — то, чем ларёк торгует дальше: пачка патронов
    // и бронежилет.
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.26), lambert(0xb3261e));
    pack.position.set(-0.6, 1.14, 0.72);
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.07, 0.27), lambert(0xffd23a));
    label.position.copy(pack.position);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.16), lambert(0x3f4a36));
    vest.position.set(0.55, 1.21, 0.72);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.18), lambert(0x8a9577));
    plate.position.copy(vest.position);
    this.goods.add(pack, label, vest, plate);
    this.goods.visible = false;
    inner.add(this.goods);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.group.add(inner, shadow);
    this.group.position.set(x, 0, z);
  }

  /** В ларёк сдали сено — он чуть пружинит. */
  poke(): void {
    this.bounce = 1;
  }

  /** share — сколько уже сдано (0…1); sold — ружьё купили. */
  update(share: number, sold: boolean, time: number, dt: number): void {
    const s = Math.max(0.001, Math.min(1, share));
    this.bounce *= Math.exp(-dt * 8);
    const squash = 1 - 0.08 * this.bounce * Math.sin(time * 40);
    this.hay.scale.set(0.35 + 0.65 * s, (0.15 + 0.85 * s) * squash, 0.35 + 0.65 * s);
    this.hay.position.y = 0.12 + 0.55 * this.hay.scale.y;
    this.gun.visible = !sold;
    this.goods.visible = sold;
    // Ружьё на прилавке чуть покачивается — чтобы его заметили.
    this.gun.rotation.y = Math.sin(time * 1.6) * 0.12;
  }
}

/** Будка у стога: крыша — цвета хозяина. Дверью к камере. */
export function buildKennel(x: number, z: number, color: number): THREE.Group {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI / 4;
  const wood = lambert(0xa87444);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.85), wood);
  body.position.y = 0.31;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.03), lambert(0x2a1a10));
  door.position.set(0, 0.25, 0.43);
  const roof = lambert(color);
  const panelGeo = new THREE.BoxGeometry(1.08, 0.07, 0.6);
  const front = new THREE.Mesh(panelGeo, roof);
  front.position.set(0, 0.82, 0.2);
  front.rotation.x = 0.68;
  const backPanel = new THREE.Mesh(panelGeo, roof);
  backPanel.position.set(0, 0.82, -0.2);
  backPanel.rotation.x = -0.68;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.07, 8), lambert(0x6f7f8f));
  bowl.position.set(0.42, 0.035, 0.62);
  inner.add(body, door, front, backPanel, bowl);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(inner, shadow);
  group.position.set(x, 0, z);
  return group;
}

/** Ружьё, упавшее на землю: лежит и светится кольцом, чтобы его было видно. */
export class GroundGunView {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;

  constructor() {
    const gun = buildGun();
    gun.rotation.x = Math.PI / 2;
    gun.rotation.y = 0.6;
    gun.position.y = 0.06;
    gun.scale.setScalar(1.15);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd23a,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.group.add(gun, this.ring);
    this.group.visible = false;
  }

  /** Показать на месте (x, z) или спрятать. */
  update(visible: boolean, x: number, z: number, time: number): void {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.set(x, 0, z);
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    this.ring.scale.setScalar(0.9 + 0.25 * pulse);
    this.ringMaterial.opacity = 0.35 + 0.45 * pulse;
  }

  dispose(): void {
    this.ringMaterial.dispose();
  }
}
