// Сцена целиком: связывает состояние симуляции с картинкой.

import * as THREE from 'three';
import { DIR_STEP_DEG, DIR_X, DIR_Y } from '../sim/dirs.ts';
import type { Game, Player } from '../sim/game.ts';
import { DT } from '../sim/tuning.ts';
import { IsoCamera } from './camera.ts';
import { DropsView } from './drops.ts';
import { CutBits } from './fx.ts';
import { Grass } from './grass.ts';
import { BLOOD_COLOR, Ground } from './ground.ts';
import { HeroView, type HeroPose } from './hero.ts';
import type { Look } from './look.ts';
import { buildRocks, buildTrees, PLAYER_COLORS, StackView } from './props.ts';

/** Уровень качества — только про картинку: правила и число кустиков от него не зависят. */
export interface Quality {
  fewerBlades: number; // на сколько травинок в кустике меньше, чем задумано видом
  maxPixelRatio: number;
  bits: number; // сколько клочков может лететь одновременно
}

export const QUALITY_HIGH: Quality = { fewerBlades: 0, maxPixelRatio: 2, bits: 420 };
export const QUALITY_LOW: Quality = { fewerBlades: 2, maxPixelRatio: 1.5, bits: 200 };

/** Что случилось за шаг с точки зрения своего игрока — для звука, вибрации и подсказок. */
export interface StepFx {
  swung: boolean; // свой взмах
  swingCut: number; // сколько кустиков он срезал
  foeSwing: number; // взмах соперника: громкость 0…1 по расстоянию (0 — не было или далеко)
  raked: number; // сколько кг сгребли в тюк
  picked: number; // сколько кг подняли из упавшего тюка
  stole: number; // сколько кг вытащили из чужого стога
  robbed: number; // сколько кг вытащили из своего стога
  unloaded: number; // сколько кг ушло в свой стог
  leveled: boolean; // пора выбирать улучшение
  swapped: boolean; // сменил инструмент
  hit: boolean; // подрезал сопернику ноги
  hitLoot: number; // и сколько кг тот при этом выронил
  hurt: boolean; // подрезали самого
  hurtBy: number; // кто подрезал (номер игрока; −1 — никто)
  dropped: number; // и сколько кг он при этом выронил
  knock: number; // сколько кг выбил из чужого тюка
  lost: number; // сколько кг выбили из своего тюка
  robber: number; // кто тащит из своего стога (номер игрока; −1 — никто)
}

const BASE_VIEW = 15; // метров по высоте экрана при обычной косе

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly iso = new IsoCamera();
  private readonly scene = new THREE.Scene();
  private readonly ground: Ground;
  private readonly grass: Grass;
  private readonly heroes: HeroView[] = [];
  private readonly stacks: StackView[] = [];
  private readonly drops: DropsView;
  private readonly bits: CutBits;
  private readonly quality: Quality;
  private readonly look: Look;
  private readonly baseReach: number;
  private readonly me: number;
  private readonly lastLoad: number[] = [];
  private readonly projected = new THREE.Vector3();
  private readonly pose: HeroPose = {
    load: 0,
    rakeRadius: 1,
    tool: 0,
    combo: false,
    crawling: false,
    shielded: false,
  };
  private time = 1; // часы картинки, секунды
  private shake = 0;
  private viewHeight = BASE_VIEW;

  /** me — за какого игрока смотрим: камера идёт за ним, события считаются от его лица. */
  constructor(canvas: HTMLCanvasElement, game: Game, quality: Quality, look: Look, me = 0) {
    this.quality = quality;
    this.look = look;
    this.me = me;
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

    this.grass = new Grass(
      field,
      look,
      Math.max(3, look.blades - quality.fewerBlades),
      game.tuning.dryTime,
      this.ground.texture,
    );
    this.scene.add(this.grass.group);

    this.scene.add(buildRocks(game.rocks));
    this.scene.add(buildTrees(field.size));

    this.drops = new DropsView(look.hayReady);
    this.scene.add(this.drops.group);

    this.bits = new CutBits(quality.bits);
    this.scene.add(this.bits.mesh);

    // Цвет закреплён за номером игрока — он одинаков на экранах всех участников.
    const duel = game.players.length > 1;
    for (let k = 0; k < game.players.length; k++) {
      const p = game.players[k]!;
      const color = this.colorOf(k);
      const stack = new StackView(p.stackX, p.stackY, duel ? color : null);
      this.stacks.push(stack);
      this.scene.add(stack.group);

      const hero = new HeroView(color, look.hayReady);
      this.heroes.push(hero);
      this.scene.add(hero.group, hero.swoosh, hero.lostLegs);
      this.lastLoad.push(p.load);
    }

    this.resize();
  }

  /** Цвет игрока номер k (число вида 0xRRGGBB). */
  colorOf(k: number): number {
    return PLAYER_COLORS[k % PLAYER_COLORS.length]!;
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
    const me = game.players[this.me]!;
    const fx: StepFx = {
      swung: false,
      swingCut: 0,
      foeSwing: 0,
      raked: me.rakedKg,
      picked: me.pickedKg,
      stole: me.stolenKg,
      robbed: 0,
      unloaded: me.unloadedKg,
      leveled: me.leveled,
      swapped: me.swapped,
      hit: false,
      hitLoot: 0,
      hurt: me.hitBy >= 0,
      hurtBy: me.hitBy,
      dropped: 0,
      knock: 0,
      lost: me.lostKg,
      robber: -1,
    };
    const field = game.field;
    const gameTime = game.tick * DT;
    const hay = this.look.hayReady;

    for (let k = 0; k < game.players.length; k++) {
      const p = game.players[k]!;
      const hero = this.heroes[k]!;
      const mine = k === this.me;

      const swing = p.swing;
      if (swing) {
        const dirX = DIR_X[swing.dir]!;
        const dirZ = DIR_Y[swing.dir]!;
        const facing = (swing.dir * DIR_STEP_DEG * Math.PI) / 180;
        hero.swingAt(swing.x, swing.y, facing, swing.reach, swing.arcDeg);
        if (mine) {
          fx.swung = true;
          fx.swingCut = swing.cut;
          fx.hit = swing.victim >= 0;
          this.shake = Math.min(1, 0.35 + swing.cut * 0.02 + (fx.hit ? 0.5 : 0));
        } else {
          const dist = Math.hypot(p.x - me.x, p.y - me.y);
          fx.foeSwing = Math.max(fx.foeSwing, Math.max(0, 1 - dist / 13));
        }

        // Клочки летят не из каждого кустика — иначе на широкой косе их слишком много.
        const count = p.cutTo - p.cutFrom;
        const every = Math.max(1, Math.ceil(count / 28));
        for (let n = 0; n < count; n++) {
          const i = game.cutIdx[p.cutFrom + n]!;
          const x = field.x[i]!;
          const z = field.y[i]!;
          // Срез идёт волной справа налево, как движется лезвие; трава ложится влево от косаря.
          const side = (x - swing.x) * -dirZ + (z - swing.y) * dirX;
          const delay = 0.02 + 0.09 * (0.5 - Math.max(-0.5, Math.min(0.5, side / (swing.reach * 2))));
          const layAngle = facing - Math.PI / 2 + (Math.random() - 0.5) * 0.9;
          this.grass.cut(i, this.time + delay, gameTime, layAngle);
          this.ground.stampMown(x, z);
          if (n % every === 0) this.bits.spawn(x, z, dirX, dirZ, 2);
        }
      }

      // Тюк едет за спиной косаря: туда летит сено из-под граблей, оттуда — в стог.
      const baleX = p.x - DIR_X[p.dir]! * 1.4;
      const baleZ = p.y - DIR_Y[p.dir]! * 1.4;

      const raked = p.rakeTo - p.rakeFrom;
      if (raked > 0) {
        const every = Math.max(1, Math.ceil(raked / 6));
        for (let n = 0; n < raked; n++) {
          const i = game.rakeIdx[p.rakeFrom + n]!;
          this.grass.rake(i, this.time);
          if (n % every === 0) this.bits.spawnToward(field.x[i]!, 0.15, field.y[i]!, baleX, 0.5, baleZ, 1, hay);
        }
      }

      if (p.pickedKg > 0) this.bits.spawnToward(p.x, 0.3, p.y, baleX, 0.6, baleZ, 6, hay);

      if (p.unloadedKg > 0) {
        this.stacks[k]!.poke();
        if (game.tick % 2 === 0) this.bits.spawnToward(baleX, 0.5, baleZ, p.stackX, 2.3, p.stackY, 2, hay);
      }

      // Кража: сено летит из чужого стога в тюк вора.
      if (p.stolenKg > 0) {
        const reach2 = game.tuning.stackReach * game.tuning.stackReach;
        for (let j = 0; j < game.players.length; j++) {
          if (j === k) continue;
          const q = game.players[j]!;
          const dx = p.x - q.stackX;
          const dy = p.y - q.stackY;
          if (dx * dx + dy * dy > reach2) continue;
          this.stacks[j]!.poke();
          if (j === this.me) {
            fx.robbed += p.stolenKg;
            fx.robber = k;
          }
          if (game.tick % 2 === 0) this.bits.spawnToward(q.stackX, 1.6, q.stackY, baleX, 0.5, baleZ, 2, hay);
        }
      }

      // Подрезали ноги: кровь, ноги остаются на месте, тюк падает.
      if (p.hitBy >= 0) {
        hero.dropLegs(p.x, p.y);
        this.ground.stampBlood(p.x, p.y, 1.0);
        for (let n = 0; n < 5; n++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.5 + Math.random() * 1.1;
          this.ground.stampBlood(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 0.25 + Math.random() * 0.3);
        }
        this.bits.burst(p.x, 0.45, p.y, 26, BLOOD_COLOR);
        if (p.hitBy === this.me) fx.hitLoot = this.lastLoad[k]!;
        if (mine) {
          fx.dropped = this.lastLoad[k]!;
          this.shake = 1;
        }
      } else if (p.crawl > 0 && (p.x !== p.px || p.y !== p.py)) {
        // Ползёт — за ним тянется след.
        this.ground.stampBlood(p.x, p.y, 0.3);
      }

      // Удар пришёлся по тюку: сено разлетается в сторону ударившего, ноги целы.
      if (p.lostKg > 0 && p.lostBy >= 0) {
        const by = game.players[p.lostBy]!;
        this.bits.spawnToward(baleX, 0.5, baleZ, by.x, 0.5, by.y, 14, hay);
        if (p.lostBy === this.me) fx.knock += p.lostKg;
        if (mine) this.shake = 0.8;
      }
      this.lastLoad[k] = p.load;
    }

    return fx;
  }

  private poseOf(game: Game, p: Player): HeroPose {
    const pose = this.pose;
    pose.load = p.load;
    pose.rakeRadius = p.d.rakeRadius;
    pose.tool = p.tool;
    pose.combo = p.d.combo;
    pose.crawling = p.crawl > 0;
    pose.shielded = p.shield > 0 && !game.over;
    return pose;
  }

  /** Кадр. alpha — доля пути между прошлым и текущим шагом симуляции. */
  render(game: Game, alpha: number, dt: number): void {
    this.time += dt;
    let myX = 0;
    let myZ = 0;
    for (let k = 0; k < game.players.length; k++) {
      const p = game.players[k]!;
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.py + (p.y - p.py) * alpha;
      const dirAngle = (p.dir * DIR_STEP_DEG * Math.PI) / 180;
      this.heroes[k]!.update(x, z, dirAngle, p.speed, this.poseOf(game, p), dt, this.time);
      this.stacks[k]!.update(p.stacked, this.time, dt);
      if (k === this.me) {
        myX = x;
        myZ = z;
      } else {
        this.grass.setSecondHero(x, z);
      }
    }
    const me = game.players[this.me]!;

    this.grass.update(this.time, game.tick * DT, myX, myZ);
    this.drops.sync(game.drops, this.time);
    this.bits.update(dt);
    this.ground.flush();

    // Длиннее коса — камера чуть дальше, чтобы взмах помещался в кадр.
    const targetView = BASE_VIEW + (me.d.reach - this.baseReach) * 3.2;
    this.viewHeight += (targetView - this.viewHeight) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.viewHeight - this.iso.viewHeight) > 0.01) this.iso.setViewHeight(this.viewHeight);

    // Камера смотрит чуть вперёд по ходу героя; на взмахе слегка вздрагивает.
    const lookX = myX + DIR_X[me.dir]! * 1.2;
    const lookZ = myZ + DIR_Y[me.dir]! * 1.2;
    this.iso.follow(lookX, lookZ, dt);
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-dt * 14);
      this.iso.camera.position.y += Math.sin(this.time * 90) * 0.05 * this.shake;
    }

    this.renderer.render(this.scene, this.iso.camera);
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

  /** Маска поля (скошено / трава была / кровь) — для итоговой картинки. */
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
    this.drops.dispose();
    for (const hero of this.heroes) hero.dispose();
    this.bits.dispose();
    this.renderer.dispose();
  }
}
