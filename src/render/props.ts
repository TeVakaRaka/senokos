// Предметы на поле: стоги, тюки, камни и деревья вокруг.

import * as THREE from 'three';
import type { Rock } from '../sim/gen.ts';

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Цвета игроков по номерам: красный, синий, жёлтый, фиолетовый. По ним узнаются косарь,
 * флаг на стогу, счёт и стрелки. Цвет у игрока один и тот же на всех экранах.
 */
export const PLAYER_COLORS = [0xd8503f, 0x3f6fd8, 0xe0a020, 0x8a4fd0];

/**
 * Стог. Сено растёт вместе с тем, что в него привезли; на шесте — флажок хозяина
 * (в игре на одного флажка нет).
 */
export class StackView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly flag: THREE.Mesh | null = null;
  private readonly trap = new THREE.Group();
  private readonly flames = new THREE.Group();
  private bounce = 0;

  constructor(x: number, z: number, flagColor: number | null) {
    const hay = lambert(0xdcb650);
    const hayDark = lambert(0xc49a3c);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 1.0, 9), hayDark);
    base.position.y = 0.5;
    const dome = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.5, 9), hay);
    dome.position.y = 1.72;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), lambert(0x7a5a36));
    pole.position.y = 1.6;
    this.body.add(base, dome, pole);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.group.add(this.body, shadow);

    if (flagColor !== null) {
      const cloth = new THREE.BoxGeometry(0.78, 0.46, 0.05);
      cloth.translate(0.41, -0.23, 0); // держится за шест левым краем, висит от верхушки вниз
      this.flag = new THREE.Mesh(cloth, lambert(flagColor));
      this.flag.rotation.y = Math.PI / 4; // полотнищем к камере: она смотрит с угла (+x, +z)
      this.group.add(this.flag);
    }
    // Капкан у подножия, со стороны камеры: железный круг с зубьями.
    const iron = lambert(0x3a3f47);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12), iron);
    this.trap.add(plate);
    for (let i = 0; i < 10; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), lambert(0xb9c2cc));
      const a = (i / 10) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.38, 0.12, Math.sin(a) * 0.38);
      this.trap.add(tooth);
    }
    this.trap.position.set(1.25, 0.05, 1.25);
    this.trap.visible = false;
    this.group.add(this.trap);

    // Огонь: языки пламени вокруг верхушки. Светятся сами, от солнца не зависят.
    const fire = [0xff7a1a, 0xffb02e, 0xff4a1a, 0xffd34d, 0xff8f1f, 0xffc23a];
    for (let i = 0; i < fire.length; i++) {
      const tongue = new THREE.Mesh(
        new THREE.ConeGeometry(0.34, 1.1, 5),
        new THREE.MeshBasicMaterial({ color: fire[i]!, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      const a = (i / fire.length) * Math.PI * 2;
      tongue.position.set(Math.cos(a) * 0.6, 2.0, Math.sin(a) * 0.6);
      this.flames.add(tongue);
    }
    this.flames.visible = false;
    this.group.add(this.flames);

    this.group.position.set(x, 0, z);
    this.update(0, 0, 0);
  }

  /** У стога взведён капкан. */
  setTrap(on: boolean): void {
    this.trap.visible = on;
  }

  /** Стог горит. */
  setFire(on: boolean): void {
    this.flames.visible = on;
  }

  /** Сено ушло в стог или его тащат оттуда — стог пружинит. */
  poke(): void {
    this.bounce = 1;
  }

  update(kg: number, time: number, dt: number): void {
    const k = Math.min(1, kg / 220);
    this.bounce *= Math.exp(-dt * 8);
    const squash = 1 - 0.06 * this.bounce * Math.sin(time * 40);
    const w = 0.85 + 0.3 * k;
    const h = (0.75 + 0.85 * k) * squash;
    this.body.scale.set(w, h, w);
    if (this.flag) {
      this.flag.position.y = 3.2 * h; // верхушка шеста
      this.flag.rotation.z = Math.sin(time * 3.1) * 0.05;
    }
    if (this.flames.visible) {
      // Языки пламени пляшут: каждый дрожит по-своему и держится у верхушки стога.
      const top = 1.2 + 1.5 * h;
      for (let i = 0; i < this.flames.children.length; i++) {
        const tongue = this.flames.children[i]!;
        const flick = 0.75 + 0.45 * Math.abs(Math.sin(time * (9 + i * 1.7) + i * 2.1));
        tongue.scale.set(w, flick * 1.25, w);
        tongue.position.y = top * (0.55 + 0.08 * i) + 0.25 * flick;
        tongue.rotation.z = Math.sin(time * 7 + i) * 0.18;
      }
    }
  }
}

/** Тюк сена единичного размера: брусок с двумя обвязками — чтобы читался как тюк, а не куча. */
export function buildBale(hayColor: number): THREE.Group {
  const group = new THREE.Group();
  const hay = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.7, 0.8), lambert(hayColor));
  hay.position.y = 0.35;
  const twineGeo = new THREE.BoxGeometry(0.06, 0.73, 0.83);
  const twine = lambert(0x8a5a1c);
  const twineA = new THREE.Mesh(twineGeo, twine);
  twineA.position.set(-0.28, 0.35, 0);
  const twineB = new THREE.Mesh(twineGeo, twine);
  twineB.position.set(0.28, 0.35, 0);
  group.add(hay, twineA, twineB);
  return group;
}

/** Размер тюка по весу: объём растёт вместе с сеном. */
export function baleScale(kg: number): number {
  return Math.max(0.3, 0.36 * Math.cbrt(kg));
}

export function buildRocks(rocks: Rock[]): THREE.Group {
  const group = new THREE.Group();
  const material = lambert(0x8f9499);
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const rnd = lcg(4242);
  for (const rock of rocks) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(rock.x, rock.r * 0.45, rock.y);
    mesh.scale.set(rock.r * 1.05, rock.r * (0.7 + rnd() * 0.3), rock.r * 1.05);
    mesh.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    group.add(mesh);
  }
  return group;
}

/**
 * Деревья по краю поля. Со стороны камеры (+x, +z) они стоят дальше от границы,
 * чтобы кроны не закрывали траву у ближнего края.
 */
export function buildTrees(fieldSize: number): THREE.Group {
  const group = new THREE.Group();
  const rnd = lcg(777);
  const spots: { x: number; z: number; h: number }[] = [];

  const place = (x: number, z: number, near: boolean) => {
    const out = near ? 5 + rnd() * 7 : 1.2 + rnd() * 6;
    const h = 2.6 + rnd() * 2.4;
    return { out, h, x, z };
  };

  for (let s = -8; s < fieldSize + 8; s += 1.9) {
    const jitter = (rnd() - 0.5) * 1.2;
    // Дальние стороны (x < 0 и z < 0) — вплотную; ближние — с отступом.
    let p = place(s + jitter, 0, false);
    spots.push({ x: p.x, z: -p.out, h: p.h });
    p = place(0, s + jitter, false);
    spots.push({ x: -p.out, z: p.z, h: p.h });
    p = place(s + jitter, 0, true);
    spots.push({ x: p.x, z: fieldSize + p.out, h: p.h });
    p = place(0, s + jitter, true);
    spots.push({ x: fieldSize + p.out, z: p.z, h: p.h });
  }

  const crownGeo = new THREE.ConeGeometry(1, 1, 6);
  crownGeo.translate(0, 0.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.18, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crowns = new THREE.InstancedMesh(crownGeo, lambert(0xffffff), spots.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert(0x6d4c30), spots.length);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  spots.forEach((spot, i) => {
    const trunkH = spot.h * 0.3;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    m.compose(new THREE.Vector3(spot.x, 0, spot.z), q, new THREE.Vector3(1, trunkH, 1));
    trunks.setMatrixAt(i, m);
    const w = spot.h * (0.26 + rnd() * 0.08);
    m.compose(new THREE.Vector3(spot.x, trunkH * 0.8, spot.z), q, new THREE.Vector3(w, spot.h, w));
    crowns.setMatrixAt(i, m);
    color.setHSL(0.33 + (rnd() - 0.5) * 0.05, 0.42, 0.24 + rnd() * 0.08);
    crowns.setColorAt(i, color);
  });
  crowns.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

  group.add(trunks, crowns);
  return group;
}
