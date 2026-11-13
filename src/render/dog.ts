// Собака: низкополигональная, с ошейником цвета хозяина. Анимация процедурная:
// бег, сидит и виляет хвостом, бросок на укусе, ползёт с подрезанными лапами, гибель.

import * as THREE from 'three';

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export interface DogPose {
  speed: number; // м/с
  crawling: boolean;
}

export class DogView {
  readonly group = new THREE.Group();
  private readonly figure = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly tail: THREE.Mesh;
  private facing = 0;
  private first = true;
  private walk = 0;
  private lunge = 0; // 1 — только что укусила
  private crawlMix = 0;
  private dying = -1; // секунд с гибели; −1 — жива
  /** Можно убрать из сцены: доиграла гибель. */
  gone = false;

  constructor(collarColor: number) {
    const fur = lambert(0x9a6a3c);
    const dark = lambert(0x5b3a1e);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.25), fur);
    body.position.y = 0.4;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.22), lambert(0xc8a070));
    chest.position.set(0.27, 0.36, 0);
    this.figure.add(body, chest);

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.21), fur);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.13), lambert(0xc8a070));
    snout.position.set(0.17, -0.04, 0);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.06), lambert(0x161010));
    nose.position.set(0.245, -0.01, 0);
    const earGeo = new THREE.BoxGeometry(0.06, 0.12, 0.05);
    const earL = new THREE.Mesh(earGeo, dark);
    earL.position.set(-0.04, 0.14, -0.08);
    earL.rotation.x = -0.25;
    const earR = new THREE.Mesh(earGeo, dark);
    earR.position.set(-0.04, 0.14, 0.08);
    earR.rotation.x = 0.25;
    this.head.add(skull, snout, nose, earL, earR);
    this.head.position.set(0.38, 0.55, 0);
    this.figure.add(this.head);

    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.27), lambert(collarColor));
    collar.position.set(0.27, 0.5, 0);
    this.figure.add(collar);

    const tailGeo = new THREE.BoxGeometry(0.26, 0.055, 0.055);
    tailGeo.translate(-0.13, 0, 0);
    this.tail = new THREE.Mesh(tailGeo, fur);
    this.tail.position.set(-0.3, 0.48, 0);
    this.figure.add(this.tail);

    const legGeo = new THREE.BoxGeometry(0.07, 0.29, 0.07);
    legGeo.translate(0, -0.145, 0);
    for (const [lx, lz] of [
      [0.22, -0.08],
      [0.22, 0.08],
      [-0.22, -0.08],
      [-0.22, 0.08],
    ] as const) {
      const leg = new THREE.Mesh(legGeo, fur);
      leg.position.set(lx, 0.3, lz);
      this.legs.push(leg);
      this.figure.add(leg);
    }

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.figure.scale.setScalar(1.25); // покрупнее, чтобы собаку было видно издали
    this.group.add(this.figure, shadow);
  }

  /** Укусила — короткий бросок вперёд. */
  bite(): void {
    this.lunge = 1;
  }

  /** Погибла от выстрела: падает на бок и через пару секунд исчезает. */
  die(): void {
    if (this.dying < 0) this.dying = 0;
  }

  get dead(): boolean {
    return this.dying >= 0;
  }

  update(x: number, z: number, angle: number, pose: DogPose, dt: number, time: number): void {
    if (this.dying >= 0) {
      this.dying += dt;
      const t = Math.min(1, this.dying / 0.25);
      this.figure.rotation.x = (Math.PI / 2) * t;
      this.figure.position.y = 0.1 * t - Math.max(0, this.dying - 2.2) * 0.4;
      for (const leg of this.legs) leg.rotation.z = 0.5;
      if (this.dying > 3) this.gone = true;
      return;
    }
    this.group.position.set(x, 0, z);
    if (this.first) {
      this.first = false;
      this.facing = angle;
    }
    let diff = angle - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * (1 - Math.exp(-dt * 18));
    this.group.rotation.y = -this.facing;

    this.crawlMix += ((pose.crawling ? 1 : 0) - this.crawlMix) * (1 - Math.exp(-dt * 12));
    const moving = pose.speed > 0.15;
    this.walk += dt * (6 + pose.speed * 2.6) * (moving ? 1 : 0);
    const swing = moving ? Math.sin(this.walk) * 0.75 : 0;
    // Передняя левая с задней правой — в одну сторону, как у собак.
    this.legs[0]!.rotation.z = swing;
    this.legs[3]!.rotation.z = swing;
    this.legs[1]!.rotation.z = -swing;
    this.legs[2]!.rotation.z = -swing;
    const legScale = Math.max(0.15, 1 - this.crawlMix * 0.85);
    for (const leg of this.legs) leg.scale.y = legScale;
    this.figure.position.y = -0.2 * this.crawlMix + (moving ? Math.abs(Math.sin(this.walk)) * 0.03 : 0);

    // Сидит и виляет хвостом, бежит — хвост вытянут.
    this.tail.rotation.z = moving ? 0.25 : 0.7 + Math.sin(time * 9) * 0.1;
    this.tail.rotation.y = moving ? 0 : Math.sin(time * 9) * 0.6;
    this.figure.rotation.z = moving || this.crawlMix > 0.5 ? 0 : 0.18; // сидя — грудь выше

    this.lunge *= Math.exp(-dt * 10);
    this.head.position.x = 0.38 + 0.14 * this.lunge;
    this.figure.position.x = 0.12 * this.lunge;
  }
}
