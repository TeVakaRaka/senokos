// Земля: плоскость с маской 256×256. Канал R — где скошено, G — где вообще росла трава,
// B — где пролилась кровь (PvP). Эту же маску читает шейдер травы, чтобы окрасить
// травинки, и она же позже даст картинку поля для экрана итогов.

import * as THREE from 'three';
import type { Look } from './look.ts';

const RES = 256;

/** Цвет крови на земле и на траве. */
export const BLOOD_COLOR = 0x9c1512;

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vXZ = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform float uSize;
uniform vec3 uBare;
uniform vec3 uUnder;
uniform vec3 uMown;
uniform vec3 uOutside;
uniform vec3 uBlood;
varying vec2 vXZ;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vXZ / uSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec3 m = texture2D(uMask, clamp(uv, 0.0, 1.0)).rgb;
  vec3 col = mix(uBare, uUnder, m.g);
  col = mix(col, uMown, m.r * m.g);
  col = mix(col, uBlood, smoothstep(0.08, 0.55, m.b) * 0.9);
  col = mix(uOutside, col, inside);
  // Крупная «мозаика» — чтобы земля не была ровной заливкой.
  col *= 0.95 + 0.1 * hash(floor(vXZ * 2.5));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Ground {
  readonly mesh: THREE.Mesh;
  /** Маска: по четыре байта на точку (скошено, трава была, кровь, запас). */
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  private readonly size: number;
  private dirty = true;

  constructor(fieldSize: number, look: Look) {
    this.size = fieldSize;
    this.data = new Uint8Array(RES * RES * 4);
    this.texture = new THREE.DataTexture(this.data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMask: { value: this.texture },
        uSize: { value: fieldSize },
        uBare: { value: new THREE.Color(look.groundBare) },
        uUnder: { value: new THREE.Color(look.groundUnder) },
        uMown: { value: new THREE.Color(look.groundMown) },
        uOutside: { value: new THREE.Color(look.groundOutside) },
        uBlood: { value: new THREE.Color(BLOOD_COLOR) },
      },
    });

    const geometry = new THREE.PlaneGeometry(420, 420);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(fieldSize / 2, 0, fieldSize / 2);
    this.mesh.frustumCulled = false;
  }

  /** Отметить, что здесь росла трава. */
  stampGrass(x: number, y: number): void {
    this.stamp(1, x, y, 0.55);
  }

  /** Отметить скошенное место. */
  stampMown(x: number, y: number): void {
    this.stamp(0, x, y, 0.5);
  }

  /** Пятно крови. */
  stampBlood(x: number, y: number, radius: number): void {
    this.stamp(2, x, y, radius);
  }

  private stamp(channel: number, x: number, y: number, radius: number): void {
    const scale = RES / this.size;
    const cx = x * scale;
    const cy = y * scale;
    const r = radius * scale;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(RES - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(RES - 1, Math.ceil(cy + r));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
        if (d >= 1) continue;
        const value = Math.min(255, Math.round((1 - d * d) * 420));
        const idx = (py * RES + px) * 4 + channel;
        if (value > this.data[idx]!) this.data[idx] = value;
      }
    }
    this.dirty = true;
  }

  /** Отправить изменения маски в видеокарту (раз за кадр). */
  flush(): void {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
