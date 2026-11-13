// Косарь из простых фигур и след взмаха косы. Анимация процедурная: шаг, покачивание,
// взмах, смена инструмента, ползком с подрезанными ногами, ружьё за спиной и выстрел,
// полёт от выстрела и лёжа на спине.

import * as THREE from 'three';
import { TOOL_RAKE } from '../sim/game.ts';
import { buildGun } from './arms.ts';
import { baleScale, buildBale } from './props.ts';

const AIM_TIME = 0.55; // секунд ружьё держит у бедра после выстрела
const FLASH_TIME = 0.07; // секунд видна вспышка у дула

const SWING_TIME = 0.2; // секунд длится взмах на экране
const SWOOSH_TIME = 0.32; // секунд виден белый след

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/** Что сейчас с косарём — из состояния симуляции. */
export interface HeroPose {
  load: number; // кг в тюке
  rakeRadius: number; // ширина граблей, м
  tool: number; // что в руках
  combo: boolean; // «синтез»: работают и коса, и грабли
  crawling: boolean; // ноги подрезаны
  shielded: boolean; // только что встал и пока неуязвим
  gun: boolean; // при нём ружьё
  flying: number; // 0…1 — летит, отброшенный выстрелом (0 — не летит)
  down: boolean; // лежит после выстрела
}

export class HeroView {
  readonly group = new THREE.Group();
  readonly swoosh: THREE.Mesh;
  /** Отрезанные ноги: лежат там, где подрезали, пока косарь ползёт. Живут в сцене, не в группе. */
  readonly lostLegs = new THREE.Group();

  /** Всё тело целиком (ноги и туловище): его опрокидывают, когда косаря подстрелили. */
  private readonly figure = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly gun: THREE.Group;
  private readonly flash: THREE.Mesh;
  private aim = 0; // 1 — только что выстрелил: ружьё у бедра
  private flashAge = 10;
  private downMix = 0; // 0 — на ногах, 1 — лежит на спине (плавно)
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly scythe = new THREE.Group();
  private readonly rake = new THREE.Group();
  private readonly rakeHead = new THREE.Group();
  private readonly rope: THREE.Mesh;
  private readonly bale: THREE.Group;
  private readonly swooshMaterial: THREE.ShaderMaterial;
  private rakeMix = 0; // 0 — грабли убраны, 1 — в работе (плавно)
  private shoulder = 0; // 0 — коса в руках, 1 — на плече (плавно)
  private crawlMix = 0; // 0 — на ногах, 1 — ползёт (плавно)

  private facing = 0; // текущий угол модели, радианы (в координатах симуляции)
  private firstFrame = true;
  private walk = 0; // фаза шага
  private swingAge = 10; // секунд с последнего взмаха
  private swingHalfArc = 0.96; // половина дуги последнего взмаха, радианы
  private swooshKey = '';

  /** color — цвет рубахи и ленты на шляпе: по нему игроки отличают своего от чужого. */
  constructor(color: number, hayColor: number) {
    // Ноги
    const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
    legGeo.translate(0, -0.25, 0);
    const pants = lambert(0x3d4b6e);
    this.legL = new THREE.Mesh(legGeo, pants);
    this.legR = new THREE.Mesh(legGeo, pants);
    this.legL.position.set(0, 0.5, -0.11);
    this.legR.position.set(0, 0.5, 0.11);
    this.figure.add(this.legL, this.legR);

    // Туловище, голова, шляпа с лентой
    const shirt = lambert(color);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.25, 0.62, 7), shirt);
    torso.position.y = 0.81;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), lambert(0xe3b58f));
    head.position.y = 1.28;
    const straw = lambert(0xe9cf6b);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.04, 10), straw);
    brim.position.y = 1.4;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.25, 0.08, 10), shirt);
    band.position.y = 1.46;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 10), straw);
    crown.position.y = 1.59;
    const armGeo = new THREE.BoxGeometry(0.42, 0.11, 0.11);
    const armL = new THREE.Mesh(armGeo, shirt);
    armL.position.set(0.2, 0.92, -0.2);
    armL.rotation.z = -0.5;
    const armR = armL.clone();
    armR.position.z = 0.2;
    this.body.add(torso, head, brim, band, crown, armL, armR);

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

    // Ружьё: за спиной наискосок; при выстреле — у бедра, стволом вперёд.
    this.gun = buildGun();
    this.gun.visible = false;
    this.flash = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.flash.visible = false;
    this.gun.getObjectByName('muzzle')!.add(this.flash);
    this.body.add(this.gun);

    this.figure.add(this.body);
    this.group.add(this.figure);

    // Грабли-волокуша: косарь тащит их за собой. Поперечина с зубьями (её ширина —
    // ширина граблей в игре) на черенке; сгребённое сено собирается за ней в тюк.
    const wood = lambert(0xb07f45);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 1), wood);
    bar.position.y = 0.21;
    this.rakeHead.add(bar);
    const toothGeo = new THREE.BoxGeometry(0.045, 0.2, 0.035);
    for (let k = 0; k < 9; k++) {
      const tooth = new THREE.Mesh(toothGeo, wood);
      tooth.position.set(-0.03, 0.1, (k / 8 - 0.5) * 0.94);
      tooth.rotation.z = -0.25;
      this.rakeHead.add(tooth);
    }
    this.rakeHead.position.x = -0.78;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.9, 5), wood);
    handle.position.set(-0.47, 0.53, 0);
    handle.rotation.z = -0.75;
    this.rake.add(this.rakeHead, handle);
    this.rake.visible = false;
    this.group.add(this.rake);

    // Тюк: растёт вместе с сеном в нём. С косой в руках косарь тянет его на верёвке.
    this.bale = buildBale(hayColor);
    this.bale.visible = false;
    this.group.add(this.bale);
    const ropeGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 4);
    this.rope = new THREE.Mesh(ropeGeo, lambert(0x8a5a1c));
    this.rope.visible = false;
    this.group.add(this.rope);

    // Тень-пятно под героем
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.group.add(shadow);

    // Отрезанные ноги: две штанины на земле и красные срезы.
    const cut = lambert(0xb01a16);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, pants);
      leg.rotation.z = Math.PI / 2; // лежит на боку
      leg.rotation.y = side * 0.5;
      leg.position.set(side * 0.08, 0.09, side * 0.2);
      const stub = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.17), cut);
      stub.position.y = 0.005;
      leg.add(stub);
      this.lostLegs.add(leg);
    }
    this.lostLegs.visible = false;

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

  /** Выстрел: ружьё к бедру, вспышка у дула, отдача. */
  fire(): void {
    this.aim = 1;
    this.flashAge = 0;
  }

  /** Подрезали ноги: они остаются лежать на этом месте. */
  dropLegs(x: number, z: number): void {
    this.lostLegs.position.set(x, 0, z);
    this.lostLegs.rotation.y = Math.random() * Math.PI * 2;
    this.lostLegs.visible = true;
  }

  /** Кадр. time — часы картинки (для мигания). */
  update(x: number, z: number, dirAngle: number, speed: number, pose: HeroPose, dt: number, time: number): void {
    this.group.position.set(x, 0, z);

    // Плавный поворот к направлению движения по кратчайшей дуге (в первом кадре — сразу).
    if (this.firstFrame) {
      this.firstFrame = false;
      this.facing = dirAngle;
      this.rakeMix = pose.combo || pose.tool === TOOL_RAKE ? 1 : 0;
      this.shoulder = pose.combo || pose.tool !== TOOL_RAKE ? 0 : 1;
    }
    let diff = dirAngle - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * (1 - Math.exp(-dt * 16));
    this.group.rotation.y = -this.facing;

    // Что в руках: коса спереди или на плече, грабли в работе или убраны.
    const rakeOn = pose.combo || pose.tool === TOOL_RAKE;
    const scytheOn = pose.combo || pose.tool !== TOOL_RAKE;
    const ease = 1 - Math.exp(-dt * 11);
    this.rakeMix += ((rakeOn ? 1 : 0) - this.rakeMix) * ease;
    this.shoulder += ((scytheOn ? 0 : 1) - this.shoulder) * ease;
    this.crawlMix += ((pose.crawling ? 1 : 0) - this.crawlMix) * (1 - Math.exp(-dt * 13));
    const crawl = this.crawlMix;

    // Шаг
    const moving = speed > 0.05;
    this.walk += dt * (4 + speed * 2.2) * (moving ? 1 : 0);
    const stride = moving ? Math.sin(this.walk) * Math.min(0.75, 0.25 + speed * 0.12) : 0;
    this.legL.rotation.z = stride;
    this.legR.rotation.z = -stride;
    // Ноги: ползком их нет (лежат отдельно), потом «отрастают» обратно.
    const legs = Math.max(0.001, 1 - crawl);
    this.legL.scale.setScalar(legs);
    this.legR.scale.setScalar(legs);

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
    const lean = this.swingAge < SWING_TIME ? -0.12 * Math.sin(t * Math.PI) : 0;

    // С граблями в руках коса уходит на плечо.
    if (this.shoulder > 0.01) {
      this.scythe.rotation.y = this.scythe.rotation.y * (1 - this.shoulder) + 1.3 * this.shoulder;
      this.scythe.rotation.z = 0.9 * this.shoulder;
      this.body.rotation.y *= 1 - this.shoulder;
    } else {
      this.scythe.rotation.z = 0;
    }

    // Ползком: туловище лежит на земле лицом вперёд и подтягивается руками.
    const pull = crawl > 0.5 && moving ? Math.sin(this.walk * 1.5) * 0.06 : 0;
    this.body.rotation.z = lean * (1 - crawl) - 1.32 * crawl;
    this.body.position.set(
      -0.42 * crawl + pull,
      (moving ? Math.abs(Math.sin(this.walk)) * 0.04 : 0) * (1 - crawl) + 0.1 * crawl,
      0,
    );
    this.scythe.visible = crawl < 0.5;

    // Грабли: появляются из-за спины, когда их берут в руки.
    this.rake.visible = this.rakeMix > 0.03 && crawl < 0.5;
    if (this.rake.visible) {
      this.rake.scale.setScalar(0.25 + 0.75 * this.rakeMix);
      this.rakeHead.scale.z = pose.rakeRadius * 1.9;
    }

    // Тюк за спиной: появляется с первым сеном, объём растёт вместе с весом.
    this.bale.visible = pose.load > 0.05 && crawl < 0.5;
    this.rope.visible = false;
    if (this.bale.visible) {
      const s = baleScale(pose.load);
      this.bale.scale.setScalar(s);
      this.bale.position.x = -0.95 - 0.58 * s;
      // Тюк слегка подпрыгивает на ходу.
      this.bale.position.y = moving ? Math.abs(Math.sin(this.walk * 0.5)) * 0.03 : 0;
      // Без граблей тюк едет на верёвке от пояса.
      if (this.rakeMix < 0.5) {
        const ax = -0.18;
        const ay = 0.72;
        const bx = this.bale.position.x + 0.5 * s;
        const by = 0.38 * s;
        const dx = bx - ax;
        const dy = by - ay;
        this.rope.visible = true;
        this.rope.position.set((ax + bx) / 2, (ay + by) / 2, 0);
        this.rope.scale.y = Math.hypot(dx, dy);
        this.rope.rotation.z = Math.atan2(-dx, dy);
      }
    }

    // Ружьё за спиной; после выстрела — у правого бедра стволом вперёд, потом обратно.
    this.gun.visible = pose.gun;
    this.aim = Math.max(0, this.aim - dt / AIM_TIME);
    const a = this.aim > 0.6 ? 1 : this.aim / 0.6; // быстро вскинул, медленно убрал
    this.gun.position.set(-0.22 + 0.36 * a, 1.0 - 0.08 * a, 0.02 + 0.22 * a);
    this.gun.rotation.set((-Math.PI / 4) * (1 - a), (-Math.PI / 2) * (1 - a), 0);
    this.flashAge += dt;
    this.flash.visible = this.flashAge < FLASH_TIME;
    if (this.flash.visible) this.flash.scale.setScalar(1 + this.flashAge * 12);
    if (this.aim > 0.85) this.body.position.x -= 0.1 * (this.aim - 0.85) * 6; // отдача

    // Подстрелили: летит назад, кувыркаясь, и лежит на спине.
    this.downMix += ((pose.down ? 1 : 0) - this.downMix) * (1 - Math.exp(-dt * (pose.down ? 14 : 5)));
    const fly = pose.flying;
    this.figure.rotation.z = (Math.PI / 2) * this.downMix + fly * 2.2;
    this.figure.position.y = Math.sin(fly * Math.PI) * 0.9 + 0.12 * this.downMix;
    if (this.downMix > 0.5) {
      this.scythe.visible = false;
      this.rake.visible = false;
    }

    // Только что встал: мигает, пока его нельзя подрезать снова.
    this.group.visible = !(pose.shielded && !pose.crawling && !pose.down && Math.floor(time * 11) % 2 === 0);
    if (!pose.crawling && this.lostLegs.visible) this.lostLegs.visible = false;

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
