// Локации: заборы и загоны, река с мостами.

import * as THREE from 'three';
import type { River, Wall } from '../sim/game.ts';

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

const POST_STEP = 1.2; // столбы забора — через столько метров

/** Деревянные заборы: столбы и две жерди. Всё — двумя наборами копий (мало вызовов отрисовки). */
export function buildFences(walls: readonly Wall[]): THREE.Group {
  const group = new THREE.Group();
  const fences = walls.filter((w) => !w.water);
  if (fences.length === 0) return group;

  let postCount = 0;
  for (const w of fences) postCount += Math.ceil(Math.hypot(w.bx - w.ax, w.by - w.ay) / POST_STEP) + 1;
  const postGeo = new THREE.BoxGeometry(0.11, 0.85, 0.11);
  postGeo.translate(0, 0.425, 0);
  const posts = new THREE.InstancedMesh(postGeo, lambert(0x8a6238), postCount);
  const railGeo = new THREE.BoxGeometry(1, 0.07, 0.06);
  const rails = new THREE.InstancedMesh(railGeo, lambert(0xa97b4a), fences.length * 2);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  let pi = 0;
  let ri = 0;
  for (const w of fences) {
    const dx = w.bx - w.ax;
    const dz = w.by - w.ay;
    const len = Math.hypot(dx, dz);
    q.setFromAxisAngle(up, -Math.atan2(dz, dx));
    const n = Math.ceil(len / POST_STEP);
    for (let i = 0; i <= n; i++) {
      pos.set(w.ax + (dx * i) / n, 0, w.ay + (dz * i) / n);
      scale.set(1, 0.9 + ((i * 37) % 7) * 0.03, 1); // столбы чуть разной высоты
      m.compose(pos, q, scale);
      posts.setMatrixAt(pi++, m);
    }
    for (const h of [0.36, 0.68]) {
      pos.set(w.ax + dx / 2, h, w.ay + dz / 2);
      scale.set(len, 1, 1);
      m.compose(pos, q, scale);
      rails.setMatrixAt(ri++, m);
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;
  group.add(posts, rails);
  return group;
}

const WATER_VERT = /* glsl */ `
attribute float aAcross; // 0 — один берег, 1 — другой
attribute float aAlong;  // метры вдоль реки
varying float vAcross;
varying float vAlong;
void main() {
  vAcross = aAcross;
  vAlong = aAlong;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
varying float vAcross;
varying float vAlong;
void main() {
  vec3 deep = vec3(0.16, 0.40, 0.62);
  vec3 light = vec3(0.36, 0.64, 0.84);
  float ripple = 0.5 + 0.5 * sin(vAlong * 1.9 - uTime * 1.6 + sin(vAcross * 9.0 + vAlong * 0.7) * 1.2);
  float edge = smoothstep(0.38, 0.5, abs(vAcross - 0.5)); // пена у берегов
  vec3 col = mix(deep, light, ripple * 0.45);
  col = mix(col, vec3(0.86, 0.93, 0.95), edge * 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Река: вода полосой вдоль оси (с рябью и пеной у берегов) и деревянные мосты. */
export class RiverView {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;

  constructor(river: River) {
    const pts = river.points;
    const w = river.half + 0.15;
    const position: number[] = [];
    const across: number[] = [];
    const along: number[] = [];
    const index: number[] = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      const tx = next.x - prev.x;
      const tz = next.y - prev.y;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;
      const p = pts[i]!;
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y);
      position.push(p.x + nx * w, 0.02, p.y + nz * w, p.x - nx * w, 0.02, p.y - nz * w);
      across.push(0, 1);
      along.push(dist, dist);
      if (i < pts.length - 1) {
        const v = i * 2;
        index.push(v, v + 1, v + 3, v, v + 3, v + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: { uTime: { value: 0 } },
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(geometry, this.material);
    water.frustumCulled = false;
    this.group.add(water);

    // Мосты: настил из досок поперёк реки и перила по краям прохода.
    const plank = lambert(0xa97b4a);
    const plankDark = lambert(0x8a6238);
    const rail = lambert(0x7a5430);
    for (const b of river.bridges) {
      const bridge = new THREE.Group();
      bridge.position.set(b.x, 0, b.y);
      bridge.rotation.y = -Math.atan2(b.uy, b.ux); // местная x — поперёк реки
      const deck = new THREE.Mesh(new THREE.BoxGeometry(b.length, 0.12, b.width), plank);
      deck.position.y = 0.08;
      bridge.add(deck);
      // Щели между досками — тёмные полоски через каждые 0,45 м.
      const gaps = Math.floor(b.length / 0.45);
      for (let i = 1; i < gaps; i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, b.width * 0.98), plankDark);
        line.position.set(-b.length / 2 + i * 0.45, 0.145, 0);
        bridge.add(line);
      }
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(b.length, 0.07, 0.08), rail);
        bar.position.set(0, 0.62, (side * b.width) / 2);
        bridge.add(bar);
        for (const end of [-1, 0, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.1), rail);
          post.position.set((end * b.length) / 2.05, 0.33, (side * b.width) / 2);
          bridge.add(post);
        }
      }
      this.group.add(bridge);
    }
  }

  update(time: number): void {
    this.material.uniforms.uTime!.value = time;
  }

  dispose(): void {
    this.material.dispose();
  }
}
