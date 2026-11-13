// Экран поверх игры: сено в стогах (своём и чужих) и полоска до следующего улучшения,
// время до конца дня, полоска тюка над героем и стрелки у края экрана — к своему стогу
// и к соперникам.

import { shopLeader } from '../sim/arms.ts';
import { TOOL_SCYTHE, type Game } from '../sim/game.ts';
import { levelThreshold } from '../sim/perks.ts';
import { DT } from '../sim/tuning.ts';
import type { View } from '../render/view.ts';
import { playerCss } from './players.ts';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el;
}

const ARROW_MARGIN = 34; // пикселей от края экрана
const ALARM_MS = 2500; // сколько стрелка к стогу остаётся красной после кражи

/** Соперник на экране: его счёт в плашке и стрелка к нему. */
interface Foe {
  index: number;
  item: HTMLElement;
  kg: HTMLElement;
  lastKg: number;
  arrow: HTMLElement;
}

/** Значок ружья (силуэт двустволки). */
export const GUN_ICON = '<svg viewBox="0 0 32 12" aria-hidden="true"><path d="M1.5 10.5 7.5 6.2H30v2.3H11.4l-1.9 2.3z" fill="currentColor"/><path d="M12 8.5h3.2l-.8 2.6h-2.9z" fill="currentColor"/></svg>';

/** Подпись над предметом на поле: заголовок, полоска сбора и число. */
interface Tag {
  root: HTMLElement;
  bar: HTMLElement;
  text: HTMLElement;
  key: string;
}

function makeTag(className: string, title: string): Tag {
  const root = document.createElement('div');
  root.className = `world-tag ${className}`;
  root.setAttribute('aria-hidden', 'true');
  const head = document.createElement('b');
  head.textContent = title;
  const bar = document.createElement('span');
  bar.className = 'tag-bar';
  const text = document.createElement('small');
  root.append(head, bar, text);
  document.body.append(root);
  return { root, bar, text, key: '' };
}

export class Hud {
  private readonly root = $('hud');
  private readonly stackKg = $('hud-stack-kg');
  private readonly xpFill = $('hud-xp-fill');
  private readonly time = $('hud-time');
  private readonly carry = $('carry');
  private readonly carryFill = $('carry-fill');
  private readonly arrow = $('stack-arrow');
  private readonly flashEl = $('flash');
  private readonly me: number;
  private readonly foes: Foe[] = [];
  private readonly meItem = $('hud-stack');
  private readonly shopTag: Tag;
  private readonly kennelTag: Tag;
  private readonly gunTag: HTMLElement;
  private readonly gunArrow: HTMLElement;
  private readonly gunBadge: HTMLElement;
  private readonly gunBadgeText: HTMLElement;
  private gunKey = '';
  private lastKg = -1;
  private lastSeconds = -1;
  private alarmUntil = 0;

  /**
   * me — номер своего игрока; players — сколько игроков на поле; foeLabel — подпись
   * счёта соперника, когда он один («кг у бота»).
   */
  constructor(me: number, players: number, foeLabel: string) {
    this.me = me;
    const duel = players > 1;
    this.root.classList.toggle('duel', duel);
    const foeBox = $('hud-foe');
    foeBox.hidden = !duel;

    // Подписи над ларьком, своей будкой и упавшим ружьём, стрелка к ружью, значок «ружьё твоё».
    this.shopTag = makeTag('shop-tag', 'Ружьё');
    this.kennelTag = makeTag('kennel-tag', 'Собака');
    this.gunTag = document.createElement('div');
    this.gunTag.className = 'world-tag gun-tag';
    this.gunTag.innerHTML = `${GUN_ICON}<b>Ружьё — подбери!</b>`;
    document.body.append(this.gunTag);
    this.gunArrow = document.createElement('div');
    this.gunArrow.className = 'edge-arrow gun';
    this.gunArrow.innerHTML = GUN_ICON;
    this.root.before(this.gunArrow);
    this.gunBadge = $('gun-badge');
    this.gunBadge.innerHTML = `${GUN_ICON}<small></small>`;
    this.gunBadgeText = this.gunBadge.querySelector('small')!;
    for (const el of [this.shopTag.root, this.kennelTag.root, this.gunTag, this.gunArrow, this.gunBadge]) el.hidden = true;
    const mark = document.createElement('span');
    mark.className = 'gun-mark';
    mark.innerHTML = GUN_ICON;
    $('hud-stack').querySelector('.hud-stack-line')!.append(mark);
    if (!duel) return;

    $('hud-stack-label').textContent = 'кг у тебя';
    $('hud-me-dot').style.background = playerCss(me);
    foeBox.textContent = '';
    foeBox.classList.toggle('many', players > 2);
    for (let k = 0; k < players; k++) {
      if (k === me) continue;
      const item = document.createElement('span');
      item.className = 'foe-item';
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = playerCss(k);
      const kg = document.createElement('b');
      kg.textContent = '0';
      const gunMark = document.createElement('span');
      gunMark.className = 'gun-mark';
      gunMark.innerHTML = GUN_ICON;
      item.append(dot, ' ', kg, gunMark);
      foeBox.append(item);

      // Стрелка к сопернику — его цвета. Кладём под плашками, чтобы не лезла поверх окон.
      const arrow = document.createElement('div');
      arrow.className = 'edge-arrow foe';
      arrow.textContent = '➜';
      arrow.style.background = playerCss(k);
      arrow.setAttribute('aria-hidden', 'true');
      this.root.before(arrow);

      this.foes.push({ index: k, item, kg, lastKg: -1, arrow });
    }
    if (this.foes.length === 1) {
      const label = document.createElement('small');
      label.textContent = ` ${foeLabel}`;
      foeBox.append(label);
    }
  }

  /** Дёшево: вызывать каждый кадр. Текст меняется только когда число изменилось. */
  update(game: Game, view: View): void {
    const p = game.players[this.me]!;
    const kg = Math.floor(p.stacked);
    if (kg !== this.lastKg) {
      this.lastKg = kg;
      this.stackKg.textContent = String(kg);
    }
    // Полоска — путь до следующего улучшения. Опыт — всё привезённое за день:
    // украденное из стога его не уменьшает.
    const from = p.level === 0 ? 0 : levelThreshold(game.tuning, p.level - 1);
    const to = levelThreshold(game.tuning, p.level);
    const progress = Math.max(0, Math.min(1, (p.delivered - from) / (to - from)));
    this.xpFill.style.transform = `scaleX(${progress})`;

    const seconds = Math.max(0, Math.ceil((game.dayTicks - game.tick) * DT));
    if (seconds !== this.lastSeconds) {
      this.lastSeconds = seconds;
      this.time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      this.time.classList.toggle('hurry', seconds <= 20);
    }

    const canvas = view.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Пока рана не зажила, края экрана остаются красноватыми: второй удар подрежет ноги.
    this.flashEl.classList.toggle('wounded', p.wound > 0 && p.crawl === 0 && !game.over);

    this.updateCarry(game, view);

    // Стрелка к своему стогу: когда есть что везти или когда стог грабят.
    const alarm = performance.now() < this.alarmUntil;
    this.arrow.classList.toggle('alarm', alarm);
    const stack = view.worldToScreen(p.stackX, 1, p.stackY);
    this.pointTo(this.arrow, stack.x, stack.y, w, h, (p.load > 0.001 || alarm) && !game.over);

    for (const foe of this.foes) {
      const q = game.players[foe.index]!;
      const foeKg = Math.floor(q.stacked);
      if (foeKg !== foe.lastKg) {
        foe.lastKg = foeKg;
        foe.kg.textContent = String(foeKg);
      }
      const s = view.worldToScreen(q.x, 1, q.y);
      this.pointTo(foe.arrow, s.x, s.y, w, h, !game.over);
    }

    this.updateArms(game, view, w, h);
  }

  /** Ларёк, будка, ружьё: подписи над ними, стрелка к упавшему ружью, у кого ружьё. */
  private updateArms(game: Game, view: View, w: number, h: number): void {
    const p = game.players[this.me]!;
    const gun = game.gun;
    const shop = game.shop;

    // Над ларьком: сколько сена собрано и кто сколько сдал (полоска из цветных кусков).
    const shopTag = this.shopTag;
    if (shop && !shop.sold && !game.over) {
      const s = view.worldToScreen(shop.x, 4.1, shop.y);
      shopTag.root.hidden = !(s.inFront && s.x > -60 && s.x < w + 60 && s.y > -40 && s.y < h + 40);
      shopTag.root.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      // С тюком у прилавка на ходу — подсказка: сено уходит, только когда стоишь. Показываем
      // её ровно там, где остановка сработает.
      const dx = p.x - shop.x;
      const dy = p.y - shop.y;
      const near = game.tuning.shopReach;
      const hint = p.load > 0.05 && p.speed > 0 && dx * dx + dy * dy < near * near;
      const leader = shopLeader(shop);
      const key = `${shop.given.map((v) => Math.floor(v)).join('|')}|${leader}|${hint}`;
      if (key !== shopTag.key) {
        shopTag.key = key;
        shopTag.bar.textContent = '';
        shop.given.forEach((kg, k) => {
          if (kg <= 0) return;
          const seg = document.createElement('i');
          seg.style.width = `${(kg / game.shopKg) * 100}%`;
          seg.style.background = playerCss(k);
          shopTag.bar.append(seg);
        });
        // Ружьё получит тот, кто сдал больше всех: показываем, кто сейчас впереди.
        const ahead =
          leader < 0 ? ' сена' : leader === this.me ? ' · впереди ты' : ` · впереди <i class="dot" style="background:${playerCss(leader)}"></i>`;
        shopTag.text.innerHTML = hint ? 'остановись — сдашь сено' : `${Math.floor(shop.kg)} из ${game.shopKg} кг${ahead}`;
        shopTag.root.classList.toggle('hint', hint);
      }
    } else {
      shopTag.root.hidden = true;
    }

    // Над своей будкой: сколько сена до собаки (пока собаки нет).
    const kennel = game.kennels[this.me];
    const kennelTag = this.kennelTag;
    if (kennel && !game.dogs[this.me] && !game.over) {
      const s = view.worldToScreen(kennel.x, 1.6, kennel.y);
      kennelTag.root.hidden = !(s.inFront && s.x > -60 && s.x < w + 60 && s.y > -40 && s.y < h + 40);
      kennelTag.root.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      const dx = p.x - kennel.x;
      const dy = p.y - kennel.y;
      const near = game.tuning.kennelReach;
      const hint = p.load > 0.05 && p.speed > 0 && dx * dx + dy * dy < near * near;
      const key = `${Math.floor(kennel.kg)}|${hint}`;
      if (key !== kennelTag.key) {
        kennelTag.key = key;
        kennelTag.bar.innerHTML = `<i style="width:${(kennel.kg / game.tuning.dogKg) * 100}%;background:${playerCss(this.me)}"></i>`;
        kennelTag.text.textContent = hint ? 'остановись — сдашь сено' : `${Math.floor(kennel.kg)} из ${game.tuning.dogKg} кг сена`;
        kennelTag.root.classList.toggle('hint', hint);
      }
    } else {
      kennelTag.root.hidden = true;
    }

    // Ружьё на земле: подпись над ним и стрелка у края экрана, если его не видно.
    const lying = gun !== null && gun.holder < 0 && !game.over;
    if (lying) {
      const s = view.worldToScreen(gun.x, 1.1, gun.y);
      const inside = s.x > 0 && s.x < w && s.y > 60 && s.y < h;
      this.gunTag.hidden = !inside;
      this.gunTag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      this.pointTo(this.gunArrow, s.x, s.y, w, h, true);
      this.gunArrow.hidden = false;
    } else {
      this.gunTag.hidden = true;
      this.gunArrow.hidden = true;
    }

    // У кого ружьё: значок в плашке счёта, а если оно твоё — плашка у кнопки инструмента.
    // Ружьё стреляет только с косой в руках: с граблями плашка тускнеет и просит взять косу.
    const holder = gun ? gun.holder : -1;
    const ready = p.tool === TOOL_SCYTHE || p.d.combo;
    const key = `${holder}|${game.over}|${ready}`;
    if (key !== this.gunKey) {
      this.gunKey = key;
      this.meItem.classList.toggle('has-gun', holder === this.me);
      for (const foe of this.foes) foe.item.classList.toggle('has-gun', holder === foe.index);
      this.gunBadge.hidden = holder !== this.me || game.over;
      this.gunBadge.classList.toggle('idle', !ready);
      this.gunBadgeText.textContent = ready ? 'Ружьё стреляет само' : 'Возьми косу — выстрелит';
    }
  }

  /** Красная вспышка по краям: подрезали ноги. */
  flash(): void {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth; // перезапустить анимацию
    this.flashEl.classList.add('go');
  }

  /** Свой стог грабят: стрелка к нему краснеет и показывается, даже если тюк пуст. */
  alarm(): void {
    this.alarmUntil = performance.now() + ALARM_MS;
  }

  /** Полоска над героем: сколько сена в тюке, а ползком — сколько ещё ползти. */
  private updateCarry(game: Game, view: View): void {
    const p = game.players[this.me]!;
    const crawling = p.crawl > 0;
    if (!crawling && p.load <= 0.001) {
      this.carry.style.opacity = '0';
      return;
    }
    const cap = p.d.carryCap;
    const s = view.worldToScreen(p.x, crawling ? 1.1 : 2.05, p.y);
    this.carry.style.opacity = '1';
    this.carry.style.transform = `translate(${s.x}px, ${s.y}px)`;
    this.carry.classList.toggle('crawl', crawling);
    this.carry.classList.toggle('full', !crawling && p.load >= cap);
    const share = crawling ? p.crawl / game.crawlTicks : p.load / cap;
    this.carryFill.style.transform = `scaleX(${Math.min(1, share)})`;
  }

  /** Поставить стрелку на край экрана в сторону точки (sx, sy); если точка видна — спрятать. */
  private pointTo(el: HTMLElement, sx: number, sy: number, w: number, h: number, wanted: boolean): void {
    const inside = sx > 0 && sx < w && sy > 60 && sy < h;
    if (!wanted || inside) {
      el.style.opacity = '0';
      return;
    }
    const cx = w / 2;
    const cy = h / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const kx = (w / 2 - ARROW_MARGIN) / Math.max(1e-6, Math.abs(dx));
    const ky = (h / 2 - ARROW_MARGIN - 40) / Math.max(1e-6, Math.abs(dy));
    const k = Math.min(kx, ky);
    el.style.opacity = '1';
    el.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px) rotate(${Math.atan2(dy, dx)}rad)`;
  }
}
