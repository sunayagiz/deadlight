import Phaser from 'phaser';
import {
  AMBIENT_RADIUS,
  EXTRACT_HOLD,
  EXTRACT_RADIUS,
  EXTRACTION_WAVE,
  FLASHLIGHT_HALF_ANGLE,
  FLASHLIGHT_RANGE,
  INTERACT_RADIUS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  SIM_DT,
} from '../config';
import { AFFIXES } from '../sim/affix';
import { interactCost, interactReady, nearestBuyable } from '../sim/cod';
import { ZOMBIES, spawnEnemy } from '../sim/enemies';
import { buildMap, mapSolids } from '../sim/map';
import { PERKS, effectiveMaxHp, type PerkId } from '../sim/perks';
import { SHOP } from '../sim/shop';
import { createGameState } from '../sim/state';
import { stepSim } from '../sim/step';
import { lerp } from '../sim/vec';
import { segmentClear } from '../sim/vision';
import { updateAim } from '../sim/weapons';
import { updateDash, updateMovement } from '../sim/movement';
import { WEAPONS } from '../sim/weapons';
import { isUp, type Door, type EnemyType, type GameState, type PlayerInput, type PlayerState } from '../sim/types';

/** Static base for runtime asset URLs so the build works under any deploy path. */
const ASSET_BASE = import.meta.env.BASE_URL;
import type { GuestNet, HostNet } from '../net/net';
import { applySnapshot, snapshot } from '../net/protocol';
import { getSession } from '../net/session';
import { InputCollector } from './input';
import { FixedLoop } from './loop';

/** Per-slot accent so teammates are distinguishable. */
const TEAM_TINT = [0xffffff, 0x6fb8ff, 0xffd45e, 0x8affa0];

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

/** All character art faces east (+x) at rotation 0 — same as aimAngle 0. */
const ART_FACING = 0;

/** COD interactable marker colours + floating power-up icon styles. */
const KIND_COLOR: Record<string, number> = { mysterybox: 0xffcf4e, packapunch: 0xb060ff, wallbuy: 0x4ec6ff, power: 0xff5a5a };
const PU_STYLE: Record<string, { c: number; s: string }> = {
  maxammo: { c: 0x4ec6ff, s: 'MAX' },
  instakill: { c: 0xff5a5a, s: 'INSTA' },
  nuke: { c: 0xff8a3a, s: 'NUKE' },
  doublepoints: { c: 0xffcf4e, s: 'x2' },
  firesale: { c: 0x8affa0, s: 'SALE' },
};

const DEPTH_FLOOR = -3;
const DEPTH_BLOOD = -2;
const DEPTH_DARK = 10;
const DEPTH_HUD = 20;

const ASSETS = [
  'player', 'shambler', 'runner', 'brute', 'bloater', 'screamer', 'hound',
  'spitter', 'boomer', 'stalker', 'armored',
  'wpn_pistol', 'wpn_smg', 'wpn_shotgun', 'wpn_machinegun', 'wpn_minigun',
  'wpn_rpg', 'wpn_katana', 'wpn_bat', 'wpn_chainsaw', 'wpn_raygun',
  'crate', 'ammo', 'health', 'muzzle', 'explosion', 'rocket', 'blood',
  'floor', 'wall', 'door_closed', 'door_open',
  'light_glow', 'light_cone',
] as const;

const SOUNDS = [
  'shot', 'smg', 'shotgun', 'mg', 'minigun', 'rpglaunch',
  'explosion', 'squelch', 'whoosh', 'hurt', 'door', 'heartbeat',
  'growl', 'snarl', 'baby', 'knock', 'creak',
] as const;

/** Per-weapon fire sound. */
const GUN_SOUND: Record<string, (typeof SOUNDS)[number]> = {
  pistol: 'shot',
  smg: 'smg',
  shotgun: 'shotgun',
  machinegun: 'mg',
  minigun: 'minigun',
  rpg: 'rpglaunch',
};

/** View-only room decor: subtle floor tint per area so rooms feel distinct. */
const ROOM_TINTS: { x: number; y: number; w: number; h: number; color: number; alpha: number }[] = [
  { x: 240, y: 240, w: 1080, h: 960, color: 0x2a3550, alpha: 0.13 }, // parking — cold blue
  { x: 2400, y: 240, w: 3960, h: 960, color: 0x403018, alpha: 0.1 }, // grand hall — warm
  { x: 7320, y: 240, w: 1080, h: 960, color: 0x33291f, alpha: 0.13 }, // warehouse — cardboard
  { x: 240, y: 1380, w: 2640, h: 1140, color: 0x1f3a2a, alpha: 0.12 }, // west wing — sickly green
  { x: 5760, y: 1380, w: 2640, h: 1140, color: 0x203038, alpha: 0.12 }, // east wing — clinical
  { x: 480, y: 2760, w: 7920, h: 420, color: 0x101c16, alpha: 0.34 }, // sewer — rotten dark
  { x: 480, y: 3120, w: 1200, h: 600, color: 0x2c2318, alpha: 0.24 }, // cave collapse — earth
  { x: 6960, y: 3120, w: 1440, h: 600, color: 0x3a2f16, alpha: 0.2 }, // generator — amber
];

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
  wobble?: number; // walk-sway amplitude in radians (0/undefined = none)
}

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private loop = new FixedLoop(SIM_DT);
  private inputCollector!: InputCollector;
  private role: 'solo' | 'host' | 'guest' = 'solo';
  private localIndex = 0;
  private hostNet?: HostNet;
  private guestNet?: GuestNet;
  private bcastAccum = 0; // host: throttle snapshots to ~30 Hz
  private predicted?: PlayerState; // guest: locally-predicted own player (kills input lag)
  private camTarget!: Phaser.GameObjects.Image; // invisible; camera follows it
  private playerBodies = new Map<number, Phaser.GameObjects.Image>();
  private playerWeapons = new Map<number, Phaser.GameObjects.Image>();
  private reviveRings = new Map<number, Phaser.GameObjects.Arc>();
  private prevLocalFireCd = 0;
  private meleeArc!: Phaser.GameObjects.Arc;
  private doorSprites: Phaser.GameObjects.Image[] = [];
  private bulletShapes = new Map<number, Phaser.GameObjects.Arc>();
  private rocketSprites = new Map<number, Phaser.GameObjects.Image>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  private affixAuras = new Map<number, Phaser.GameObjects.Arc>(); // faint elite glow behind affixed enemies
  private volatileIds = new Set<number>(); // volatile elites, so their death fires the boomer blast fx
  private lootSprites = new Map<number, Phaser.GameObjects.Image>();
  private bloodDecals: Phaser.GameObjects.Image[] = [];
  private explosiveBullets = new Map<number, { x: number; y: number }>();
  private prevPlayerPos = { x: 0, y: 0 };
  private darkRT!: Phaser.GameObjects.RenderTexture;
  private coneImg!: Phaser.GameObjects.Image; // erase sources, never displayed
  private glowImg!: Phaser.GameObjects.Image;
  private lightPulses: { x: number; y: number; life: number; max: number; size: number }[] = [];
  private recoil = 0;
  private dashGhostCd = 0;
  private hurtFx = 0;
  private hurtOverlay!: Phaser.GameObjects.Rectangle;
  private prevHp = 0;
  private prevWavePhase = '';
  private prevOpenDoors = 0;
  private prevMeleeSwing = 0;
  private prevDashLeft = 0;
  private heartbeat?: Phaser.Sound.BaseSound;
  private growlCd = 2;
  private ambientCd = 8;
  private minimapG!: Phaser.GameObjects.Graphics; // static part: walls/doors/fog
  private minimapDot!: Phaser.GameObjects.Graphics; // per-frame player dot
  private explored = new Set<number>(); // fog-of-war cells the player has seen
  private minimapDirty = true;
  private mapW = 960;
  private mapH = 540;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private weaponHud!: Phaser.GameObjects.Text;
  private weaponIcon!: Phaser.GameObjects.Image;
  private bossBarBack!: Phaser.GameObjects.Rectangle;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private bossLabel!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;
  private cashHud!: Phaser.GameObjects.Text;
  // guest render smoothing (entity interpolation) — targets updated per snapshot,
  // render positions eased toward them so 30 Hz snapshots look like 60 fps motion.
  private smoothEnemy = new Map<number, { x: number; y: number }>();
  private smoothRemote = new Map<number, { x: number; y: number }>();
  // reusable circle pool (bullet tracers + blood particles) — kills GC churn.
  private circlePool: Phaser.GameObjects.Arc[] = [];
  // between-wave shop (Phaser-native, host-authoritative buys via InputCollector)
  private shopRoot!: Phaser.GameObjects.Container;
  private shopButtons: { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; item: number }[] = [];
  // screen-space hit rects (manual hit-testing — Phaser input on a scrollFactor-0
  // container mis-tests once the camera scrolls, so we test pointer.x/y ourselves)
  private shopHit: { x0: number; y0: number; x1: number; y1: number; i: number }[] = [];
  private draftHit: { x0: number; y0: number; x1: number; y1: number; i: number }[] = [];
  // perk draft overlay
  private draftRoot!: Phaser.GameObjects.Container;
  private draftCards: { bg: Phaser.GameObjects.Rectangle; title: Phaser.GameObjects.Text; body: Phaser.GameObjects.Text }[] = [];
  private pointerOverUI = false; // true while the cursor is over a shop/draft button (suppress fire)
  // extraction beacon (world-space) + on-screen escape bar
  private extractBeacon!: Phaser.GameObjects.Arc;
  private extractArrow!: Phaser.GameObjects.Triangle;
  private extractBarBack!: Phaser.GameObjects.Rectangle;
  private extractBarFill!: Phaser.GameObjects.Rectangle;
  private extractLabel!: Phaser.GameObjects.Text;
  // COD layer render
  private codMarkers: { icon: Phaser.GameObjects.Star; label: Phaser.GameObjects.Text }[] = [];
  private codPrompt!: Phaser.GameObjects.Text; // screen-space "[F] buy …" line
  private codNotice!: Phaser.GameObjects.Text; // announcer banner (MAX AMMO, POWER ON, …)
  private codStatus!: Phaser.GameObjects.Text; // active power-up timers
  private powerupNodes = new Map<number, { g: Phaser.GameObjects.Star; t: Phaser.GameObjects.Text }>();
  private boxRevealIcon!: Phaser.GameObjects.Image;

  constructor() {
    super('game');
  }

  preload(): void {
    // Only images block first render; audio is loaded in the background after
    // create() so a slow/stalled audio decode can never keep the game black.
    for (const key of ASSETS) this.load.image(key, `${ASSET_BASE}assets/${key}.png`);
  }

  /** Load all sound assets in the background; play the music bed once ready. */
  private loadAudioDeferred(): void {
    for (const key of SOUNDS) this.load.audio(key, `${ASSET_BASE}assets/audio/${key}.wav`);
    this.load.audio('music', `${ASSET_BASE}assets/audio/music.wav`);
    const startMusic = () => {
      if (this.sound.locked || !this.cache.audio.exists('music') || this.sound.get('music')) return;
      this.sound.play('music', { loop: true, volume: 0.35 });
    };
    this.load.once(Phaser.Loader.Events.COMPLETE, startMusic);
    this.sound.once(Phaser.Sound.Events.UNLOCKED, startMusic);
    this.load.start();
  }

  private sfx(key: (typeof SOUNDS)[number], volume = 0.5, rate = 1): void {
    if (this.cache.audio.exists(key)) this.sound.play(key, { volume, rate }); // skip until loaded
  }

  create(): void {
    const map = buildMap();
    const session = getSession();
    this.role = session.role;
    if (session.role === 'host') {
      this.hostNet = session.net;
      this.localIndex = 0;
    } else if (session.role === 'guest') {
      this.guestNet = session.net;
      this.localIndex = session.you;
    }
    const numPlayers = session.role === 'host' ? session.players : session.role === 'guest' ? 4 : 1;
    this.state = createGameState(
      map.walls,
      map.spawnZones,
      map.doors,
      map.playerStart,
      { width: map.width, height: map.height },
      numPlayers,
      map.extractionPoint,
      map.interactables,
    );
    if (session.role === 'guest') this.state.players.forEach((p, i) => (p.alive = i === this.localIndex));

    // Debug/playtest: ?wave=N jumps straight to wave N with a short countdown;
    // ?zoo=1 lines up one of every enemy type; ?at=x,y teleports the start.
    const qs = new URLSearchParams(window.location.search);
    const at = (qs.get('at') ?? '').split(',').map(Number);
    if (at.length === 2 && at.every(Number.isFinite)) {
      this.state.player.pos = { x: at[0], y: at[1] };
    }
    const debugWave = Number(qs.get('wave'));
    if (debugWave > 0) {
      this.state.wave.index = debugWave;
      this.state.wave.timer = 0.8;
    }
    const wpn = qs.get('wpn');
    if (wpn && wpn in WEAPONS) {
      const id = wpn as keyof typeof WEAPONS;
      if (!this.state.player.owned.includes(id)) this.state.player.owned.push(id);
      this.state.player.weapon = id;
      this.state.player.ammo[id] = 999;
    }
    if (qs.get('zoo')) {
      const types = ['shambler', 'runner', 'brute', 'bloater', 'screamer', 'hound', 'spitter', 'boomer', 'stalker', 'armored'] as const;
      types.forEach((t, i) =>
        spawnEnemy(this.state, t, { x: map.playerStart.x - 420 + i * 95, y: map.playerStart.y - 200 }),
      );
      this.state.wave.phase = 'active'; // active so no shop overlay hides the lineup
      this.state.wave.spawnQueue = [];
    }
    // ?ext jumps to the final escape wave next to the exit; ?cash/?perk seed the shop/draft.
    if (qs.has('ext')) {
      this.state.wave.index = EXTRACTION_WAVE;
      this.state.wave.timer = 0.5;
      this.state.doors.forEach((d) => (d.open = true));
      this.state.player.pos = { x: map.extractionPoint.x - 260, y: map.extractionPoint.y };
    }
    const debugCash = Number(qs.get('cash'));
    if (debugCash > 0) this.state.cash = debugCash;
    if (qs.has('perk')) this.state.perkDraft = ['damage', 'firerate', 'vigor'];
    // ?cod: drop the player at the Mystery Box with cash, some power-ups, and a hound
    if (qs.has('cod')) {
      this.state.cash = 9999;
      const box = this.state.interactables.find((it) => it.kind === 'mysterybox');
      if (box) this.state.player.pos = { x: box.x - 20, y: box.y + 60 };
      const kinds = ['maxammo', 'instakill', 'nuke', 'doublepoints', 'firesale'] as const;
      kinds.forEach((k, i) =>
        this.state.powerups.push({ id: this.state.nextPowerUpId++, kind: k, x: this.state.player.pos.x - 120 + i * 60, y: this.state.player.pos.y - 90, ttl: 999 }),
      );
      spawnEnemy(this.state, 'hound', { x: this.state.player.pos.x + 140, y: this.state.player.pos.y });
      // active phase with a lone hound holds the wave open (no shop overlay)
      this.state.wave.phase = 'active';
      this.state.wave.spawnQueue = [];
    }

    this.mapW = map.width;
    this.mapH = map.height;

    // Floor + per-room tint patches + walls from tiling textures; doors as switchable sprites.
    this.add
      .tileSprite(map.width / 2, map.height / 2, map.width, map.height, 'floor')
      .setTileScale(0.25)
      .setDepth(DEPTH_FLOOR);
    for (const r of ROOM_TINTS) {
      this.add
        .rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, r.color, r.alpha)
        .setDepth(DEPTH_FLOOR + 0.1);
    }
    const edges = this.add.graphics().setDepth(DEPTH_FLOOR + 0.5);
    for (const w of this.state.walls) {
      this.add.tileSprite(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 'wall').setTileScale(0.13);
      // crisp boundary: dark outer stroke + lit inner top/left bevel, so walls
      // read as solid edges even at the dim edge of the flashlight.
      edges.lineStyle(3, 0x090a0e, 0.95);
      edges.strokeRect(w.x, w.y, w.w, w.h);
      edges.lineStyle(2, 0x878f9f, 0.75);
      edges.beginPath();
      edges.moveTo(w.x + 1.5, w.y + w.h - 1.5);
      edges.lineTo(w.x + 1.5, w.y + 1.5);
      edges.lineTo(w.x + w.w - 1.5, w.y + 1.5);
      edges.strokePath();
    }
    this.doorSprites = this.state.doors.map((d) => {
      const img = this.add.image(d.x + d.w / 2, d.y + d.h / 2, 'door_closed');
      img.setDisplaySize(d.w, d.h);
      return img;
    });

    this.meleeArc = this.add.circle(0, 0, 60, COLORS.melee, 0.25).setVisible(false);
    // Player bodies/weapons are created per slot on demand in renderState.
    this.camTarget = this.add.image(map.playerStart.x, map.playerStart.y, 'player').setVisible(false);
    this.inputCollector = new InputCollector(this);

    // Darkness overlay: fill a screen-sized render texture pinned to the camera,
    // erase soft light textures out of it (in screen space). Screen-sized + camera
    // -relative scales to any map size. (RenderTexture.erase works identically on
    // WebGL and Canvas; geometry-mask invertAlpha silently fails on Canvas.)
    this.darkRT = this.add
      .renderTexture(0, 0, 960, 540)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_DARK);
    this.coneImg = this.make.image({ key: 'light_cone', add: false }).setOrigin(0.028, 0.5);
    this.glowImg = this.make.image({ key: 'light_glow', add: false });

    // Camera: follow the player across the building (lerp + deadzone per the
    // Phaser top-down recipe; roundPixels kills sub-pixel shimmer).
    this.cameras.main.setBounds(0, 0, map.width, map.height);
    this.cameras.main.startFollow(this.camTarget, true, 0.1, 0.1);
    this.cameras.main.setDeadzone(120, 80);
    // Weapon switching is handled inside InputCollector (netcode-safe via PlayerInput).

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
    this.cashHud = this.add
      .text(16, 470, '', { fontFamily: 'monospace', fontSize: '15px', color: '#7dffa0', fontStyle: 'bold' })
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

    // Damage vignette (flashes red as you take hits).
    this.hurtOverlay = this.add
      .rectangle(480, 270, 960, 540, 0x8a0f14, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD - 1);
    this.prevHp = this.local().hp;
    this.prevWavePhase = this.state.wave.phase;

    // Minimap (top-right): fogged — only explored areas show; player dot on top.
    this.minimapG = this.add.graphics().setScrollFactor(0).setDepth(DEPTH_HUD);
    this.minimapDot = this.add.graphics().setScrollFactor(0).setDepth(DEPTH_HUD);
    this.explored.clear(); // fresh fog on (re)start
    this.minimapDirty = true;

    // Extraction beacon (world space) + off-screen arrow + on-screen escape bar.
    // Placed below the boss bar (the final wave is also a boss wave) so the two never collide.
    this.extractBeacon = this.add.circle(0, 0, EXTRACT_RADIUS, 0x2effa0, 0.08).setStrokeStyle(3, 0x38ffb0, 0.8).setDepth(DEPTH_FLOOR + 0.6).setVisible(false);
    this.extractArrow = this.add.triangle(480, 118, 0, 16, 22, 16, 11, 0, 0x38ffb0, 0.9).setScrollFactor(0).setDepth(DEPTH_HUD).setVisible(false);
    this.extractBarBack = this.add.rectangle(480, 96, 360, 14, 0x0c221a).setScrollFactor(0).setDepth(DEPTH_HUD).setVisible(false);
    this.extractBarFill = this.add.rectangle(480 - 180, 96, 360, 14, 0x38ffb0).setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH_HUD).setVisible(false);
    this.extractLabel = this.add.text(480, 74, '', { fontFamily: 'monospace', fontSize: '14px', color: '#8affbf', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_HUD).setVisible(false);

    this.buildShopUI();
    this.buildDraftUI();
    this.buildCodRender();

    // All sound (SFX + music) loads in the background now that the scene is up.
    this.loadAudioDeferred();
    // Robust autoplay unlock: the first click/key resumes a suspended AudioContext
    // (some browsers hold it suspended even after the lobby gesture).
    const unlock = (): void => {
      const anySound = this.sound as unknown as { context?: AudioContext; unlock?: () => void };
      if (this.sound.locked && anySound.unlock) anySound.unlock();
      if (anySound.context && anySound.context.state === 'suspended') void anySound.context.resume();
    };
    this.input.once('pointerdown', unlock);
    this.input.keyboard!.once('keydown', unlock);

    // R restarts after death.
    this.input.keyboard!.on('keydown-R', () => {
      if (this.state.gameOver) this.scene.restart();
    });

    // Shop/perk clicks: hit-test the pointer in SCREEN space ourselves. Phaser's
    // input mis-tests a scrollFactor-0 container once the camera scrolls, so the
    // buttons never register — this path is camera-independent and reliable.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.handleUiClick(p.x, p.y));
  }

  private static hit(px: number, py: number, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1;
  }

  /** Route a click to a shop row or a perk card (screen-space). */
  private handleUiClick(px: number, py: number): void {
    if (this.state.gameOver) return;
    if (this.state.perkDraft) {
      for (const c of this.draftHit) if (GameScene.hit(px, py, c)) { this.inputCollector.requestPerk(c.i); return; }
      return;
    }
    if (this.state.wave.phase === 'intermission') {
      for (const c of this.shopHit) if (GameScene.hit(px, py, c)) { this.inputCollector.requestBuy(c.i); return; }
    }
  }

  // ── circle pool (bullets + blood particles) ────────────────────────────────
  private getCircle(x: number, y: number, r: number, color: number, alpha: number, depth: number): Phaser.GameObjects.Arc {
    const c = this.circlePool.pop() ?? this.add.circle(0, 0, 1, 0xffffff);
    // reset object alpha (a prior tween may have faded it) — translucency comes from fillStyle
    c.setPosition(x, y).setRadius(r).setFillStyle(color, alpha).setAlpha(1).setDepth(depth).setScale(1).setActive(true).setVisible(true);
    return c;
  }
  private freeCircle(c: Phaser.GameObjects.Arc): void {
    c.setVisible(false).setActive(false);
    if (this.circlePool.length < 256) this.circlePool.push(c);
    else c.destroy();
  }

  /**
   * Guest render smoothing: ease a stored position toward the latest snapshot
   * target so 30 Hz authoritative updates look like 60 fps motion. Big jumps
   * (spawns/teleports) snap instantly so nothing slides across the map.
   */
  private smooth(map: Map<number, { x: number; y: number }>, id: number, tx: number, ty: number, dt: number): { x: number; y: number } {
    let s = map.get(id);
    if (!s || (tx - s.x) ** 2 + (ty - s.y) ** 2 > 260 * 260) {
      s = { x: tx, y: ty };
      map.set(id, s);
      return s;
    }
    const k = 1 - Math.exp(-dt / 0.05); // ~100 ms settle; kills the 30 Hz stutter
    s.x += (tx - s.x) * k;
    s.y += (ty - s.y) * k;
    return s;
  }

  // ── between-wave shop (interactive HUD) ─────────────────────────────────────
  private buildShopUI(): void {
    const w = 300;
    const rowH = 30;
    const x0 = 480 - w / 2;
    const y0 = 300;
    this.shopRoot = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD + 2).setVisible(false);
    const panel = this.add.rectangle(480, y0 + (SHOP.length * rowH) / 2 + 6, w + 20, SHOP.length * rowH + 52, 0x06100b, 0.92).setStrokeStyle(1, 0x2b4a34);
    const title = this.add.text(480, y0 - 30, 'SHOP  ·  between waves', { fontFamily: 'monospace', fontSize: '14px', color: '#8fef9f' }).setOrigin(0.5);
    this.shopRoot.add([panel, title]);
    SHOP.forEach((item, i) => {
      const y = y0 + i * rowH;
      const bg = this.add.rectangle(480, y, w, rowH - 4, 0x101a12).setStrokeStyle(1, 0x233);
      const label = this.add.text(x0 + 8, y - 7, '', { fontFamily: 'monospace', fontSize: '13px', color: '#cfe8d4' });
      this.shopRoot.add([bg, label]);
      this.shopButtons.push({ bg, label, item: i });
      this.shopHit.push({ x0: 480 - w / 2, y0: y - rowH / 2, x1: 480 + w / 2, y1: y + rowH / 2, i });
    });
    const hint = this.add.text(480, y0 + SHOP.length * rowH + 6, 'click to buy', { fontFamily: 'monospace', fontSize: '11px', color: '#4d6b55' }).setOrigin(0.5);
    this.shopRoot.add(hint);
  }

  // ── perk draft overlay ──────────────────────────────────────────────────────
  private buildDraftUI(): void {
    this.draftRoot = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD + 3).setVisible(false);
    const dim = this.add.rectangle(480, 270, 960, 540, 0x02040a, 0.62);
    const title = this.add.text(480, 150, 'CHOOSE A PERK', { fontFamily: 'monospace', fontSize: '26px', color: '#ffd45e', fontStyle: 'bold' }).setOrigin(0.5);
    this.draftRoot.add([dim, title]);
    const cw = 220;
    const gap = 24;
    const total = 3 * cw + 2 * gap;
    const startX = 480 - total / 2;
    for (let i = 0; i < 3; i++) {
      const cx = startX + i * (cw + gap) + cw / 2;
      const bg = this.add.rectangle(cx, 300, cw, 170, 0x0c140f, 0.98).setStrokeStyle(2, 0x3ea45a);
      const t = this.add.text(cx, 250, '', { fontFamily: 'monospace', fontSize: '17px', color: '#cfe8d4', fontStyle: 'bold', align: 'center', wordWrap: { width: cw - 20 } }).setOrigin(0.5);
      const b = this.add.text(cx, 320, '', { fontFamily: 'monospace', fontSize: '13px', color: '#8fef9f', align: 'center', wordWrap: { width: cw - 24 } }).setOrigin(0.5);
      this.draftRoot.add([bg, t, b]);
      this.draftCards.push({ bg, title: t, body: b });
      this.draftHit.push({ x0: cx - cw / 2, y0: 300 - 85, x1: cx + cw / 2, y1: 300 + 85, i });
    }
  }

  // ── COD layer: interactables / power-ups / announcer ────────────────────────
  private buildCodRender(): void {
    for (const it of this.state.interactables) {
      const color = KIND_COLOR[it.kind] ?? 0xffffff;
      const icon = this.add.star(it.x, it.y, 4, 6, 15, color, 0.9).setDepth(DEPTH_FLOOR + 0.7);
      const label = this.add
        .text(it.x, it.y - 28, it.label.toUpperCase(), { fontFamily: 'monospace', fontSize: '12px', color: '#cfe8d4', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH_HUD - 2);
      this.codMarkers.push({ icon, label });
    }
    this.boxRevealIcon = this.add.image(0, 0, 'wpn_pistol').setDepth(DEPTH_HUD - 1).setVisible(false);
    this.codPrompt = this.add
      .text(480, 424, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffe08a', fontStyle: 'bold', backgroundColor: '#000a' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_HUD + 1).setPadding(7, 4, 7, 4).setVisible(false);
    this.codNotice = this.add
      .text(480, 120, '', { fontFamily: 'monospace', fontSize: '30px', color: '#ffcf4e', fontStyle: 'bold' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_HUD + 1).setVisible(false);
    this.codStatus = this.add
      .text(228, 16, '', { fontFamily: 'monospace', fontSize: '13px', color: '#8affbf', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(DEPTH_HUD);
  }

  private nearestPayDoor(p: PlayerState): Door | null {
    for (const d of this.state.doors) {
      if (d.open || d.cost <= 0) continue;
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      const reach = INTERACT_RADIUS + Math.max(d.w, d.h) / 2;
      if ((p.pos.x - cx) ** 2 + (p.pos.y - cy) ** 2 <= reach * reach) return d;
    }
    return null;
  }

  private updateCodRender(): void {
    const s = this.state;
    const lp = this.local();
    // markers follow their interactable (the Mystery Box teleports); pulse; dim when power-gated
    s.interactables.forEach((it, i) => {
      const m = this.codMarkers[i];
      if (!m) return;
      const gated = !!it.needsPower && !s.powerOn;
      m.icon.setPosition(it.x, it.y).setRotation(s.time * 1.5).setScale(1 + 0.12 * Math.sin(s.time * 4)).setAlpha(gated ? 0.3 : 0.9);
      m.label.setPosition(it.x, it.y - 28).setAlpha(gated ? 0.4 : 0.95);
    });
    // Mystery Box reveal: pop the rolled weapon above the box
    const box = s.interactables.find((it) => it.kind === 'mysterybox');
    if (s.boxReveal && box) {
      this.boxRevealIcon.setVisible(true).setTexture(`wpn_${s.boxReveal.weapon}`).setPosition(box.x, box.y - 44);
      this.setSpriteHeight(this.boxRevealIcon, 30);
    } else {
      this.boxRevealIcon.setVisible(false);
    }
    // proximity buy prompt (nearest buyable, else a nearby pay-door)
    const near = nearestBuyable(s, lp);
    let prompt = '';
    if (near) {
      if (near.needsPower && !s.powerOn) prompt = `${near.label.toUpperCase()} — NEEDS POWER`;
      else if (near.kind === 'power') prompt = s.powerOn ? '' : '[F] Turn on POWER';
      else if (near.kind === 'packapunch' && s.packed[lp.weapon]) prompt = `${WEAPONS[lp.weapon].name} already upgraded`;
      else if (interactReady(s, near) || near.kind === 'wallbuy' || near.kind === 'mysterybox')
        prompt = `[F] ${near.label} — $${interactCost(s, near)}`;
    } else {
      const door = this.nearestPayDoor(lp);
      if (door) prompt = `[F] Open Door — $${door.cost}`;
    }
    this.codPrompt.setText(prompt).setVisible(prompt !== '');
    // announcer banner
    if (s.noticeT > 0 && s.notice) this.codNotice.setText(s.notice).setVisible(true).setAlpha(Math.min(1, s.noticeT));
    else this.codNotice.setVisible(false);
    // active power-up timers + power state
    const chips: string[] = [];
    if (s.instaKillT > 0) chips.push(`INSTA-KILL ${Math.ceil(s.instaKillT)}s`);
    if (s.doublePtsT > 0) chips.push(`x2 ${Math.ceil(s.doublePtsT)}s`);
    if (s.fireSaleT > 0) chips.push(`FIRE SALE ${Math.ceil(s.fireSaleT)}s`);
    if (s.powerOn) chips.push('POWER ON');
    this.codStatus.setText(chips.join('   '));
    // floating power-up pickups
    this.syncPowerups();
  }

  private syncPowerups(): void {
    const seen = new Set<number>();
    const t = this.state.time;
    for (const pu of this.state.powerups) {
      seen.add(pu.id);
      const style = PU_STYLE[pu.kind] ?? { c: 0xffffff, s: '?' };
      let node = this.powerupNodes.get(pu.id);
      if (!node) {
        const g = this.add.star(pu.x, pu.y, 5, 7, 16, style.c, 0.95).setDepth(1);
        const tx = this.add
          .text(pu.x, pu.y, style.s, { fontFamily: 'monospace', fontSize: '10px', color: '#101010', fontStyle: 'bold' })
          .setOrigin(0.5).setDepth(2);
        node = { g, t: tx };
        this.powerupNodes.set(pu.id, node);
      }
      const bob = Math.sin(t * 4 + pu.id) * 4;
      node.g.setPosition(pu.x, pu.y + bob).setRotation(t * 2).setScale(1 + 0.15 * Math.sin(t * 6));
      node.t.setPosition(pu.x, pu.y + bob);
    }
    for (const [id, n] of this.powerupNodes) {
      if (!seen.has(id)) {
        n.g.destroy();
        n.t.destroy();
        this.powerupNodes.delete(id);
      }
    }
  }

  /** The player this client controls (host/solo = 0, guest = its slot). */
  private local(): PlayerState {
    return this.state.players[this.localIndex] ?? this.state.players[0];
  }

  /** Guest: advance the locally-predicted own player so movement/aim feels instant. */
  private predictLocal(input: PlayerInput, dt: number): void {
    const auth = this.state.players[this.localIndex];
    if (!auth || !isUp(auth)) {
      this.predicted = undefined; // downed/dead → render authoritative
      return;
    }
    if (!this.predicted) this.predicted = structuredClone(auth);
    const p = this.predicted;
    updateDash(p, input, dt);
    updateMovement(p, input, mapSolids(this.state), dt);
    updateAim(p, input);
  }

  /** Guest: pull the prediction back toward the host's authoritative state (error correction). */
  private reconcilePrediction(): void {
    const auth = this.state.players[this.localIndex];
    if (!auth || !this.predicted || !isUp(auth)) {
      this.predicted = undefined;
      return;
    }
    const p = this.predicted;
    p.pos.x += (auth.pos.x - p.pos.x) * 0.25; // smooth correction, not a snap
    p.pos.y += (auth.pos.y - p.pos.y) * 0.25;
    // combat/inventory are host-authoritative; only position + aim stay local
    p.hp = auth.hp;
    p.weapon = auth.weapon;
    p.owned = auth.owned;
    p.ammo = auth.ammo;
    p.spin = auth.spin;
    p.meleeSwing = auth.meleeSwing;
    p.fireCooldown = auth.fireCooldown;
    p.downed = auth.downed;
    p.alive = auth.alive;
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    // pointer-over-UI (screen space) — suppresses firing while shopping/drafting
    const ptr = this.input.activePointer;
    const shopOpen = this.state.wave.phase === 'intermission' && !this.state.perkDraft && !this.state.gameOver;
    this.pointerOverUI =
      !!this.state.perkDraft || (shopOpen && ptr.x > 318 && ptr.x < 642 && ptr.y > 262 && ptr.y < 552);
    const input = this.inputCollector.sample();
    // don't fire the weapon when clicking a shop button or picking a perk
    if (this.pointerOverUI) {
      input.fire = false;
      input.dash = false;
    }
    const lp = this.local();
    this.prevPlayerPos = { x: lp.pos.x, y: lp.pos.y };
    this.prevLocalFireCd = lp.fireCooldown;

    let alpha = 1;
    if (this.role === 'guest') {
      // Guests send intent and render the host's snapshots, but PREDICT their own
      // player locally so their movement/aim feels instant despite round-trip lag.
      this.guestNet!.sendInput(input);
      if (this.guestNet!.latest) {
        applySnapshot(this.state, this.guestNet!.latest);
        this.reconcilePrediction();
      }
      this.predictLocal(input, dt);
    } else {
      if (this.role === 'host') this.hostNet!.inputs[0] = input;
      const inputs = this.role === 'host' ? this.hostNet!.inputs : [input];
      alpha = this.loop.tick(dt, () => stepSim(this.state, inputs, SIM_DT));
      if (this.role === 'host') {
        this.bcastAccum += dt;
        if (this.bcastAccum >= 1 / 30) {
          this.bcastAccum = 0;
          this.hostNet!.broadcast(snapshot(this.state));
        }
      }
    }

    // muzzle/recoil/sound off the LOCAL player firing (cooldown jumped up this frame)
    const now = this.local();
    if (now.fireCooldown > this.prevLocalFireCd + 0.001 && WEAPONS[now.weapon].kind !== 'melee') {
      this.cameras.main.shake(40, 0.0008);
      const fx = now.pos.x + Math.cos(now.aimAngle) * 30;
      const fy = now.pos.y + Math.sin(now.aimAngle) * 30;
      const flash = this.add.image(fx, fy, 'muzzle').setRotation(now.aimAngle).setAlpha(0.95);
      this.setSpriteHeight(flash, 34);
      this.time.delayedCall(45, () => flash.destroy());
      this.recoil = 5;
      this.lightPulses.push({ x: fx, y: fy, life: 0.09, max: 0.09, size: 130 });
      this.sfx(GUN_SOUND[now.weapon] ?? 'shot', now.weapon === 'shotgun' || now.weapon === 'rpg' ? 0.55 : 0.42);
    }
    this.gameFeelEvents(dt);
    this.renderState(this.role === 'guest' ? 1 : alpha, dt);
  }

  /** Sound + feedback triggers derived from sim-state transitions (local player). */
  private gameFeelEvents(dt: number): void {
    const p = this.local();

    // took damage → bright red screen flash + shake + grunt (clear "I'm hit" feedback)
    if (p.hp < this.prevHp - 0.01) {
      const lost = this.prevHp - p.hp;
      this.hurtFx = Math.min(1, this.hurtFx + lost * 0.08);
      if (lost > 1) this.hurtFx = Math.max(this.hurtFx, 0.5); // any real hit pops clearly
      if (lost > 2) {
        this.cameras.main.shake(110, 0.005);
        this.sfx('hurt', 0.55);
      }
    }
    this.prevHp = p.hp;
    this.hurtFx = Math.max(0, this.hurtFx - dt * 2.0);
    this.hurtOverlay.setFillStyle(0xff1414, this.hurtFx * 0.5); // bright red, readable

    // heartbeat when near death
    const dying = p.hp > 0 && p.hp < 30 && !this.state.gameOver;
    if (dying && !this.heartbeat) {
      this.heartbeat = this.sound.add('heartbeat', { loop: true, volume: 0.6 });
      this.heartbeat.play();
    } else if (!dying && this.heartbeat) {
      this.heartbeat.stop();
      this.heartbeat.destroy();
      this.heartbeat = undefined;
    }

    // wave transitions → banner
    const phase = this.state.wave.phase;
    if (phase !== this.prevWavePhase) {
      if (phase === 'active') this.banner(`WAVE ${this.state.wave.index}`, '#c23b3b');
      else this.banner('WAVE CLEARED', '#7a9c6a');
      this.prevWavePhase = phase;
    }

    // doors opening → creak + minimap update
    const open = this.state.doors.filter((d) => d.open).length;
    if (open > this.prevOpenDoors) {
      this.sfx('door', 0.6);
      this.sfx('creak', 0.5, 0.9 + Math.random() * 0.3);
      this.minimapDirty = true;
    }
    this.prevOpenDoors = open;

    // zombie growls from whatever's near the player — volume falls off with distance
    this.growlCd -= dt;
    if (this.growlCd <= 0 && this.state.enemies.length > 0) {
      const near = this.state.enemies.reduce((a, b) =>
        (a.pos.x - p.pos.x) ** 2 + (a.pos.y - p.pos.y) ** 2 <= (b.pos.x - p.pos.x) ** 2 + (b.pos.y - p.pos.y) ** 2 ? a : b,
      );
      const dist = Math.hypot(near.pos.x - p.pos.x, near.pos.y - p.pos.y);
      const vol = Math.max(0, 0.6 * (1 - dist / 700));
      if (vol > 0.05) {
        const runner = near.type === 'runner' || near.type === 'screamer';
        this.sfx(runner ? 'snarl' : 'growl', vol, 0.85 + Math.random() * 0.3);
      }
      this.growlCd = 1.3 + Math.random() * 3;
    }

    // sparse creepy atmosphere: a distant baby wail, knocking or a groan
    this.ambientCd -= dt;
    if (this.ambientCd <= 0 && !this.state.gameOver) {
      const pick = Math.random();
      if (pick < 0.4) this.sfx('creak', 0.4, 0.8 + Math.random() * 0.4);
      else if (pick < 0.72) this.sfx('knock', 0.5, 0.9 + Math.random() * 0.2);
      else this.sfx('baby', 0.32, 0.92 + Math.random() * 0.16);
      this.ambientCd = 11 + Math.random() * 17;
    }

    // melee swing / dash start → whoosh
    if (p.meleeSwing > this.prevMeleeSwing + 0.05) this.sfx('whoosh', 0.45);
    this.prevMeleeSwing = p.meleeSwing;
    if (p.dash.timeLeft > this.prevDashLeft + 0.05) this.sfx('whoosh', 0.3, 1.4);
    this.prevDashLeft = p.dash.timeLeft;

    // fresh hits → armored bodies SPARK (bullets ping off), everything else bleeds
    let squelched = false;
    for (const e of this.state.enemies) {
      if (e.hitFlash > 0.065) {
        const dir = Math.atan2(e.vel.y, e.vel.x) + Math.PI; // roughly away from the shot
        if (e.type === 'armored') {
          // metallic sparks — a clear "guns barely work, melee it" cue
          for (let i = 0; i < 5; i++) {
            const a = dir + (Math.random() - 0.5) * 2.2;
            const dist = 14 + Math.random() * 30;
            const spark = this.getCircle(e.pos.x, e.pos.y, 1 + Math.random() * 1.6, Math.random() < 0.5 ? 0xffe27a : 0xfff2c0, 1, 3);
            this.tweens.add({ targets: spark, x: e.pos.x + Math.cos(a) * dist, y: e.pos.y + Math.sin(a) * dist, alpha: 0, duration: 120 + Math.random() * 90, onComplete: () => this.freeCircle(spark) });
          }
          continue;
        }
        if (!squelched) {
          this.sfx('squelch', 0.5, 0.9 + Math.random() * 0.3);
          squelched = true;
        }
        for (let i = 0; i < 6; i++) {
          const a = dir + (Math.random() - 0.5) * 2.4;
          const dist = 20 + Math.random() * 44;
          const drop = this.getCircle(e.pos.x, e.pos.y, 1.6 + Math.random() * 2.4, 0x8a1414, 0.92, 1);
          this.tweens.add({
            targets: drop,
            x: e.pos.x + Math.cos(a) * dist,
            y: e.pos.y + Math.sin(a) * dist,
            alpha: 0,
            duration: 220 + Math.random() * 160,
            onComplete: () => this.freeCircle(drop), // recycle
          });
        }
        // a lingering droplet stains the floor
        if (Math.random() < 0.5) this.stainFloor(e.pos.x + (Math.random() - 0.5) * 30, e.pos.y + (Math.random() - 0.5) * 30, 3);
      }
    }
  }

  /** A small permanent-ish blood stain on the floor (capped pool). */
  private stainFloor(x: number, y: number, r: number): void {
    const s = this.add.circle(x, y, r, 0x5a0e10, 0.7).setDepth(DEPTH_BLOOD);
    this.bloodDecals.push(s as unknown as Phaser.GameObjects.Image);
    if (this.bloodDecals.length > 160) this.bloodDecals.shift()!.destroy();
  }

  /** Death gore: a pool + flying flesh/bone gibs. */
  private spawnGore(x: number, y: number): void {
    const pool = this.add.image(x, y, 'blood').setDepth(DEPTH_BLOOD).setAlpha(0.85).setRotation(Math.random() * 6.28);
    this.setSpriteHeight(pool, 40 + Math.random() * 24);
    this.bloodDecals.push(pool);
    if (this.bloodDecals.length > 160) this.bloodDecals.shift()!.destroy();
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * 6.28;
      const dist = 24 + Math.random() * 60;
      const bone = Math.random() < 0.3;
      const gib = this.add
        .circle(x, y, 1.8 + Math.random() * 3, bone ? 0xcfc7a8 : 0x6e1012, 0.95)
        .setDepth(2);
      this.tweens.add({
        targets: gib,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        scale: 0.4,
        duration: 260 + Math.random() * 220,
        ease: 'Quad.easeOut',
        onComplete: () => {
          if (bone) gib.destroy();
          else {
            gib.setDepth(DEPTH_BLOOD); // flesh chunks settle as stains
            this.bloodDecals.push(gib as unknown as Phaser.GameObjects.Image);
          }
        },
      });
    }
  }

  private banner(text: string, color: string): void {
    const t = this.add
      .text(480, 190, text, { fontFamily: 'monospace', fontSize: '42px', color, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD)
      .setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 250, yoyo: true, hold: 1100, onComplete: () => t.destroy() });
  }

  private static readonly FOG_CELL = 160; // px of world per fog cell

  /**
   * Corner minimap with fog of war: walls/doors appear only where the player
   * has actually been; the rest stays in shadow. Static layer redraws only
   * when exploration or doors change; the player dot updates every frame.
   */
  private drawMinimap(): void {
    const scale = 200 / this.mapW;
    const mx = 960 - 216;
    const my = 14;
    const cell = GameScene.FOG_CELL;
    const cols = Math.ceil(this.mapW / cell);
    const rows = Math.ceil(this.mapH / cell);

    // reveal fog cells around the local player (~1.5 cell radius)
    const p = this.local();
    const pcx = Math.floor(p.pos.x / cell);
    const pcy = Math.floor(p.pos.y / cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        const i = cy * cols + cx;
        if (!this.explored.has(i)) {
          this.explored.add(i);
          this.minimapDirty = true;
        }
      }
    }

    if (this.minimapDirty) {
      this.minimapDirty = false;
      const g = this.minimapG;
      g.clear();
      g.fillStyle(0x05060a, 0.72);
      g.fillRect(mx - 4, my - 4, 208 + 8, this.mapH * scale + 8);
      g.fillStyle(0x555b66, 0.9);
      for (const w of this.state.walls) {
        g.fillRect(mx + w.x * scale, my + w.y * scale, Math.max(1, w.w * scale), Math.max(1, w.h * scale));
      }
      for (const d of this.state.doors) {
        g.fillStyle(d.open ? 0x3a4a3a : 0x8a5a2a, 1);
        g.fillRect(mx + d.x * scale, my + d.y * scale, Math.max(2, d.w * scale), Math.max(2, d.h * scale));
      }
      // shadow every unexplored cell back out (near-opaque: layout stays secret)
      g.fillStyle(0x05060a, 0.975);
      const cw = cell * scale;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (this.explored.has(cy * cols + cx)) continue;
          g.fillRect(mx + cx * cw, my + cy * cw, cw + 0.5, cw + 0.5);
        }
      }
    }

    this.minimapDot.clear();
    this.minimapDot.fillStyle(0xe8eaed, 1);
    this.minimapDot.fillCircle(mx + p.pos.x * scale, my + p.pos.y * scale, 2.4);
  }

  private renderState(alpha: number, dt: number): void {
    const players = this.state.players;
    const lp = this.local();
    // guests render their own player from the local prediction (no round-trip lag)
    const renderLocal = this.role === 'guest' && this.predicted ? this.predicted : lp;
    this.recoil = Math.max(0, this.recoil - dt * 60);
    const lx = this.role === 'guest' ? renderLocal.pos.x : lerp(this.prevPlayerPos.x, lp.pos.x, alpha);
    const ly = this.role === 'guest' ? renderLocal.pos.y : lerp(this.prevPlayerPos.y, lp.pos.y, alpha);
    this.camTarget.setPosition(lx, ly);
    const posOf = (i: number, pl: PlayerState) => {
      if (i === this.localIndex) return { x: lx, y: ly };
      // guests interpolate teammates between snapshots; host/solo are already 60 fps
      if (this.role === 'guest') return this.smooth(this.smoothRemote, i, pl.pos.x, pl.pos.y, dt);
      return { x: pl.pos.x, y: pl.pos.y };
    };
    // for the local slot, aim/weapon come from the prediction so they're instant
    const srcOf = (i: number, pl: PlayerState) => (i === this.localIndex ? renderLocal : pl);

    // Draw every living player: body, held weapon, downed revive ring.
    const seenP = new Set<number>();
    players.forEach((pl, i) => {
      if (!pl.alive) return;
      seenP.add(i);
      const isLocal = i === this.localIndex;
      const src = srcOf(i, pl); // predicted for the local guest, else authoritative
      const { x: px, y: py } = posOf(i, pl);
      const kx = isLocal ? -Math.cos(src.aimAngle) * this.recoil : 0;
      const ky = isLocal ? -Math.sin(src.aimAngle) * this.recoil : 0;

      let body = this.playerBodies.get(i);
      if (!body) {
        body = this.add.image(0, 0, 'player');
        this.setSpriteHeight(body, PLAYER_RADIUS * 4.2);
        this.playerBodies.set(i, body);
      }
      body.setPosition(px + kx, py + ky).setRotation(src.aimAngle - ART_FACING);
      if (src.downed) body.setTint(0x6a1418);
      else if (src.dash.timeLeft > 0) body.setTint(COLORS.dashTint);
      else if (!isLocal) body.setTint(TEAM_TINT[i % 4]);
      else body.clearTint();

      let wpn = this.playerWeapons.get(i);
      if (!wpn) {
        wpn = this.add.image(0, 0, 'wpn_pistol').setOrigin(0.16, 0.5);
        this.playerWeapons.set(i, wpn);
      }
      const wdef = WEAPONS[src.weapon];
      const hand = wdef.kind === 'melee' ? 6 : 13;
      wpn
        .setVisible(!src.downed)
        .setTexture(`wpn_${src.weapon}`)
        .setPosition(px + kx + Math.cos(src.aimAngle) * hand, py + ky + Math.sin(src.aimAngle) * hand)
        .setRotation(src.aimAngle);
      this.setSpriteHeight(wpn, wdef.kind === 'melee' ? 26 : 20);

      // downed → pulsing revive ring showing progress
      let ring = this.reviveRings.get(i);
      if (pl.downed) {
        if (!ring) {
          ring = this.add.circle(0, 0, 24).setStrokeStyle(3, 0xffd45e, 0.8);
          this.reviveRings.set(i, ring);
        }
        ring.setVisible(true).setPosition(px, py).setStrokeStyle(3, 0xffd45e, 0.4 + 0.5 * pl.reviveProgress);
        ring.setRadius(20 + 12 * pl.reviveProgress);
      } else if (ring) {
        ring.setVisible(false);
      }

      if (isLocal && src.dash.timeLeft > 0) {
        this.dashGhostCd -= dt;
        if (this.dashGhostCd <= 0) {
          this.dashGhostCd = 0.028;
          const ghost = this.add.image(px, py, 'player').setRotation(body.rotation).setAlpha(0.35).setTint(COLORS.dashTint);
          ghost.setDisplaySize(body.displayWidth, body.displayHeight);
          this.tweens.add({ targets: ghost, alpha: 0, duration: 180, onComplete: () => ghost.destroy() });
        }
      }
    });
    for (const [i, s] of this.playerBodies) if (!seenP.has(i)) (s.destroy(), this.playerBodies.delete(i));
    for (const [i, s] of this.playerWeapons) if (!seenP.has(i)) (s.destroy(), this.playerWeapons.delete(i));
    for (const [i, s] of this.reviveRings) if (!seenP.has(i)) (s.destroy(), this.reviveRings.delete(i));

    // Darkness: every standing player's flashlight cone + glow cuts it (screen-space).
    const cam = this.cameras.main;
    const ox = cam.scrollX;
    const oy = cam.scrollY;
    const flicker = 1 + Math.sin(this.state.time * 13) * 0.012 + Math.sin(this.state.time * 47) * 0.008;
    const coneLen = FLASHLIGHT_RANGE * 1.12 * flicker;
    this.darkRT.clear();
    this.darkRT.fill(0x05060a, 0.94);
    players.forEach((pl, i) => {
      if (!pl.alive) return;
      const src = srcOf(i, pl);
      const { x: px, y: py } = posOf(i, pl);
      this.glowImg.setPosition(px - ox, py - oy).setDisplaySize(AMBIENT_RADIUS * 2.9, AMBIENT_RADIUS * 2.9).setAlpha(1);
      this.darkRT.erase(this.glowImg);
      if (!src.downed) {
        this.coneImg
          .setPosition(px - ox, py - oy)
          .setRotation(src.aimAngle)
          .setDisplaySize(coneLen, 2 * Math.tan(FLASHLIGHT_HALF_ANGLE) * coneLen * 1.35);
        this.darkRT.erase(this.coneImg);
      }
    });
    for (const pulse of this.lightPulses) {
      pulse.life -= dt;
      const s = pulse.size * (0.6 + 0.4 * (pulse.life / pulse.max));
      this.glowImg.setPosition(pulse.x - ox, pulse.y - oy).setDisplaySize(s, s).setAlpha(Math.max(0, pulse.life / pulse.max));
      this.darkRT.erase(this.glowImg);
    }
    this.lightPulses = this.lightPulses.filter((f) => f.life > 0);
    const x = lx;
    const y = ly;

    this.state.doors.forEach((d, i) => {
      this.doorSprites[i]
        .setTexture(d.open ? 'door_open' : 'door_closed')
        .setDisplaySize(d.w, d.h)
        .setAlpha(d.open ? 0.45 : 1);
    });

    const solids = mapSolids(this.state);
    const eye = { x, y };
    // Off-screen entities can never be seen — skip their LOS raycasts entirely.
    const view = cam.worldView;
    const onScreen = (ex: number, ey: number): boolean =>
      ex > view.x - 90 && ex < view.right + 90 && ey > view.y - 90 && ey < view.bottom + 90;

    // Melee swing wedge (local player).
    const def = WEAPONS[renderLocal.weapon];
    if (def.kind === 'melee' && renderLocal.meleeSwing > 0) {
      const halfArcDeg = ((def.arc ?? 0) * 180) / Math.PI;
      const aimDeg = (renderLocal.aimAngle * 180) / Math.PI;
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

    // Enemies: sprite per type, facing their motion with a walk sway, hidden without line of sight.
    const guest = this.role === 'guest';
    if (guest) {
      const live = new Set(this.state.enemies.map((e) => e.id));
      for (const id of this.smoothEnemy.keys()) if (!live.has(id)) this.smoothEnemy.delete(id);
    }
    this.volatileIds.clear();
    this.syncSprites(
      this.enemySprites,
      this.state.enemies.map((e) => {
        const sp = guest ? this.smooth(this.smoothEnemy, e.id, e.pos.x, e.pos.y, dt) : e.pos;
        if (e.affix === 'volatile') this.volatileIds.add(e.id); // detonates on death (like a boomer)
        return {
        id: e.id,
        x: sp.x,
        y: sp.y,
        texture: e.type,
        height: ZOMBIES[e.type].radius * 4.7,
        rotation: (e.vel.x || e.vel.y) ? Math.atan2(e.vel.y, e.vel.x) - ART_FACING : 0,
        visible: onScreen(e.pos.x, e.pos.y) && segmentClear(eye, e.pos, solids),
        tintFill: e.boss && e.boss.telegraph > 0 ? COLORS.telegraphTint : e.hitFlash > 0 ? 0xffffff : undefined,
        // elite colour-code — hit-flash (tintFill) still wins so hits stay readable
        tint: e.affix ? AFFIXES[e.affix].tint : undefined,
        wobble: e.boss ? 0.05 : 0.11, // shamble sway; heavier bodies sway less
        };
      }),
      (lastX, lastY, id, img) => {
        if (img.texture.key === 'boomer' || this.volatileIds.has(id)) this.boomerExplode(lastX, lastY); // detonates on death
        this.spawnGore(lastX, lastY); // pool + flying flesh/bone gibs
        // corpse: the sprite stays behind, blood-darkened, and slowly soaks away
        const corpse = this.add
          .image(lastX, lastY, img.texture.key)
          .setRotation(img.rotation + (Math.random() - 0.5))
          .setTint(0x3a1416)
          .setAlpha(0.9)
          .setDepth(DEPTH_BLOOD + 0.1);
        corpse.setDisplaySize(img.displayWidth, img.displayHeight);
        this.tweens.add({ targets: corpse, alpha: 0, duration: 11000, onComplete: () => corpse.destroy() });
      },
    );
    this.syncAffixAuras(); // pulsing elite glow rings behind affixed enemies

    // Loot: weapon drops show the actual weapon, ammo shows the ammo box.
    this.syncSprites(
      this.lootSprites,
      this.state.loot.map((l) => ({
        id: l.id,
        x: l.pos.x,
        y: l.pos.y,
        texture: l.kind === 'health' ? 'health' : 'ammo',
        height: 26,
        rotation: 0,
        visible: onScreen(l.pos.x, l.pos.y) && segmentClear(eye, l.pos, solids),
      })),
    );

    this.hpFill.width = 200 * Math.max(0, lp.hp / PLAYER_MAX_HP);
    const w = this.state.wave;
    const status = w.phase === 'intermission' ? `next in ${Math.ceil(w.timer)}s` : `${this.state.enemies.length} left`;
    const squad = this.state.players.filter((q) => q.alive).length;
    const squadTag = this.role === 'solo' ? '' : `  ·  squad ${squad}`;
    this.hud.setText(`WAVE ${w.index}  ·  ${status}  ·  kills ${w.killsThisWave}${squadTag}`);

    const ammo = def.startAmmo === undefined ? '∞' : String(Math.ceil(lp.ammo[def.id] ?? 0));
    const slots = lp.owned.map((id, i) => `${i + 1}:${WEAPONS[id].name}${id === lp.weapon ? '*' : ''}`).join('  ');
    this.weaponIcon.setTexture(`wpn_${lp.weapon}`);
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

    this.cashHud.setText(`$ ${this.state.cash}`);
    this.updateShopUI();
    this.updateDraftUI();
    this.updateExtractionHud(dt);
    this.updateCodRender();

    if (this.state.gameOver && !this.overlay) {
      const won = this.state.won;
      this.overlay = this.add
        .text(480, 270, won ? 'YOU ESCAPED\n\n[R] play again' : 'YOU DIED\n\n[R] restart', {
          fontFamily: 'monospace',
          fontSize: '48px',
          color: won ? '#7dffa0' : '#c23b3b',
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_HUD);
      if (won) this.banner('EXTRACTION COMPLETE', '#7dffa0');
    }

    this.drawMinimap();
  }

  /** Show/refresh the between-wave shop (intermission only, not during a draft). */
  private updateShopUI(): void {
    const open = this.state.wave.phase === 'intermission' && !this.state.perkDraft && !this.state.gameOver;
    this.shopRoot.setVisible(open);
    if (!open) return;
    const ptr = this.input.activePointer;
    for (const b of this.shopButtons) {
      const item = SHOP[b.item];
      const afford = this.state.cash >= item.cost;
      const hovered = GameScene.hit(ptr.x, ptr.y, this.shopHit[b.item]);
      b.label.setText(`${item.name}`.padEnd(20) + `$${item.cost}`);
      b.label.setColor(afford ? '#cfe8d4' : '#5a6b60');
      b.bg.setFillStyle(hovered ? 0x1c3323 : 0x101a12).setAlpha(afford ? 1 : 0.5);
    }
  }

  /** Show/refresh the perk-draft cards while a draft is pending. */
  private updateDraftUI(): void {
    const draft = this.state.perkDraft;
    const open = !!draft && !this.state.gameOver;
    this.draftRoot.setVisible(open);
    if (!open || !draft) return;
    this.draftCards.forEach((card, i) => {
      const id = draft[i] as PerkId | undefined;
      const shown = !!id;
      card.bg.setVisible(shown);
      card.title.setVisible(shown).setText(id ? PERKS[id].name : '');
      const lvl = id ? this.state.perks[id] ?? 0 : 0;
      card.body.setVisible(shown).setText(id ? `${PERKS[id].desc}\n\n${lvl > 0 ? `owned ×${lvl}` : 'new'}` : '');
    });
  }

  /** Final-wave escape objective: world beacon, off-screen arrow, and hold bar. */
  private updateExtractionHud(dt: number): void {
    const ex = this.state.extraction;
    const on = !!ex && !this.state.gameOver;
    this.extractBeacon.setVisible(on);
    this.extractArrow.setVisible(on);
    this.extractBarBack.setVisible(on);
    this.extractBarFill.setVisible(on);
    this.extractLabel.setVisible(on);
    if (!ex) return;
    const pulse = 0.06 + 0.06 * (0.5 + 0.5 * Math.sin(this.state.time * 4));
    this.extractBeacon.setPosition(ex.x, ex.y).setFillStyle(0x2effa0, pulse).setStrokeStyle(3, 0x38ffb0, 0.85);
    const frac = ex.progress / EXTRACT_HOLD;
    this.extractBarFill.width = 360 * Math.max(0, Math.min(1, frac));
    // arrow points from screen center toward the exit (hidden when it's on screen)
    const cam = this.cameras.main;
    const onScreen = cam.worldView.contains(ex.x, ex.y);
    this.extractArrow.setVisible(on && !onScreen);
    if (!onScreen) {
      const lp = this.local();
      const ang = Math.atan2(ex.y - lp.pos.y, ex.x - lp.pos.x);
      this.extractArrow.setPosition(480 + Math.cos(ang) * 150, 118 + Math.sin(ang) * 26).setRotation(ang + Math.PI / 2);
    }
    this.extractLabel.setText(
      frac >= 1 ? 'ESCAPING…' : onScreen ? `HOLD THE EXIT  ${Math.floor(frac * 100)}%` : 'REACH THE EXIT — follow the arrow',
    );
    void dt;
  }

  /** Scale an image to a display height, preserving the source aspect ratio. */
  private setSpriteHeight(img: Phaser.GameObjects.Image, height: number): void {
    const src = img.texture.getSourceImage();
    img.setDisplaySize((src.width / src.height) * height, height);
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
        this.setSpriteHeight(boom, 120);
        this.tweens.add({ targets: boom, alpha: 0, scale: boom.scale * 1.7, duration: 300, onComplete: () => boom.destroy() });
        this.cameras.main.shake(120, 0.006);
        this.lightPulses.push({ x: pos.x, y: pos.y, life: 0.28, max: 0.28, size: 340 }); // blast floods the room with light
        this.explosiveBullets.delete(id);
      }
    }
  }

  /**
   * Faint pulsing aura behind each affixed (elite) enemy in its affix colour, so
   * threats read at a glance. Rings track their enemy sprite (matching guest
   * smoothing) and are pooled by enemy id — cleaned up when the enemy is gone.
   */
  private syncAffixAuras(): void {
    const t = this.state.time;
    const seen = new Set<number>();
    for (const e of this.state.enemies) {
      if (!e.affix) continue;
      const img = this.enemySprites.get(e.id);
      if (!img || !img.visible) continue; // no aura for enemies hidden in the dark
      seen.add(e.id);
      const tint = AFFIXES[e.affix].tint;
      let ring = this.affixAuras.get(e.id);
      if (!ring) {
        ring = this.add.circle(img.x, img.y, ZOMBIES[e.type].radius * 1.9, tint, 0.16).setDepth(DEPTH_BLOOD + 0.5);
        this.affixAuras.set(e.id, ring);
      }
      const pulse = 0.9 + 0.16 * Math.sin(t * 4 + e.id); // gentle breathe
      ring.setPosition(img.x, img.y).setScale(pulse).setFillStyle(tint, 0.16);
    }
    for (const [id, ring] of this.affixAuras) {
      if (!seen.has(id)) {
        ring.destroy();
        this.affixAuras.delete(id);
      }
    }
  }

  /** Boomer death detonation — orange blast, shake, light flash. */
  private boomerExplode(x: number, y: number): void {
    const boom = this.add.image(x, y, 'explosion').setAlpha(0.95).setTint(0xff7a3a);
    this.setSpriteHeight(boom, 110);
    this.tweens.add({ targets: boom, alpha: 0, scale: boom.scale * 1.6, duration: 280, onComplete: () => boom.destroy() });
    this.cameras.main.shake(120, 0.005);
    this.lightPulses.push({ x, y, life: 0.26, max: 0.26, size: 280 });
    this.sfx('explosion', 0.5);
  }

  /** Diffing renderer for circles (bullet tracers) — draws from the shared pool. */
  private syncCircles(
    pool: Map<number, Phaser.GameObjects.Arc>,
    items: { id: number; x: number; y: number; r: number; color: number }[],
  ): void {
    const seen = new Set<number>();
    for (const it of items) {
      seen.add(it.id);
      let shape = pool.get(it.id);
      if (!shape) {
        shape = this.getCircle(it.x, it.y, it.r, it.color, 1, 0);
        pool.set(it.id, shape);
      }
      shape.setPosition(it.x, it.y).setFillStyle(it.color);
    }
    for (const [id, shape] of pool) {
      if (!seen.has(id)) {
        this.freeCircle(shape); // recycle instead of destroy
        pool.delete(id);
      }
    }
  }

  /** Diffing renderer for textured sprites; onRemove fires at the entity's last position (blood etc.). */
  private syncSprites(
    pool: Map<number, Phaser.GameObjects.Image>,
    items: SpriteItem[],
    onRemove?: (lastX: number, lastY: number, id: number, img: Phaser.GameObjects.Image) => void,
  ): void {
    const seen = new Set<number>();
    const t = this.state.time;
    for (const it of items) {
      seen.add(it.id);
      let img = pool.get(it.id);
      if (!img) {
        img = this.add.image(it.x, it.y, it.texture);
        this.setSpriteHeight(img, it.height);
        img.setAlpha(0.1); // rise out of the dark (frame-based, no tween dependency)
        pool.set(it.id, img);
      } else if (img.alpha < 1) {
        img.setAlpha(Math.min(1, img.alpha + 0.07));
      }
      if (img.texture.key !== it.texture) {
        img.setTexture(it.texture);
        this.setSpriteHeight(img, it.height);
      }
      const sway = it.wobble ? Math.sin(t * 6 + it.id * 2.13) * it.wobble : 0;
      img.setPosition(it.x, it.y).setRotation(it.rotation + sway).setVisible(it.visible);
      if (it.tintFill !== undefined) img.setTintFill(it.tintFill);
      else if (it.tint !== undefined) img.setTint(it.tint);
      else img.clearTint();
    }
    for (const [id, img] of pool) {
      if (!seen.has(id)) {
        onRemove?.(img.x, img.y, id, img);
        img.destroy();
        pool.delete(id);
      }
    }
  }
}
