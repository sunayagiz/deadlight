import Phaser from 'phaser';
import {
  AMBIENT_RADIUS,
  FLASHLIGHT_HALF_ANGLE,
  FLASHLIGHT_RANGE,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  SIM_DT,
} from '../config';
import { ZOMBIES, spawnEnemy } from '../sim/enemies';
import { buildMap, mapSolids } from '../sim/map';
import { createGameState } from '../sim/state';
import { stepSim } from '../sim/step';
import { lerp } from '../sim/vec';
import { segmentClear } from '../sim/vision';
import { WEAPONS, cycleWeapon, equipWeapon } from '../sim/weapons';
import type { EnemyType, GameState } from '../sim/types';
import { InputCollector } from './input';
import { FixedLoop } from './loop';

const COLORS = {
  bullet: 0xffe08a,
  hostileBullet: 0x8aff7a,
  dashTint: 0x9fb4d8,
  telegraphTint: 0xff9090,
  melee: 0xe8eaed,
  hpBack: 0x3a0d0d,
  hpFill: 0xc23b3b,
  bossBarBack: 0x33111a,
  bossBarFill: 0xd23b5a,
};

/** All character art faces "down" (south, +y) at rotation 0. */
const ART_FACING = Math.PI / 2;

const DEPTH_FLOOR = -3;
const DEPTH_BLOOD = -2;
const DEPTH_DARK = 10;
const DEPTH_HUD = 20;

const ASSETS = [
  'player', 'shambler', 'runner', 'brute', 'bloater', 'screamer',
  'wpn_pistol', 'wpn_smg', 'wpn_shotgun', 'wpn_machinegun', 'wpn_minigun',
  'wpn_rpg', 'wpn_katana', 'wpn_bat', 'wpn_chainsaw',
  'crate', 'ammo', 'muzzle', 'explosion', 'rocket', 'blood',
  'floor', 'wall', 'door_closed', 'door_open',
] as const;

interface SpriteItem {
  id: number;
  x: number;
  y: number;
  texture: string;
  height: number; // display height in px, aspect preserved
  rotation: number;
  visible: boolean;
  tintFill?: number; // solid flash colour (hit/telegraph)
  tint?: number;
}

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private loop = new FixedLoop(SIM_DT);
  private inputCollector!: InputCollector;
  private playerSprite!: Phaser.GameObjects.Image;
  private meleeArc!: Phaser.GameObjects.Arc;
  private doorSprites: Phaser.GameObjects.Image[] = [];
  private bulletShapes = new Map<number, Phaser.GameObjects.Arc>();
  private rocketSprites = new Map<number, Phaser.GameObjects.Image>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  private lootSprites = new Map<number, Phaser.GameObjects.Image>();
  private bloodDecals: Phaser.GameObjects.Image[] = [];
  private explosiveBullets = new Map<number, { x: number; y: number }>();
  private prevPlayerPos = { x: 0, y: 0 };
  private darkRT!: Phaser.GameObjects.RenderTexture;
  private lightG!: Phaser.GameObjects.Graphics;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private weaponHud!: Phaser.GameObjects.Text;
  private weaponIcon!: Phaser.GameObjects.Image;
  private bossBarBack!: Phaser.GameObjects.Rectangle;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private bossLabel!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;

  constructor() {
    super('game');
  }

  preload(): void {
    for (const key of ASSETS) this.load.image(key, `/assets/${key}.png`);
  }

  create(): void {
    const map = buildMap();
    this.state = createGameState(map.walls, map.spawnZones, map.doors, map.playerStart);

    // Debug/playtest: ?wave=N jumps straight to wave N with a short countdown;
    // ?zoo=1 lines up one of every enemy type for sprite inspection.
    const qs = new URLSearchParams(window.location.search);
    const debugWave = Number(qs.get('wave'));
    if (debugWave > 0) {
      this.state.wave.index = debugWave;
      this.state.wave.timer = 0.8;
    }
    if (qs.get('zoo')) {
      const types = ['shambler', 'runner', 'brute', 'bloater', 'screamer'] as const;
      types.forEach((t, i) => spawnEnemy(this.state, t, { x: 180 + i * 70, y: 160 }));
      this.state.wave.timer = 9999; // hold the wave so the lineup stays put
    }

    // Floor + walls from tiling textures; doors as switchable sprites.
    this.add.tileSprite(480, 270, 960, 540, 'floor').setTileScale(0.25).setDepth(DEPTH_FLOOR);
    for (const w of this.state.walls) {
      this.add.tileSprite(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 'wall').setTileScale(0.09375);
    }
    this.doorSprites = this.state.doors.map((d) => {
      const img = this.add.image(d.x + d.w / 2, d.y + d.h / 2, 'door_closed');
      img.setDisplaySize(d.w, d.h);
      return img;
    });

    this.meleeArc = this.add.circle(0, 0, 60, COLORS.melee, 0.25).setVisible(false);
    this.playerSprite = this.add.image(0, 0, 'player');
    this.setSpriteHeight(this.playerSprite, PLAYER_RADIUS * 3.6);
    this.inputCollector = new InputCollector(this);

    // Darkness overlay: fill a render texture, erase the flashlight cone out of it.
    // (RenderTexture.erase works identically on WebGL and Canvas; geometry-mask
    // invertAlpha silently fails on the Canvas renderer.)
    this.lightG = this.make.graphics({}, false);
    this.darkRT = this.add.renderTexture(0, 0, 960, 540).setOrigin(0, 0).setDepth(DEPTH_DARK);

    // Weapon switching.
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const p = this.state.player;
      if (ev.key >= '1' && ev.key <= '9') {
        const idx = Number(ev.key) - 1;
        if (idx < p.owned.length) equipWeapon(p, p.owned[idx]);
      } else if (ev.key === 'q' || ev.key === 'Q') cycleWeapon(p, -1);
      else if (ev.key === 'e' || ev.key === 'E') cycleWeapon(p, 1);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cycleWeapon(this.state.player, dy > 0 ? 1 : -1);
    });

    // HUD.
    this.add.rectangle(16, 16, 200, 14, COLORS.hpBack).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD);
    this.hpFill = this.add.rectangle(16, 16, 200, 14, COLORS.hpFill).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD);
    this.hud = this.add
      .text(16, 36, '', { fontFamily: 'monospace', fontSize: '14px', color: '#cfd2d6' })
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);
    this.weaponIcon = this.add
      .image(34, 500, 'wpn_pistol')
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);
    this.setSpriteHeight(this.weaponIcon, 34);
    this.weaponHud = this.add
      .text(58, 492, '', { fontFamily: 'monospace', fontSize: '14px', color: '#f2c14e' })
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);

    this.bossBarBack = this.add.rectangle(480, 26, 380, 12, COLORS.bossBarBack).setScrollFactor(0).setDepth(DEPTH_HUD).setVisible(false);
    this.bossBarFill = this.add
      .rectangle(480 - 190, 26, 380, 12, COLORS.bossBarFill)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD)
      .setVisible(false);
    this.bossLabel = this.add
      .text(480, 38, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e8b0bd' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD)
      .setVisible(false);
  }

  update(_time: number, deltaMs: number): void {
    const input = this.inputCollector.sample();
    this.prevPlayerPos = { x: this.state.player.pos.x, y: this.state.player.pos.y };
    const bulletsBefore = this.state.nextBulletId;

    const alpha = this.loop.tick(deltaMs / 1000, () => stepSim(this.state, input, SIM_DT));

    if (this.state.nextBulletId > bulletsBefore && WEAPONS[this.state.player.weapon].kind !== 'melee') {
      this.cameras.main.shake(40, 0.0008);
      const p = this.state.player;
      const fx = p.pos.x + Math.cos(p.aimAngle) * 28;
      const fy = p.pos.y + Math.sin(p.aimAngle) * 28;
      const flash = this.add.image(fx, fy, 'muzzle').setRotation(p.aimAngle);
      this.setSpriteHeight(flash, 30);
      this.time.delayedCall(45, () => flash.destroy());
    }
    this.renderState(alpha);
  }

  private renderState(alpha: number): void {
    const p = this.state.player;
    const x = lerp(this.prevPlayerPos.x, p.pos.x, alpha);
    const y = lerp(this.prevPlayerPos.y, p.pos.y, alpha);
    this.playerSprite.setPosition(x, y).setRotation(p.aimAngle - ART_FACING);
    if (p.dash.timeLeft > 0) this.playerSprite.setTint(COLORS.dashTint);
    else this.playerSprite.clearTint();

    // Flashlight cone + ambient glow: repaint the darkness, erase the lit shapes.
    this.lightG.clear();
    this.lightG.fillStyle(0xffffff, 1);
    this.lightG.beginPath();
    this.lightG.slice(x, y, FLASHLIGHT_RANGE, p.aimAngle - FLASHLIGHT_HALF_ANGLE, p.aimAngle + FLASHLIGHT_HALF_ANGLE, false);
    this.lightG.fillPath();
    this.lightG.fillCircle(x, y, AMBIENT_RADIUS);
    this.darkRT.clear();
    this.darkRT.fill(0x05060a, 0.94);
    this.darkRT.erase(this.lightG);

    this.state.doors.forEach((d, i) => {
      this.doorSprites[i]
        .setTexture(d.open ? 'door_open' : 'door_closed')
        .setDisplaySize(d.w, d.h)
        .setAlpha(d.open ? 0.45 : 1);
    });

    const solids = mapSolids(this.state);
    const eye = { x, y };

    // Melee swing wedge.
    const def = WEAPONS[p.weapon];
    if (def.kind === 'melee' && p.meleeSwing > 0) {
      const halfArcDeg = ((def.arc ?? 0) * 180) / Math.PI;
      const aimDeg = (p.aimAngle * 180) / Math.PI;
      this.meleeArc
        .setPosition(x, y)
        .setRadius(def.range ?? 40)
        .setStartAngle(aimDeg - halfArcDeg)
        .setEndAngle(aimDeg + halfArcDeg)
        .setVisible(true);
    } else {
      this.meleeArc.setVisible(false);
    }

    this.trackExplosions();

    // Plain bullets as glowing dots (player amber, hostile sickly green); rockets as sprites.
    this.syncCircles(
      this.bulletShapes,
      this.state.bullets
        .filter((b) => b.splashRadius === 0)
        .map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, r: b.hostile ? 4 : 3, color: b.hostile ? COLORS.hostileBullet : COLORS.bullet })),
    );
    this.syncSprites(
      this.rocketSprites,
      this.state.bullets
        .filter((b) => b.splashRadius > 0)
        .map((b) => ({
          id: b.id,
          x: b.pos.x,
          y: b.pos.y,
          texture: 'rocket',
          height: 26,
          rotation: Math.atan2(b.vel.y, b.vel.x) - ART_FACING,
          visible: true,
        })),
    );

    // Enemies: sprite per type, facing their motion, hidden without line of sight.
    this.syncSprites(
      this.enemySprites,
      this.state.enemies.map((e) => ({
        id: e.id,
        x: e.pos.x,
        y: e.pos.y,
        texture: e.type,
        height: ZOMBIES[e.type].radius * 3.4,
        rotation: (e.vel.x || e.vel.y) ? Math.atan2(e.vel.y, e.vel.x) - ART_FACING : 0,
        visible: segmentClear(eye, e.pos, solids),
        tintFill: e.boss && e.boss.telegraph > 0 ? COLORS.telegraphTint : e.hitFlash > 0 ? 0xffffff : undefined,
      })),
      (lastX, lastY, id) => this.spawnBlood(lastX, lastY, id),
    );

    // Loot: weapon drops show the actual weapon, ammo shows the ammo box.
    this.syncSprites(
      this.lootSprites,
      this.state.loot.map((l) => ({
        id: l.id,
        x: l.pos.x,
        y: l.pos.y,
        texture: l.kind === 'weapon' ? `wpn_${l.weapon}` : 'ammo',
        height: 26,
        rotation: 0,
        visible: segmentClear(eye, l.pos, solids),
      })),
    );

    this.hpFill.width = 200 * Math.max(0, p.hp / PLAYER_MAX_HP);
    const w = this.state.wave;
    const status = w.phase === 'intermission' ? `next in ${Math.ceil(w.timer)}s` : `${this.state.enemies.length} left`;
    this.hud.setText(`WAVE ${w.index}  ·  ${status}  ·  kills ${w.killsThisWave}`);

    const ammo = def.startAmmo === undefined ? '∞' : String(Math.ceil(p.ammo[def.id] ?? 0));
    const slots = p.owned.map((id, i) => `${i + 1}:${WEAPONS[id].name}${id === p.weapon ? '*' : ''}`).join('  ');
    this.weaponIcon.setTexture(`wpn_${p.weapon}`);
    this.setSpriteHeight(this.weaponIcon, 34);
    this.weaponHud.setText(`${def.name}  [${ammo}]     ${slots}`);

    const boss = this.state.enemies.find((e) => e.boss);
    if (boss) {
      const bdef = ZOMBIES[boss.type];
      this.bossBarFill.width = 380 * Math.max(0, boss.hp / bdef.hp);
      this.bossLabel.setText(bdef.name.toUpperCase());
      this.bossBarBack.setVisible(true);
      this.bossBarFill.setVisible(true);
      this.bossLabel.setVisible(true);
    } else if (this.bossBarBack.visible) {
      this.bossBarBack.setVisible(false);
      this.bossBarFill.setVisible(false);
      this.bossLabel.setVisible(false);
    }

    if (this.state.gameOver && !this.overlay) {
      this.overlay = this.add
        .text(480, 270, 'YOU DIED', { fontFamily: 'monospace', fontSize: '48px', color: '#c23b3b' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_HUD);
    }
  }

  /** Scale an image to a display height, preserving the source aspect ratio. */
  private setSpriteHeight(img: Phaser.GameObjects.Image, height: number): void {
    const src = img.texture.getSourceImage();
    img.setDisplaySize((src.width / src.height) * height, height);
  }

  private spawnBlood(x: number, y: number, id: number): void {
    const blood = this.add
      .image(x, y, 'blood')
      .setDepth(DEPTH_BLOOD)
      .setAlpha(0.75)
      .setRotation(((id * 137) % 360) * (Math.PI / 180));
    this.setSpriteHeight(blood, 34 + ((id * 53) % 28));
    this.bloodDecals.push(blood);
    if (this.bloodDecals.length > 80) this.bloodDecals.shift()!.destroy();
  }

  private trackExplosions(): void {
    const present = new Set<number>();
    for (const b of this.state.bullets) {
      if (b.splashRadius > 0) {
        present.add(b.id);
        this.explosiveBullets.set(b.id, { x: b.pos.x, y: b.pos.y });
      }
    }
    for (const [id, pos] of this.explosiveBullets) {
      if (!present.has(id)) {
        const boom = this.add.image(pos.x, pos.y, 'explosion').setAlpha(0.95);
        this.setSpriteHeight(boom, 110);
        this.tweens.add({ targets: boom, alpha: 0, scale: boom.scale * 1.6, duration: 260, onComplete: () => boom.destroy() });
        this.cameras.main.shake(120, 0.006);
        this.explosiveBullets.delete(id);
      }
    }
  }

  /** Diffing renderer for circles (bullet tracers). */
  private syncCircles(
    pool: Map<number, Phaser.GameObjects.Arc>,
    items: { id: number; x: number; y: number; r: number; color: number }[],
  ): void {
    const seen = new Set<number>();
    for (const it of items) {
      seen.add(it.id);
      let shape = pool.get(it.id);
      if (!shape) {
        shape = this.add.circle(it.x, it.y, it.r, it.color);
        pool.set(it.id, shape);
      }
      shape.setPosition(it.x, it.y).setFillStyle(it.color);
    }
    for (const [id, shape] of pool) {
      if (!seen.has(id)) {
        shape.destroy();
        pool.delete(id);
      }
    }
  }

  /** Diffing renderer for textured sprites; onRemove fires at the entity's last position (blood etc.). */
  private syncSprites(
    pool: Map<number, Phaser.GameObjects.Image>,
    items: SpriteItem[],
    onRemove?: (lastX: number, lastY: number, id: number) => void,
  ): void {
    const seen = new Set<number>();
    for (const it of items) {
      seen.add(it.id);
      let img = pool.get(it.id);
      if (!img) {
        img = this.add.image(it.x, it.y, it.texture);
        this.setSpriteHeight(img, it.height);
        pool.set(it.id, img);
      }
      img.setPosition(it.x, it.y).setRotation(it.rotation).setVisible(it.visible);
      if (it.tintFill !== undefined) img.setTintFill(it.tintFill);
      else if (it.tint !== undefined) img.setTint(it.tint);
      else img.clearTint();
    }
    for (const [id, img] of pool) {
      if (!seen.has(id)) {
        onRemove?.(img.x, img.y, id);
        img.destroy();
        pool.delete(id);
      }
    }
  }
}
