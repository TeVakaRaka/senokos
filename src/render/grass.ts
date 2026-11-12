// Трава: каждый кустик — копия одной маленькой модели (инстансинг). Поле разбито на
// участки 6×6, чтобы видеокарта не рисовала то, что за экраном. Качание от ветра,
// отклонение от героя и срез в стерню считаются в шейдере.

import * as THREE from 'three';
import type { Field } from '../sim/field.ts';
import type { Look } from './look.ts';

const CHUNKS = 6;

const VERT = /* glsl */ `
attribute vec2 iOffset;   // положение кустика на поле
attribute vec3 iParams;   // поворот, размер, оттенок
attribute float iCut;     // когда срезан (в секундах картинки); −1 — стоит
attribute float aH;       // высота точки на травинке: 0 у земли, 1 на кончике

uniform float uTime;
uniform vec2 uHero;
uniform vec2 uWind;

varying float vH;
varying float vTint;
varying float vCut;

void main() {
  float cutT = iCut < -0.5 ? 0.0 : clamp((uTime - iCut) / 0.16, 0.0, 1.0);

  vec3 p = position;
  p.xz *= iParams.y * mix(1.0, 0.8, cutT);
  p.y *= iParams.y * mix(1.0, 0.15, cutT);   // стерня — низкая

  float c = cos(iParams.x);
  float s = sin(iParams.x);
  p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);

  float bend = aH * aH * (1.0 - cutT);

  // Ветер: две волны с разной частотой, фаза зависит от места на поле.
  float phase = iOffset.x * 0.9 + iOffset.y * 0.7;
  float sway = sin(uTime * 1.8 + phase) * 0.06 + sin(uTime * 3.3 + phase * 2.1) * 0.025;
  p.xz += uWind * sway * bend;

  // Герой раздвигает траву вокруг себя.
  vec2 away = iOffset - uHero;
  float dist = length(away);
  float push = (1.0 - smoothstep(0.25, 1.15, dist)) * 0.32 * bend;
  p.xz += (away / max(dist, 0.001)) * push;
  p.y -= push * 0.35;

  vec3 world = vec3(iOffset.x + p.x, p.y, iOffset.y + p.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

  vH = aH;
  vTint = iParams.z;
  vCut = cutT;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTipA;
uniform vec3 uTipB;
uniform vec3 uStubble;

varying float vH;
varying float vTint;
varying float vCut;

void main() {
  vec3 tip = mix(uTipA, uTipB, vTint);
  vec3 col = mix(uBase, tip, vH);
  col = mix(col, uStubble, vCut);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Небольшой собственный генератор: вид травы не обязан совпадать между устройствами. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Модель одного кустика: несколько изогнутых травинок веером. */
function buildTuftGeometry(
  look: Look,
  blades: number,
): { position: Float32Array; height: Float32Array; index: Uint16Array } {
  const rnd = lcg(1234567);
  const position: number[] = [];
  const height: number[] = [];
  const index: number[] = [];

  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI * 2 + (rnd() - 0.5) * 0.8;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    // Травинка развёрнута плоскостью почти поперёк своего наклона.
    const twist = angle + Math.PI / 2 + (rnd() - 0.5) * 0.9;
    const sideX = Math.cos(twist);
    const sideZ = Math.sin(twist);

    const baseR = 0.03 + rnd() * 0.1;
    const h = look.bladeHeight[0] + rnd() * (look.bladeHeight[1] - look.bladeHeight[0]);
    const lean = look.bladeLean[0] + rnd() * (look.bladeLean[1] - look.bladeLean[0]);
    const w = look.bladeWidth[0] + rnd() * (look.bladeWidth[1] - look.bladeWidth[0]);

    const bx = dirX * baseR;
    const bz = dirZ * baseR;
    const mx = bx + dirX * lean * 0.35;
    const mz = bz + dirZ * lean * 0.35;
    const tx = bx + dirX * lean;
    const tz = bz + dirZ * lean;

    const v = position.length / 3;
    position.push(bx - sideX * w, 0, bz - sideZ * w);
    position.push(bx + sideX * w, 0, bz + sideZ * w);
    position.push(mx - sideX * w * 0.72, h * 0.55, mz - sideZ * w * 0.72);
    position.push(mx + sideX * w * 0.72, h * 0.55, mz + sideZ * w * 0.72);
    position.push(tx, h, tz);
    height.push(0, 0, 0.55, 0.55, 1);
    index.push(v, v + 1, v + 3, v, v + 3, v + 2, v + 2, v + 3, v + 4);
  }

  return {
    position: new Float32Array(position),
    height: new Float32Array(height),
    index: new Uint16Array(index),
  };
}

export class Grass {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly cutAttrs: THREE.InstancedBufferAttribute[] = [];
  private readonly tuftChunk: Uint16Array;
  private readonly tuftSlot: Uint16Array;

  constructor(field: Field, look: Look, bladesPerTuft: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uHero: { value: new THREE.Vector2() },
        uWind: { value: new THREE.Vector2(0.8, 0.6) },
        uBase: { value: new THREE.Color(look.grassBase) },
        uTipA: { value: new THREE.Color(look.grassTipA) },
        uTipB: { value: new THREE.Color(look.grassTipB) },
        uStubble: { value: new THREE.Color(look.stubble) },
      },
    });

    const tuft = buildTuftGeometry(look, bladesPerTuft);
    const basePosition = new THREE.BufferAttribute(tuft.position, 3);
    const baseHeight = new THREE.BufferAttribute(tuft.height, 1);
    const baseIndex = new THREE.BufferAttribute(tuft.index, 1);

    // Раскладываем кустики по участкам.
    const chunkSize = field.size / CHUNKS;
    const chunkCount = CHUNKS * CHUNKS;
    const counts = new Int32Array(chunkCount);
    this.tuftChunk = new Uint16Array(field.count);
    this.tuftSlot = new Uint16Array(field.count);
    for (let i = 0; i < field.count; i++) {
      const cx = Math.min(CHUNKS - 1, Math.floor(field.x[i]! / chunkSize));
      const cy = Math.min(CHUNKS - 1, Math.floor(field.y[i]! / chunkSize));
      const c = cy * CHUNKS + cx;
      this.tuftChunk[i] = c;
      this.tuftSlot[i] = counts[c]!;
      counts[c]!++;
    }

    const offsets: Float32Array[] = [];
    const params: Float32Array[] = [];
    const cuts: Float32Array[] = [];
    for (let c = 0; c < chunkCount; c++) {
      offsets.push(new Float32Array(counts[c]! * 2));
      params.push(new Float32Array(counts[c]! * 3));
      cuts.push(new Float32Array(counts[c]!).fill(-1));
    }

    const rnd = lcg(987654321);
    for (let i = 0; i < field.count; i++) {
      const c = this.tuftChunk[i]!;
      const slot = this.tuftSlot[i]!;
      offsets[c]![slot * 2] = field.x[i]!;
      offsets[c]![slot * 2 + 1] = field.y[i]!;
      params[c]![slot * 3] = rnd() * Math.PI * 2; // поворот
      params[c]![slot * 3 + 1] = 0.85 + rnd() * 0.4; // размер
      params[c]![slot * 3 + 2] = rnd(); // оттенок
      if (field.hp[i] === 0) cuts[c]![slot] = 0; // уже скошен на момент создания картинки
    }

    for (let c = 0; c < chunkCount; c++) {
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(baseIndex);
      geometry.setAttribute('position', basePosition);
      geometry.setAttribute('aH', baseHeight);
      geometry.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets[c]!, 2));
      geometry.setAttribute('iParams', new THREE.InstancedBufferAttribute(params[c]!, 3));
      const cutAttr = new THREE.InstancedBufferAttribute(cuts[c]!, 1);
      cutAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('iCut', cutAttr);
      geometry.instanceCount = counts[c]!;
      this.cutAttrs.push(cutAttr);

      // Свой ограничивающий шар: по нему участок отсекается, когда он за экраном.
      const cx = (c % CHUNKS) + 0.5;
      const cy = Math.floor(c / CHUNKS) + 0.5;
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx * chunkSize, 0.4, cy * chunkSize),
        chunkSize * Math.SQRT1_2 + 1.2,
      );

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.visible = counts[c]! > 0;
      this.group.add(mesh);
    }
  }

  /** Срезать кустик: с этого момента он за 0,16 с оседает в стерню. */
  cut(tuftIndex: number, time: number): void {
    const attr = this.cutAttrs[this.tuftChunk[tuftIndex]!]!;
    (attr.array as Float32Array)[this.tuftSlot[tuftIndex]!] = time;
    attr.needsUpdate = true;
  }

  update(time: number, heroX: number, heroZ: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = time;
    (u.uHero!.value as THREE.Vector2).set(heroX, heroZ);
  }

  dispose(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.material.dispose();
  }
}
