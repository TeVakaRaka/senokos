// Земля: плоскость с маской 256×256. Канал R — где скошено, канал G — где вообще росла трава.
// Эта же маска позже даст картинку поля для экрана итогов.

import * as THREE from 'three';
import type { Look } from './look.ts';

const RES = 256;

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
varying vec2 vXZ;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vXZ / uSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec2 m = texture2D(uMask, clamp(uv, 0.0, 1.0)).rg;
  vec3 col = mix(uBare, uUnder, m.g);
  col = mix(col, uMown, m.r * m.g);
  col = mix(uOutside, col, inside);
  // Крупная «мозаика» — чтобы земля не была ровной заливкой.
  col *= 0.95 + 0.1 * hash(floor(vXZ * 2.5));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Ground {
  readonly mesh: THREE.Mesh;
  /** Маска: по два байта на точку (скошено, трава была). */
  readonly data: Uint8Array;
  private readonly texture: THREE.DataTexture;
  private readonly size: number;
  private dirty = true;

  constructor(fieldSize: number, look: Look) {
    this.size = fieldSize;
    this.data = new Uint8Array(RES * RES * 2);
    this.texture = new THREE.DataTexture(this.data, RES, RES, THREE.RGFormat, THREE.UnsignedByteType);
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
        const idx = (py * RES + px) * 2 + channel;
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
