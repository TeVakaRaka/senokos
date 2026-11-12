// Герой из простых фигур и след взмаха косы. Анимация процедурная: шаг, покачивание, взмах.

import * as THREE from 'three';

const SWING_TIME = 0.2; // секунд длится взмах на экране
const SWOOSH_TIME = 0.32; // секунд виден белый след

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export class HeroView {
  readonly group = new THREE.Group();
  readonly swoosh: THREE.Mesh;

  private readonly body = new THREE.Group();
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly scythe = new THREE.Group();
  private readonly bundle: THREE.Mesh;
  private readonly swooshMaterial: THREE.ShaderMaterial;
  private load = 0; // доля заполнения охапки 0…1
  private full = false;
  private shoulder = 0; // 0 — коса в руках, 1 — на плече (плавно)

  private facing = 0; // текущий угол модели, радианы (в координатах симуляции)
  private walk = 0; // фаза шага
  private swingAge = 10; // секунд с последнего взмаха
  private swingHalfArc = 0.96; // половина дуги последнего взмаха, радианы
  private swooshKey = '';

  constructor() {
    // Ноги
    const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
    legGeo.translate(0, -0.25, 0);
    const pants = lambert(0x3d4b6e);
    this.legL = new THREE.Mesh(legGeo, pants);
    this.legR = new THREE.Mesh(legGeo, pants);
    this.legL.position.set(0, 0.5, -0.11);
    this.legR.position.set(0, 0.5, 0.11);
    this.group.add(this.legL, this.legR);

    // Туловище, голова, шляпа
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.25, 0.62, 7), lambert(0xd8503f));
    torso.position.y = 0.81;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), lambert(0xe3b58f));
    head.position.y = 1.28;
    const straw = lambert(0xe9cf6b);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.04, 10), straw);
    brim.position.y = 1.4;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 10), straw);
    crown.position.y = 1.51;
    const armGeo = new THREE.BoxGeometry(0.42, 0.11, 0.11);
    const armL = new THREE.Mesh(armGeo, lambert(0xd8503f));
    armL.position.set(0.2, 0.92, -0.2);
    armL.rotation.z = -0.5;
    const armR = armL.clone();
    armR.position.z = 0.2;
    this.body.add(torso, head, brim, crown, armL, armR);

    // Коса: косовище от рук к земле перед героем и лезвие поперёк. Модель смотрит вдоль +x.
    const snathLength = 1.45;
    const snathTilt = 0.52; // наклон к земле, радианы
    const snath = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, snathLength, 5), lambert(0xb07f45));
    snath.rotation.z = Math.PI / 2 - snathTilt;
    const handX = 0.22;
    const handY = 0.9;
    const tipX = handX + Math.cos(snathTilt) * snathLength;
    const tipY = handY - Math.sin(snathTilt) * snathLength;
    snath.position.set((handX + tipX) / 2, (handY + tipY) / 2, 0);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.85), lambert(0xf2f6f8));
    blade.position.set(tipX + 0.02, tipY + 0.02, -0.36);
    blade.rotation.y = 0.3;
    this.scythe.add(snath, blade);
    this.body.add(this.scythe);

    // Охапка сена за спиной: растёт вместе с грузом.
    this.bundle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), lambert(0xe9b93c));
    this.bundle.position.set(-0.32, 1.02, 0);
    this.bundle.scale.set(0.8, 0.7, 1);
    this.bundle.visible = false;
    this.body.add(this.bundle);
    this.group.add(this.body);

    // Тень-пятно под героем
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.group.add(shadow);

    // След взмаха: сектор-кольцо, по которому пробегает светлая полоса.
    this.swooshMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uProg: { value: 2 } },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aR;
        varying float vT;
        varying float vR;
        void main() {
          vT = aT;
          vR = aR;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProg;
        varying float vT;
        varying float vR;
        void main() {
          float head = uProg * 1.35;
          float trail = smoothstep(head - 0.75, head, vT) * (1.0 - step(head, vT));
          float radial = smoothstep(0.0, 0.25, vR) * (0.35 + 0.65 * vR) * (1.0 - smoothstep(0.92, 1.0, vR));
          float fade = 1.0 - smoothstep(0.55, 1.0, uProg);
          float a = trail * radial * fade * 0.85;
          gl_FragColor = vec4(vec3(1.0, 1.0, 0.92), a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.swoosh = new THREE.Mesh(new THREE.BufferGeometry(), this.swooshMaterial);
    this.swoosh.frustumCulled = false;
    this.swoosh.renderOrder = 10;
    this.swoosh.visible = false;
  }

  /** Взмах: запомнить место и направление, перестроить след под радиус и дугу. */
  swingAt(x: number, z: number, dirAngle: number, reach: number, arcDeg: number): void {
    this.swingAge = 0;
    this.swingHalfArc = (arcDeg * Math.PI) / 360;
    const key = `${reach.toFixed(2)}|${arcDeg.toFixed(1)}`;
    if (key !== this.swooshKey) {
      this.swooshKey = key;
      this.swoosh.geometry.dispose();
      this.swoosh.geometry = buildSwooshGeometry(reach, this.swingHalfArc);
    }
    this.swoosh.position.set(x, 0.7, z);
    this.swoosh.rotation.y = -dirAngle;
    this.swoosh.visible = true;
  }

  /** Сколько сена несёт герой: доля охапки 0…1 и полна ли она. */
  setLoad(fraction: number, full: boolean): void {
    this.load = fraction;
    this.full = full;
  }

  update(x: number, z: number, dirAngle: number, speed: number, dt: number): void {
    this.group.position.set(x, 0, z);

    // Плавный поворот к направлению движения по кратчайшей дуге.
    let diff = dirAngle - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * (1 - Math.exp(-dt * 16));
    this.group.rotation.y = -this.facing;

    // Шаг
    const moving = speed > 0.05;
    this.walk += dt * (4 + speed * 2.2) * (moving ? 1 : 0);
    const stride = moving ? Math.sin(this.walk) * Math.min(0.75, 0.25 + speed * 0.12) : 0;
    this.legL.rotation.z = stride;
    this.legR.rotation.z = -stride;
    this.body.position.y = moving ? Math.abs(Math.sin(this.walk)) * 0.04 : 0;

    // Взмах: коса проходит дугу справа налево, туловище подаётся следом.
    this.swingAge += dt;
    const t = Math.min(1, this.swingAge / SWING_TIME);
    const eased = 1 - (1 - t) * (1 - t);
    const rest = -0.5; // коса у правой ноги между взмахами
    const sweep = this.swingHalfArc * (1 - 2 * eased); // от +половины дуги к −половине
    const back = Math.min(1, Math.max(0, (this.swingAge - SWING_TIME - 0.12) / 0.3));
    const angle = this.swingAge < SWING_TIME + 0.12 ? sweep : -this.swingHalfArc + (rest + this.swingHalfArc) * back;
    // В координатах three поворот вокруг Y идёт в обратную сторону относительно угла симуляции.
    this.scythe.rotation.y = -angle;
    this.body.rotation.y = -angle * 0.25;
    this.body.rotation.z = this.swingAge < SWING_TIME ? -0.12 * Math.sin(t * Math.PI) : 0;

    // С полной охапкой коса уходит на плечо.
    this.shoulder += ((this.full ? 1 : 0) - this.shoulder) * (1 - Math.exp(-dt * 10));
    if (this.shoulder > 0.01) {
      this.scythe.rotation.y = this.scythe.rotation.y * (1 - this.shoulder) + 1.3 * this.shoulder;
      this.scythe.rotation.z = 0.9 * this.shoulder;
      this.body.rotation.y *= 1 - this.shoulder;
    } else {
      this.scythe.rotation.z = 0;
    }

    // Охапка: появляется с первым сеном и растёт до полной.
    this.bundle.visible = this.load > 0.01;
    if (this.bundle.visible) {
      const s = 0.45 + 0.75 * this.load;
      this.bundle.scale.set(0.8 * s, 0.7 * s, s);
      this.bundle.position.y = 1.0 + 0.12 * this.load;
    }

    // След
    const prog = this.swingAge / SWOOSH_TIME;
    this.swooshMaterial.uniforms.uProg!.value = prog;
    if (prog >= 1) this.swoosh.visible = false;
  }

  dispose(): void {
    this.swoosh.geometry.dispose();
    this.swooshMaterial.dispose();
  }
}

/** Сектор-кольцо в плоскости земли. aT бежит вдоль дуги (0 — справа от героя, 1 — слева). */
function buildSwooshGeometry(reach: number, halfArc: number): THREE.BufferGeometry {
  const segments = Math.max(8, Math.round((halfArc * 2) / 0.12));
  const inner = reach * 0.42;
  const position: number[] = [];
  const aT: number[] = [];
  const aR: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Модель смотрит вдоль +x; угол симуляции растёт по часовой стрелке (к +z), то есть вправо от героя.
    const angle = halfArc * (1 - 2 * t);
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    position.push(cx * inner, 0, cz * inner, cx * reach, 0, cz * reach);
    aT.push(t, t);
    aR.push(0, 1);
    if (i < segments) {
      const v = i * 2;
      index.push(v, v + 1, v + 3, v, v + 3, v + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  geometry.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 1));
  geometry.setIndex(index);
  return geometry;
}
