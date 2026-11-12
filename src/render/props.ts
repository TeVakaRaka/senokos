// Неподвижные предметы: стог, камни и деревья вокруг поля.

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

export function buildStack(x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  const hay = lambert(0xdcb650);
  const hayDark = lambert(0xc49a3c);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 1.0, 9), hayDark);
  base.position.y = 0.5;
  const dome = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.5, 9), hay);
  dome.position.y = 1.72;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), lambert(0x7a5a36));
  pole.position.y = 1.6;
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;

  group.add(base, dome, pole, shadow);
  group.position.set(x, 0, z);
  return group;
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
