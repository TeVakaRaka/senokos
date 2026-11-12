// Трава: каждый кустик — копия одной маленькой модели (инстансинг). Поле разбито на
// участки 6×6, чтобы видеокарта не рисовала то, что за экраном.
//
// У кустика три вида, и все считаются в шейдере:
//   стоит    — качается от ветра, раздвигается вокруг героя;
//   лежит    — скошен: травинки легли в одну сторону и сохнут, цвет идёт от зелёного к золотому;
//   сгребён  — грабли убрали сено, осталась короткая стерня.

import * as THREE from 'three';
import type { Field } from '../sim/field.ts';
import { DT } from '../sim/tuning.ts';
import { BLOOD_COLOR } from './ground.ts';
import type { Look } from './look.ts';

const CHUNKS = 6;

const VERT = /* glsl */ `
attribute vec2 iOffset;   // положение кустика на поле
attribute vec3 iParams;   // поворот, размер, оттенок
// Состояние: когда срезан (часы картинки; −1 — стоит), когда срезан (игровое время, с),
// когда сгребён (часы картинки; −1 — ещё лежит), в какую сторону лёг (угол).
attribute vec4 iState;
attribute float aH;       // высота точки на травинке: 0 у земли, 1 на кончике

uniform float uTime;      // часы картинки, с
uniform float uGameTime;  // игровое время, с (стоит, пока игрок выбирает перк)
uniform float uDryTime;   // сколько сохнет скошенное, с
uniform vec2 uHero;
uniform vec2 uHero2;    // второй косарь (в игре на одного — далеко за полем)
uniform vec2 uWind;
uniform sampler2D uMask;  // маска земли: в синем канале — кровь
uniform float uSize;      // размер поля, м

varying float vH;
varying float vTint;
varying float vLaid;
varying float vRaked;
varying float vDry;
varying float vPulse;
varying float vBlood;

void main() {
  float isCut = step(-0.5, iState.x);
  float cutT = isCut * clamp((uTime - iState.x) / 0.2, 0.0, 1.0);
  float rakeT = step(-0.5, iState.z) * clamp((uTime - iState.z) / 0.16, 0.0, 1.0);
  float dry = isCut * clamp((uGameTime - iState.y) / uDryTime, 0.0, 1.0);

  float c = cos(iParams.x);
  float s = sin(iParams.x);
  vec3 q = position * iParams.y;
  vec2 rxz = vec2(c * q.x - s * q.z, s * q.x + c * q.z);

  // Стоит: ветер (две волны, фаза по месту на поле) и герой, раздвигающий траву.
  float bend = aH * aH;
  float phase = iOffset.x * 0.9 + iOffset.y * 0.7;
  float sway = sin(uTime * 1.8 + phase) * 0.06 + sin(uTime * 3.3 + phase * 2.1) * 0.025;
  vec2 away = iOffset - uHero;
  float dist = length(away);
  float push = (1.0 - smoothstep(0.25, 1.15, dist)) * 0.32 * bend;
  vec2 away2 = iOffset - uHero2;
  float dist2 = length(away2);
  float push2 = (1.0 - smoothstep(0.25, 1.15, dist2)) * 0.32 * bend;
  vec3 stand = vec3(rxz.x, q.y, rxz.y);
  stand.xz += uWind * sway * bend + (away / max(dist, 0.001)) * push + (away2 / max(dist2, 0.001)) * push2;
  stand.y -= (push + push2) * 0.35;

  // Лежит: травинки легли в одну сторону. У каждого кустика своя высота над землёй,
  // иначе плоские травинки мерцают друг сквозь друга.
  vec2 d = vec2(cos(iState.w), sin(iState.w));
  float lift = 0.03 + 0.07 * fract(iParams.z * 7.31) + 0.06 * aH;
  vec3 laid = vec3(rxz.x * 0.55 + d.x * q.y, lift, rxz.y * 0.55 + d.y * q.y);

  // Сгребён: короткая стерня.
  vec3 stub = vec3(rxz.x * 0.8, q.y * 0.15, rxz.y * 0.8);

  float lay = cutT * cutT * (3.0 - 2.0 * cutT);
  vec3 p = mix(stand, laid, lay);
  p = mix(p, stub, rakeT);
  // Сено под граблями чуть подлетает.
  p.y += sin(rakeT * 3.14159) * 0.22 * aH;

  vec3 world = vec3(iOffset.x + p.x, p.y, iOffset.y + p.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

  vH = aH;
  vTint = iParams.z;
  vLaid = lay;
  vRaked = rakeT;
  vDry = dry;
  vPulse = sin(uTime * 2.6 + phase * 1.3);
  vBlood = texture2D(uMask, iOffset / uSize).b;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTipA;
uniform vec3 uTipB;
uniform vec3 uStubble;
uniform vec3 uHayWet;
uniform vec3 uHayDrying;
uniform vec3 uHayReady;
uniform vec3 uBlood;

varying float vH;
varying float vTint;
varying float vLaid;
varying float vRaked;
varying float vDry;
varying float vPulse;
varying float vBlood;

void main() {
  vec3 standing = mix(uBase, mix(uTipA, uTipB, vTint), vH);

  // Сохнет: зелёное → бледно-жёлтое. Высохло — золотое и чуть переливается.
  vec3 hay = mix(uHayWet, uHayDrying, vDry);
  float ready = smoothstep(0.96, 1.0, vDry);
  hay = mix(hay, uHayReady * (1.0 + 0.07 * vPulse), ready);
  hay *= (0.84 + 0.16 * vH) * (0.92 + 0.16 * vTint);

  vec3 col = mix(standing, hay, vLaid);
  col = mix(col, uStubble, vRaked);
  // Кровь: гуще у земли, кончики травинок остаются своего цвета.
  col = mix(col, uBlood, smoothstep(0.08, 0.55, vBlood) * (0.85 - 0.35 * vH));
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
  private readonly stateAttrs: THREE.InstancedBufferAttribute[] = [];
  private readonly tuftChunk: Uint16Array;
  private readonly tuftSlot: Uint16Array;

  constructor(field: Field, look: Look, bladesPerTuft: number, dryTime: number, mask: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uGameTime: { value: 0 },
        uDryTime: { value: dryTime },
        uHero: { value: new THREE.Vector2() },
        uHero2: { value: new THREE.Vector2(-1000, -1000) },
        uMask: { value: mask },
        uSize: { value: field.size },
        uBlood: { value: new THREE.Color(BLOOD_COLOR) },
        uWind: { value: new THREE.Vector2(0.8, 0.6) },
        uBase: { value: new THREE.Color(look.grassBase) },
        uTipA: { value: new THREE.Color(look.grassTipA) },
        uTipB: { value: new THREE.Color(look.grassTipB) },
        uStubble: { value: new THREE.Color(look.stubble) },
        uHayWet: { value: new THREE.Color(look.hayWet) },
        uHayDrying: { value: new THREE.Color(look.hayDrying) },
        uHayReady: { value: new THREE.Color(look.hayReady) },
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
    const states: Float32Array[] = [];
    for (let c = 0; c < chunkCount; c++) {
      offsets.push(new Float32Array(counts[c]! * 2));
      params.push(new Float32Array(counts[c]! * 3));
      states.push(new Float32Array(counts[c]! * 4));
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

      const state = states[c]!;
      const layAngle = rnd() * Math.PI * 2;
      if (field.hp[i] !== 0) {
        state.set([-1, 0, -1, layAngle], slot * 4); // стоит
      } else if (field.hay[i]! > 0) {
        state.set([0, field.cutTick[i]! * DT, -1, layAngle], slot * 4); // уже лежит (вчерашний покос)
      } else {
        state.set([0, 0, 0, layAngle], slot * 4); // уже сгребён
      }
    }

    for (let c = 0; c < chunkCount; c++) {
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(baseIndex);
      geometry.setAttribute('position', basePosition);
      geometry.setAttribute('aH', baseHeight);
      geometry.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets[c]!, 2));
      geometry.setAttribute('iParams', new THREE.InstancedBufferAttribute(params[c]!, 3));
      const stateAttr = new THREE.InstancedBufferAttribute(states[c]!, 4);
      stateAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('iState', stateAttr);
      geometry.instanceCount = counts[c]!;
      this.stateAttrs.push(stateAttr);

      // Свой ограничивающий шар: по нему участок отсекается, когда он за экраном.
      const cx = (c % CHUNKS) + 0.5;
      const cy = Math.floor(c / CHUNKS) + 0.5;
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx * chunkSize, 0.4, cy * chunkSize),
        chunkSize * Math.SQRT1_2 + 1.6,
      );

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.visible = counts[c]! > 0;
      this.group.add(mesh);
    }
  }

  /**
   * Срезать кустик: за 0,2 с он ложится на землю и начинает сохнуть.
   * time — часы картинки, gameTime — игровое время покоса, layAngle — куда лечь.
   */
  cut(tuftIndex: number, time: number, gameTime: number, layAngle: number): void {
    const attr = this.stateAttrs[this.tuftChunk[tuftIndex]!]!;
    const state = attr.array as Float32Array;
    const o = this.tuftSlot[tuftIndex]! * 4;
    state[o] = time;
    state[o + 1] = gameTime;
    state[o + 2] = -1;
    state[o + 3] = layAngle;
    attr.needsUpdate = true;
  }

  /** Сгрести сено с кустика: остаётся стерня. */
  rake(tuftIndex: number, time: number): void {
    const attr = this.stateAttrs[this.tuftChunk[tuftIndex]!]!;
    (attr.array as Float32Array)[this.tuftSlot[tuftIndex]! * 4 + 2] = time;
    attr.needsUpdate = true;
  }

  update(time: number, gameTime: number, heroX: number, heroZ: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uGameTime!.value = gameTime;
    (u.uHero!.value as THREE.Vector2).set(heroX, heroZ);
  }

  /** Где стоит второй косарь — трава раздвигается и вокруг него. */
  setSecondHero(x: number, z: number): void {
    (this.material.uniforms.uHero2!.value as THREE.Vector2).set(x, z);
  }

  dispose(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.material.dispose();
  }
}
