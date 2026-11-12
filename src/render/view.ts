// Сцена целиком: связывает состояние симуляции с картинкой.

import * as THREE from 'three';
import { DIR_STEP_DEG, DIR_X, DIR_Y } from '../sim/dirs.ts';
import type { Game } from '../sim/game.ts';
import { IsoCamera } from './camera.ts';
import { CutBits } from './fx.ts';
import { Grass } from './grass.ts';
import { Ground } from './ground.ts';
import { PilesView } from './hay.ts';
import { HeroView } from './hero.ts';
import type { Look } from './look.ts';
import { buildRocks, buildStack, buildTrees } from './props.ts';

/** Уровень качества — только про картинку: правила и число кустиков от него не зависят. */
export interface Quality {
  fewerBlades: number; // на сколько травинок в кустике меньше, чем задумано видом
  maxPixelRatio: number;
  bits: number; // сколько клочков может лететь одновременно
}

export const QUALITY_HIGH: Quality = { fewerBlades: 0, maxPixelRatio: 2, bits: 360 };
export const QUALITY_LOW: Quality = { fewerBlades: 2, maxPixelRatio: 1.5, bits: 160 };

/** Что случилось за шаг — для звука и вибрации. */
export interface StepFx {
  swingCut: number; // срезано кустиков (0 — взмаха не было)
  ready: number; // сколько кучек высохло
  picked: number; // сколько кг подобрано
  unloaded: number; // сколько кг ушло в стог
  leveled: boolean; // пора выбирать перк
}

const BASE_VIEW = 15; // метров по высоте экрана при обычной косе

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly iso = new IsoCamera();
  private readonly scene = new THREE.Scene();
  private readonly ground: Ground;
  private readonly grass: Grass;
  private readonly piles: PilesView;
  private readonly hero = new HeroView();
  private readonly stack: THREE.Group;
  private readonly bits: CutBits;
  private readonly quality: Quality;
  private readonly look: Look;
  private readonly baseReach: number;
  private readonly projected = new THREE.Vector3();
  private time = 1; // часы картинки, секунды
  private shake = 0;
  private stackBounce = 0;
  private viewHeight = BASE_VIEW;

  constructor(canvas: HTMLCanvasElement, game: Game, quality: Quality, look: Look) {
    this.quality = quality;
    this.look = look;
    this.baseReach = game.tuning.reach;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: pixelRatio < 2,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.scene.background = new THREE.Color(look.groundOutside);

    this.scene.add(new THREE.HemisphereLight(look.sky, look.skyGround, look.skyIntensity));
    const sun = new THREE.DirectionalLight(look.sun, look.sunIntensity);
    sun.position.set(-6, 12, 3);
    this.scene.add(sun);

    const field = game.field;
    this.ground = new Ground(field.size, look);
    for (let i = 0; i < field.count; i++) {
      this.ground.stampGrass(field.x[i]!, field.y[i]!);
      if (field.hp[i] === 0) this.ground.stampMown(field.x[i]!, field.y[i]!);
    }
    this.scene.add(this.ground.mesh);

    this.grass = new Grass(field, look, Math.max(3, look.blades - quality.fewerBlades));
    this.scene.add(this.grass.group);

    this.piles = new PilesView(look);
    this.scene.add(this.piles.mesh);

    this.stack = buildStack(game.stackX, game.stackY);
    this.scene.add(this.stack);
    this.scene.add(buildRocks(game.rocks));
    this.scene.add(buildTrees(field.size));

    this.bits = new CutBits(quality.bits);
    this.scene.add(this.bits.mesh);

    this.scene.add(this.hero.group);
    this.scene.add(this.hero.swoosh);

    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.iso.resize(width, height);
  }

  /** Вызывается после каждого шага симуляции: переносит события шага в картинку. */
  onStep(game: Game): StepFx {
    const fx: StepFx = { swingCut: 0, ready: 0, picked: 0, unloaded: game.unloadedKg, leveled: game.leveled };
    const h = game.hero;

    const swing = game.swing;
    if (swing) {
      fx.swingCut = swing.cut;
      const dirX = DIR_X[swing.dir]!;
      const dirZ = DIR_Y[swing.dir]!;
      this.hero.swingAt(swing.x, swing.y, (swing.dir * DIR_STEP_DEG * Math.PI) / 180, swing.reach, swing.arcDeg);
      this.shake = Math.min(1, 0.35 + swing.cut * 0.02);

      const field = game.field;
      // Клочки летят не из каждого кустика — иначе на широкой косе их слишком много.
      const every = Math.max(1, Math.ceil(game.cutCount / 28));
      for (let k = 0; k < game.cutCount; k++) {
        const i = game.cutIdx[k]!;
        const x = field.x[i]!;
        const z = field.y[i]!;
        // Срез идёт волной справа налево, как движется лезвие.
        const side = (x - swing.x) * -dirZ + (z - swing.y) * dirX;
        const delay = 0.02 + 0.09 * (0.5 - Math.max(-0.5, Math.min(0.5, side / (swing.reach * 2))));
        this.grass.cut(i, this.time + delay);
        this.ground.stampMown(x, z);
        if (k % every === 0) this.bits.spawn(x, z, dirX, dirZ, 2);
      }
    }

    // Новые кучки «выпрыгивают» с задержкой, когда трава уже легла.
    for (const id of game.newPileIds) this.piles.born(id, this.time + 0.12);

    // Высохшие — искры и звон.
    if (game.readyIds.length > 0) {
      fx.ready = game.readyIds.length;
      for (const id of game.readyIds) {
        const p = game.piles.find((q) => q.id === id);
        if (p) this.bits.sparkle(p.x, p.y, this.look.pileReady);
      }
    }

    // Подобранное летит в охапку.
    for (const pick of game.picks) {
      fx.picked += pick.kg;
      if (pick.removed) this.piles.forget(pick.id);
      this.bits.spawnToward(pick.x, 0.3, pick.y, h.x, 1.1, h.y, 4, this.look.pileReady);
    }

    // Выгрузка: сено летит из охапки в стог.
    if (game.unloadedKg > 0) {
      this.stackBounce = 1;
      if (game.tick % 2 === 0) {
        this.bits.spawnToward(h.x, 1.2, h.y, game.stackX, 2.3, game.stackY, 2, this.look.pileReady);
      }
    }
    return fx;
  }

  /** Кадр. alpha — доля пути между прошлым и текущим шагом симуляции. */
  render(game: Game, alpha: number, dt: number): void {
    this.time += dt;
    const h = game.hero;
    const x = h.px + (h.x - h.px) * alpha;
    const z = h.py + (h.y - h.py) * alpha;
    const dirAngle = (h.dir * DIR_STEP_DEG * Math.PI) / 180;

    this.hero.setLoad(h.load / game.d.carryCap, h.load >= game.d.carryCap);
    this.hero.update(x, z, dirAngle, h.speed, dt);
    this.grass.update(this.time, x, z);
    this.piles.update(game, this.time);
    this.bits.update(dt);
    this.ground.flush();
    this.updateStack(game, dt);

    // Длиннее коса — камера чуть дальше, чтобы взмах помещался в кадр.
    const targetView = BASE_VIEW + (game.d.reach - this.baseReach) * 3.2;
    this.viewHeight += (targetView - this.viewHeight) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.viewHeight - this.iso.viewHeight) > 0.01) this.iso.setViewHeight(this.viewHeight);

    // Камера смотрит чуть вперёд по ходу героя; на взмахе слегка вздрагивает.
    const lookX = x + DIR_X[h.dir]! * 1.2;
    const lookZ = z + DIR_Y[h.dir]! * 1.2;
    this.iso.follow(lookX, lookZ, dt);
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-dt * 14);
      this.iso.camera.position.y += Math.sin(this.time * 90) * 0.05 * this.shake;
    }

    this.renderer.render(this.scene, this.iso.camera);
  }

  /** Стог растёт вместе с сеном в нём и чуть пружинит при выгрузке. */
  private updateStack(game: Game, dt: number): void {
    const k = Math.min(1, game.stacked / 220);
    this.stackBounce *= Math.exp(-dt * 8);
    const squash = 1 - 0.06 * this.stackBounce * Math.sin(this.time * 40);
    const w = 0.85 + 0.3 * k;
    this.stack.scale.set(w, (0.75 + 0.85 * k) * squash, w);
  }

  /** Точка мира → пиксели на экране (CSS-пиксели относительно канваса). */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; inFront: boolean } {
    const v = this.projected.set(x, y, z).project(this.iso.camera);
    const canvas = this.renderer.domElement;
    return {
      x: ((v.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - v.y) / 2) * canvas.clientHeight,
      inFront: v.z < 1,
    };
  }

  /** Маска поля (скошено / трава была) — для итоговой картинки. */
  get mask(): Uint8Array {
    return this.ground.data;
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  get qualityName(): string {
    return this.quality === QUALITY_LOW ? 'простое' : 'полное';
  }

  dispose(): void {
    this.ground.dispose();
    this.grass.dispose();
    this.piles.dispose();
    this.hero.dispose();
    this.bits.dispose();
    this.renderer.dispose();
  }
}
