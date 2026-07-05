import Phaser from 'phaser';
import {
  AMBIENT_RADIUS,
  BANISH_COST,
  BARRICADE_HP,
  BARRICADE_SIZE,
  COST_BARRICADE,
  COST_TRAP,
  EXTRACT_HOLD,
  EXTRACT_RADIUS,
  EXTRACTION_WAVE,
  FLASHLIGHT_HALF_ANGLE,
  FLASHLIGHT_RANGE,
  INTERACT_RADIUS,
  LEVELS_FOR,
  PAP_MAX_TIER,
  PAP_ROMAN,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  SIM_DT,
  TRAP_RADIUS,
} from '../config';
import { AFFIXES, affixExplodesOnDeath } from '../sim/affix';
import { evolutionReady, interactCost, interactReady, nearestBuyable } from '../sim/cod';
import { canPlaceDeployable, deployCost } from '../sim/deployables';
import { ZOMBIES, spawnEnemy } from '../sim/enemies';
import { buildMap, mapSolids } from '../sim/map';
import { PERKS, effectiveMaxHp, rerollCost, type PerkId } from '../sim/perks';
import { SHOP } from '../sim/shop';
import { hashSeed, mulberry32 } from '../sim/rng';
import { createGameState } from '../sim/state';
import { stepSim } from '../sim/step';
import { recordScore } from './scores';
import { TIPS, createTipQueue, enqueueTip, loadSeenTips, markTipSeen, tickTipQueue, type TipId, type TipQueueState } from './tips';
import { affixTint, getSettings, powerupColor, scaledFlash, scaledShake, type Settings } from './settings';
import { BED_BASE, bedVolume, lerpTo, tensionVolume } from './music';
import { applyLoadout } from './loadouts';
import { addCurrency, runReward } from './profile';
import { lerp } from '../sim/vec';
import { segmentClear } from '../sim/vision';
import { updateAim } from '../sim/weapons';
import { updateDash, updateMovement } from '../sim/movement';
import { WEAPONS } from '../sim/weapons';
import { isUp, type AffixId, type Door, type EnemyType, type GameState, type PlayerInput, type PlayerState, type WeaponId } from '../sim/types';

/** Static base for runtime asset URLs so the build works under any deploy path. */
const ASSET_BASE = import.meta.env.BASE_URL;
import type { GuestNet, HostNet } from '../net/net';
import { applySnapshot, snapshot } from '../net/protocol';
import { getSession } from '../net/session';
import { InputCollector } from './input';
import { TouchControls } from './touch';
import { FixedLoop } from './loop';

/** Per-slot accent so teammates are distinguishable. */
const TEAM_TINT = [0xffffff, 0x6fb8ff, 0xffd45e, 0x8affa0];

const COLORS = {
  bullet: 0xffe08a,
  hostileBullet: 0x8aff7a,
  dashTint: 0x9fb4d8,
  telegraphTint: 0xff9090,
  stalkerWindup: 0xff2a2a, // stalker bracing to lunge — menacing red flash
  spitterCharge: 0x8aff5a, // spitter charging an acid glob — sickly green glow
  dangerAura: 0xff4a1a, // "about to blow" pulse behind boomers / volatile elites
  melee: 0xe8eaed,
  hpBack: 0x3a0d0d,
  hpFill: 0xc23b3b,
  bossBarBack: 0x33111a,
  bossBarFill: 0xd23b5a,
};

/** All character art faces east (+x) at rotation 0 — same as aimAngle 0. */
const ART_FACING = 0;

/**
 * A6 — evolved weapons ship NO new art. Each renders as its BASE weapon's
 * `wpn_<base>` sprite under a distinct tint, so the held sprite / HUD icon / box
 * reveal never try to load a missing `wpn_<evolvedid>` texture. Render-only.
 */
const WEAPON_SKIN: Partial<Record<WeaponId, { base: WeaponId; tint: number }>> = {
  wunderwaffe: { base: 'raygun', tint: 0x66ccff }, // electric blue
  dragonsbreath: { base: 'shotgun', tint: 0xff7a1a }, // incendiary orange
  deathmachine: { base: 'minigun', tint: 0xffe14a }, // molten gold
};

/** Texture key + tint for a weapon id (evolved ids fall back to their base sprite). */
function weaponSkin(id: WeaponId): { key: string; tint: number | null } {
  const s = WEAPON_SKIN[id];
  return { key: `wpn_${s ? s.base : id}`, tint: s ? s.tint : null };
}

/**
 * B7 — Mystery Box rarity flavour (render-only; no gameplay change). The box-reveal
 * glow + a short label riff on the rolled weapon's rarity: the Ray Gun and its
 * evolutions are LEGENDARY gold, the heavy hardware is RARE blue, the basics COMMON.
 */
const WEAPON_RARITY: Record<WeaponId, { label: string; color: number }> = {
  pistol: { label: 'COMMON', color: 0xbfc4cc },
  katana: { label: 'COMMON', color: 0xbfc4cc },
  bat: { label: 'COMMON', color: 0xbfc4cc },
  smg: { label: 'COMMON', color: 0xbfc4cc },
  shotgun: { label: 'COMMON', color: 0xbfc4cc },
  machinegun: { label: 'RARE', color: 0x4ec6ff },
  minigun: { label: 'RARE', color: 0x4ec6ff },
  rpg: { label: 'RARE', color: 0x4ec6ff },
  chainsaw: { label: 'RARE', color: 0x4ec6ff },
  raygun: { label: 'LEGENDARY', color: 0xffd24a },
  wunderwaffe: { label: 'LEGENDARY', color: 0xffd24a },
  dragonsbreath: { label: 'LEGENDARY', color: 0xffd24a },
  deathmachine: { label: 'LEGENDARY', color: 0xffd24a },
};

/** COD interactable marker colours + floating power-up icon styles. */
const KIND_COLOR: Record<string, number> = { mysterybox: 0xffcf4e, packapunch: 0xb060ff, wallbuy: 0x4ec6ff, power: 0xff5a5a };
const PU_STYLE: Record<string, { c: number; s: string }> = {
  maxammo: { c: 0x4ec6ff, s: 'MAX' },
  instakill: { c: 0xff5a5a, s: 'INSTA' },
  nuke: { c: 0xff8a3a, s: 'NUKE' },
  doublepoints: { c: 0xffcf4e, s: 'x2' },
  firesale: { c: 0x8affa0, s: 'SALE' },
};

/**
 * Colour-blind aid: a short letter tag drawn on each elite aura so affixes are
 * distinguishable WITHOUT relying on hue (info is never colour-only).
 * S=Swift · T=Tank · D=shielDed · B=Blast (volatile) · V=Vampiric.
 */
const AFFIX_TAG: Record<AffixId, string> = { swift: 'S', tank: 'T', shielded: 'D', volatile: 'B', vampiric: 'V' };

/** Co-op ping styling: kind → marker colour + short emoji-free label. */
const PING_KIND_COLOR: Record<string, number> = { enemy: 0xff5a5a, loot: 0x4ec6ff, go: 0xffffff, danger: 0xff8a3a };
const PING_KIND_LABEL: Record<string, string> = { enemy: 'ENEMY', loot: 'LOOT', go: 'GO', danger: '!' };

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
  // B5 — dynamic music: a boss/dog-round stinger (one-shot) + the tension stem.
  // `music_tension` is loaded here but driven as a persistent looping LAYER (see
  // loadAudioDeferred / updateDynamicMusic), not fired via sfx().
  'sting_boss', 'music_tension',
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
  private touch!: TouchControls; // A10: mobile twin-stick overlay (inert on desktop)
  private role: 'solo' | 'host' | 'guest' = 'solo';
  private localIndex = 0;
  // Daily/seeded run: one stateful rng instance per run, threaded to every stepSim
  // call so the whole run is reproducible from `seed`. Undefined ⇒ normal run
  // (stepSim falls back to Math.random). Only the solo/host sim consumes it.
  private seed?: string;
  private simRng?: () => number;
  private dailyHud?: Phaser.GameObjects.Text; // seed + live score, daily runs only
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
  private affixTags = new Map<number, Phaser.GameObjects.Text>(); // letter tag on each elite aura (colour-blind aid: never colour-only)
  private hcOutlines = new Map<number, Phaser.GameObjects.Arc>(); // high-contrast: bright ring around every on-screen enemy
  private dangerAuras = new Map<number, Phaser.GameObjects.Arc>(); // pulsing "about to blow" rings behind boomers / volatile elites
  private chargingIds = new Set<number>(); // enemies mid wind-up last frame, so we sound the tension cue only on the rising edge
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
  // Accessibility settings (render-layer, localStorage). Loaded once in create()
  // — they change only in the lobby, never mid-run, so no netcode/determinism risk.
  private settings: Settings = { colorblind: 'off', captions: true, shake: 1, flash: 1, highContrast: false };
  // Captions: a small pooled stack of fading lines under the HUD for key audio cues.
  private captionRoot!: Phaser.GameObjects.Container;
  private captionLines: { t: Phaser.GameObjects.Text; life: number; max: number }[] = [];
  private captionLast = ''; // dedupe: suppress the same caption fired again immediately
  private captionLastAt = -1;
  private downOverlay!: Phaser.GameObjects.Rectangle; // desaturating vignette while the local player is downed
  private downedHud!: Phaser.GameObjects.Text; // centered "GET UP" / self-revive prompt when downed
  private zedOverlay!: Phaser.GameObjects.Rectangle; // A9: cool-blue vignette while Zed-Time is active
  private zedMeterBack!: Phaser.GameObjects.Rectangle; // A9: charge-meter track
  private zedMeterFill!: Phaser.GameObjects.Rectangle; // A9: charge-meter fill
  private zedMeterLabel!: Phaser.GameObjects.Text; // A9: "ZED n%" / "[X] READY" / countdown
  private prevZedActive = false; // A9: rising-edge detect to pop the activation flash
  private prevNotice = ''; // rising-edge detect for announcer callouts → captions
  private prevBossCount = 0; // rising-edge detect for boss spawns → caption
  private prevHp = 0;
  private prevWavePhase = '';
  private prevOpenDoors = 0;
  private prevMeleeSwing = 0;
  private prevDashLeft = 0;
  private heartbeat?: Phaser.Sound.BaseSound;
  // B5 — dynamic music: a persistent `music_tension` layer created once (like the
  // bed) and volume-driven per frame from state.intensity, plus the smoothed
  // current volumes for both layers (lerped so nothing jumps).
  private tensionMusic?: Phaser.Sound.BaseSound;
  private tensionVol = 0; // smoothed tension-layer volume
  private bedVol = BED_BASE; // smoothed base-bed volume
  private prevDogRound = false; // rising-edge detect for the hellhound-round stinger
  private stingerCd = 0; // shared cooldown so mood stingers can't spam
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
  // B9 — onboarding: contextual just-in-time tips. A pure queue (one tip at a time)
  // + an in-memory mirror of the localStorage "seen" set so first-time detection runs
  // each frame without touching storage. Render/localStorage-only; sim untouched.
  private tipQueue: TipQueueState = createTipQueue();
  private tipsSeen = new Set<string>();
  private tipText!: Phaser.GameObjects.Text; // upper-centre toast under the wave HUD
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
  private banishHit: { x0: number; y0: number; x1: number; y1: number; i: number }[] = []; // ✕ per card
  private rerollHit: { x0: number; y0: number; x1: number; y1: number } | null = null; // reroll button
  // perk draft overlay
  private draftRoot!: Phaser.GameObjects.Container;
  private draftCards: {
    bg: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    banish: Phaser.GameObjects.Text;
  }[] = [];
  private rerollBtn!: { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text };
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
  private boxRevealLabel!: Phaser.GameObjects.Text; // B7: rarity flavour under the box reveal
  private boxPrevXY: { x: number; y: number } | null = null; // B7: last box spot, to telegraph the teddy relocate
  // co-op ping markers (world-space, pooled by ping id) + teammate status + off-screen threat arrows
  private pingNodes = new Map<number, { chevron: Phaser.GameObjects.Triangle; dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }>();
  private teammateHud = new Map<number, { back: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle; name: Phaser.GameObjects.Text }>();
  private threatArrows = new Map<number, Phaser.GameObjects.Triangle>();
  // A7 deployables: pooled barricade bodies (+ hp bars) and pulsing trap rings, plus a build bar + placement preview
  private barricadeSprites = new Map<number, Phaser.GameObjects.Image>();
  private barricadeBars = new Map<number, { back: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle }>();
  private trapRings = new Map<number, { ring: Phaser.GameObjects.Arc; core: Phaser.GameObjects.Arc }>();
  private prevTrapCd = new Map<number, number>(); // detect the zap edge (cd jumps up) to flash the ring
  private buildBar!: Phaser.GameObjects.Text; // screen-space "[B] BARRICADE $500" bar
  private buildPreviewBox!: Phaser.GameObjects.Rectangle; // barricade footprint preview at the aim point
  private buildPreviewRing!: Phaser.GameObjects.Arc; // trap radius preview at the aim point

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
      this.sound.play('music', { loop: true, volume: BED_BASE });
      // B5 — start the tension LAYER looping in sync with the bed, silent to begin
      // (near-0 intensity), then faded up per frame by updateDynamicMusic. Created
      // once and kept persistent (guarded like the bed so it never double-starts).
      if (this.cache.audio.exists('music_tension') && !this.sound.get('music_tension')) {
        this.tensionMusic = this.sound.add('music_tension', { loop: true, volume: 0 });
        this.tensionMusic.play();
        this.tensionVol = 0;
        this.bedVol = BED_BASE;
      }
    };
    this.load.once(Phaser.Loader.Events.COMPLETE, startMusic);
    this.sound.once(Phaser.Sound.Events.UNLOCKED, startMusic);
    this.load.start();
  }

  private sfx(key: (typeof SOUNDS)[number], volume = 0.5, rate = 1): void {
    if (this.cache.audio.exists(key)) this.sound.play(key, { volume, rate }); // skip until loaded
  }

  create(): void {
    this.settings = getSettings(); // accessibility prefs (shake/flash/colour-blind/captions/contrast)
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
    // Seeded (daily) run: build ONE rng from the seed for this whole run. On a
    // scene.restart() create() runs again → a fresh rng from the same seed → the
    // run replays identically, which is exactly what a daily challenge wants.
    if (session.role === 'solo' && session.seed) {
      this.seed = session.seed;
      this.simRng = mulberry32(hashSeed(session.seed));
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

    // Meta-progression: the host/solo player applies its unlocked starting loadout to
    // its OWN player before any snapshot exists. Guests keep the default start (the
    // host's loadout is not synced — this is a render/session-layer choice, never
    // part of the netcoded Snapshot). See src/game/loadouts.ts.
    if (session.role !== 'guest' && session.loadout) {
      applyLoadout(this.state, this.state.players[this.localIndex], session.loadout);
    }

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
    if (wpn === 'all') {
      // ?wpn=all: playtest convenience — every weapon in the arsenal, fully loaded.
      (Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]).forEach((id) => {
        if (!this.state.player.owned.includes(id)) this.state.player.owned.push(id);
        if (WEAPONS[id].startAmmo !== undefined) this.state.player.ammo[id] = 999;
      });
    } else if (wpn && wpn in WEAPONS) {
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
    if (qs.has('perk'))
      this.state.perkDraft = [
        { id: 'damage', rarity: 'common' },
        { id: 'firerate', rarity: 'rare' },
        { id: 'vigor', rarity: 'legendary' },
      ];
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
    // A10: virtual touch controls. Reads multi-touch and overlays PlayerInput in
    // update(); hidden + inert on non-touch devices so desktop is unaffected.
    this.touch = new TouchControls(this, this.inputCollector);

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
    // Daily "seed of the day" + live score strip (only on a seeded run).
    if (this.seed) {
      this.dailyHud = this.add
        .text(480, 524, '', { fontFamily: 'monospace', fontSize: '12px', color: '#8affbf', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_HUD);
    }

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
    // Downed vignette: a dark, desaturated overlay while the local player is on the ground.
    this.downOverlay = this.add
      .rectangle(480, 270, 960, 540, 0x120204, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD - 1);
    this.downedHud = this.add
      .text(480, 300, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ff6b80', fontStyle: 'bold', align: 'center' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD)
      .setVisible(false);
    // A9: Zed-Time — a cool-blue slow-mo vignette (reuses the hurt-vignette pattern)
    // plus a charge meter under the HP bar that glows [X] READY when full.
    this.zedOverlay = this.add
      .rectangle(480, 270, 960, 540, 0x2b6bff, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD - 1);
    this.zedMeterBack = this.add.rectangle(16, 454, 200, 7, 0x0a1626).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD);
    this.zedMeterFill = this.add.rectangle(16, 454, 0, 7, 0x2b6bff).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD);
    this.zedMeterLabel = this.add
      .text(16, 440, '', { fontFamily: 'monospace', fontSize: '11px', color: '#6f9fd0', fontStyle: 'bold' })
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);

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

    // Captions: a bottom-centre stack of fading lines (built even when off; the
    // caption() call is gated so nothing is added unless the setting is on).
    this.captionRoot = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH_HUD + 2);

    // B9 — onboarding tip toast (upper-centre, under the boss bar / above the
    // announcer): a small dark panel with mono amber text, hidden until a tip fires.
    // Load the once-ever "seen" set into memory so per-frame detection never hits storage.
    this.tipsSeen = loadSeenTips();
    this.tipText = this.add
      .text(480, 64, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffe08a', fontStyle: 'bold', backgroundColor: '#000c', align: 'center', wordWrap: { width: 620 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD + 2)
      .setPadding(10, 6, 10, 6)
      .setVisible(false);

    this.buildShopUI();
    this.buildDraftUI();
    this.buildCodRender();
    this.buildDeployUI();
    this.applyHighContrastHud(); // brighten HP bar + HUD text when high-contrast is on

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

    // B5 — clean up the persistent tension layer on scene shutdown/restart so it
    // never leaks a second looping instance (startMusic recreates it next create()).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.tensionMusic) {
        this.tensionMusic.stop();
        this.tensionMusic.destroy();
        this.tensionMusic = undefined;
      }
    });

    // Shop/perk clicks: hit-test the pointer in SCREEN space ourselves. Phaser's
    // input mis-tests a scrollFactor-0 container once the camera scrolls, so the
    // buttons never register — this path is camera-independent and reliable.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.handleUiClick(p.x, p.y));
  }

  private static hit(px: number, py: number, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1;
  }

  /**
   * Render-only "power" factor from a weapon's base damage (~0.7 for the SMG up to
   * a 2.0 cap for the RPG/Ray Gun). Modulates muzzle-flash size, camera shake, and
   * blood/gib intensity so heavier guns simply LOOK heavier — never touches the sim.
   */
  private static dmgFeel(damage: number): number {
    return Math.min(2, 0.7 + damage / 60);
  }

  /**
   * Camera shake that never *weakens* a bigger one already playing. Fire recoil and
   * per-hit impact both kick the camera; without this a tiny hit-kick fired the same
   * frame as a shotgun blast would stomp the big shake down to nothing.
   */
  private kickCamera(duration: number, intensity: number): void {
    const i = scaledShake(intensity, this.settings); // accessibility: 0 = no shake
    if (i <= 0) return;
    const eff = this.cameras.main.shakeEffect;
    if (eff.isRunning && eff.intensity.x >= i) return;
    this.cameras.main.shake(duration, i);
  }

  /**
   * Forced camera shake (explosions / big hits) that still honours the
   * accessibility shake multiplier. Every shake in the game routes through here
   * or kickCamera, so `shake = 0` reliably removes ALL screen-shake.
   */
  private shakeCam(duration: number, intensity: number): void {
    const i = scaledShake(intensity, this.settings);
    if (i <= 0) return;
    this.cameras.main.shake(duration, i);
  }

  /** High-contrast: brighten the HP bar + core HUD text for low-vision / high-glare play. */
  private applyHighContrastHud(): void {
    if (!this.settings.highContrast) return;
    this.hpFill.setFillStyle(0xff4d4d);
    this.hud.setColor('#ffffff');
    this.weaponHud.setColor('#ffe14a');
    this.cashHud.setColor('#b6ffce');
  }

  /**
   * Caption a key non-speech audio cue (e.g. "[explosion]"). No-op unless the
   * captions setting is on. Fired from the SAME render events that play the
   * sound, so audio-only information is mirrored on screen. Deduped (the same
   * caption within a short window is suppressed), time-limited and pooled into a
   * bottom-centre stack of at most a few fading lines.
   */
  private caption(text: string): void {
    if (!this.settings.captions) return;
    const now = this.state ? this.state.time : 0;
    if (text === this.captionLast && now - this.captionLastAt < 0.9) return; // dedupe rapid repeats
    this.captionLast = text;
    this.captionLastAt = now;
    const t = this.add
      .text(0, 0, text, { fontFamily: 'monospace', fontSize: '15px', color: '#e8eef2', fontStyle: 'bold', backgroundColor: '#000a', align: 'center' })
      .setOrigin(0.5, 1)
      .setPadding(8, 4, 8, 4)
      .setAlpha(0.98);
    this.captionRoot.add(t);
    this.captionLines.push({ t, life: 2.6, max: 2.6 });
    while (this.captionLines.length > 4) this.captionLines.shift()!.t.destroy(); // pool cap
  }

  /** Age caption lines: fade over their lifetime and stack upward from the bottom. */
  private updateCaptions(dt: number): void {
    if (this.captionLines.length === 0) return;
    const baseY = 470; // just under the HUD, above the mobile touch zone
    let y = baseY;
    for (let i = this.captionLines.length - 1; i >= 0; i--) {
      const line = this.captionLines[i];
      line.life -= dt;
      if (line.life <= 0) {
        line.t.destroy();
        this.captionLines.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, line.life / 0.5); // fade out over the last 0.5s
      line.t.setPosition(480, y).setAlpha(0.98 * fade);
      y -= 22;
    }
  }

  /** Route a click to a shop row or a perk card (screen-space). */
  private handleUiClick(px: number, py: number): void {
    if (this.state.gameOver) return;
    if (this.state.perkDraft) {
      // banish ✕ sits inside its card, so test it before the card-pick rects
      const canBanish = this.state.cash >= BANISH_COST;
      if (canBanish) for (const c of this.banishHit) if (GameScene.hit(px, py, c)) { this.inputCollector.requestBanish(c.i); return; }
      if (this.rerollHit && GameScene.hit(px, py, this.rerollHit)) {
        if (this.state.cash >= rerollCost(this.state)) this.inputCollector.requestReroll();
        return; // swallow the click even when unaffordable (don't fall through to a pick)
      }
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
      // banish (✕) affordance in the card's top-right corner
      const bxX = cx + cw / 2 - 16;
      const bxY = 300 - 85 + 14;
      const banish = this.add.text(bxX, bxY, '✕', { fontFamily: 'monospace', fontSize: '16px', color: '#c0554d', fontStyle: 'bold' }).setOrigin(0.5);
      this.draftRoot.add([bg, t, b, banish]);
      this.draftCards.push({ bg, title: t, body: b, banish });
      this.draftHit.push({ x0: cx - cw / 2, y0: 300 - 85, x1: cx + cw / 2, y1: 300 + 85, i });
      this.banishHit.push({ x0: bxX - 13, y0: bxY - 13, x1: bxX + 13, y1: bxY + 13, i });
    }
    // reroll button below the cards
    const ry = 300 + 85 + 34;
    const rbg = this.add.rectangle(480, ry, 200, 34, 0x101a12).setStrokeStyle(1, 0x3ea45a);
    const rlabel = this.add.text(480, ry, '', { fontFamily: 'monospace', fontSize: '14px', color: '#cfe8d4', fontStyle: 'bold' }).setOrigin(0.5);
    this.draftRoot.add([rbg, rlabel]);
    this.rerollBtn = { bg: rbg, label: rlabel };
    this.rerollHit = { x0: 480 - 100, y0: ry - 17, x1: 480 + 100, y1: ry + 17 };
    const hint = this.add.text(480, ry + 30, 'reroll rolls new options  ·  ✕ banishes a perk for the run', { fontFamily: 'monospace', fontSize: '11px', color: '#4d6b55' }).setOrigin(0.5);
    this.draftRoot.add(hint);
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
    this.boxRevealLabel = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_HUD - 1)
      .setVisible(false);
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

  // ── A7 build bar + placement preview ────────────────────────────────────────
  private buildDeployUI(): void {
    // screen-space build bar (bottom-centre); shown only while a build kind is selected
    this.buildBar = this.add
      .text(480, 452, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffe08a', fontStyle: 'bold', backgroundColor: '#000a', align: 'center' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD + 1)
      .setPadding(8, 5, 8, 5)
      .setVisible(false);
    // world-space translucent previews (one for each kind); coloured by validity
    this.buildPreviewBox = this.add
      .rectangle(0, 0, BARRICADE_SIZE, BARRICADE_SIZE, 0x8a5a2a, 0.35)
      .setStrokeStyle(2, 0xffcf7a, 0.9)
      .setDepth(DEPTH_HUD - 3)
      .setVisible(false);
    this.buildPreviewRing = this.add
      .circle(0, 0, TRAP_RADIUS, 0x4ec6ff, 0.14)
      .setStrokeStyle(2, 0x8affff, 0.9)
      .setDepth(DEPTH_HUD - 3)
      .setVisible(false);
  }

  /**
   * A7 — render placed barricades (a scrap-plank box reusing the `crate` texture,
   * tinted redder as it takes damage, with a slim HP bar) and traps (a pulsing
   * electric ring that flashes on each zap). Then the build bar + a placement
   * preview at the aim point that turns red when placement is invalid.
   */
  private updateDeployRender(): void {
    const s = this.state;
    const t = s.time;
    const seenBar = new Set<number>();
    const seenTrap = new Set<number>();
    for (const d of s.deployables) {
      if (d.kind === 'barricade') {
        seenBar.add(d.id);
        const frac = Math.max(0, Math.min(1, (d.hp ?? 0) / BARRICADE_HP));
        let img = this.barricadeSprites.get(d.id);
        if (!img) {
          img = this.add.image(d.x, d.y, 'crate').setDepth(DEPTH_FLOOR + 0.6);
          this.setSpriteHeight(img, BARRICADE_SIZE);
          img.setDisplaySize(BARRICADE_SIZE, BARRICADE_SIZE);
          this.barricadeSprites.set(d.id, img);
        }
        // healthy = pale timber, battered = charred red
        const dmg = 1 - frac;
        const r = 0xff, g = Math.round(0xff - dmg * 0xc0), b = Math.round(0xff - dmg * 0xe0);
        img.setPosition(d.x, d.y).setTint((r << 16) | (g << 8) | b);
        let bar = this.barricadeBars.get(d.id);
        if (!bar) {
          const back = this.add.rectangle(d.x, d.y - BARRICADE_SIZE / 2 - 6, BARRICADE_SIZE, 4, 0x1a0505, 0.85).setDepth(DEPTH_HUD - 5);
          const fill = this.add.rectangle(d.x - BARRICADE_SIZE / 2, d.y - BARRICADE_SIZE / 2 - 6, BARRICADE_SIZE, 4, 0x4bd06a, 1).setOrigin(0, 0.5).setDepth(DEPTH_HUD - 5);
          bar = { back, fill };
          this.barricadeBars.set(d.id, bar);
        }
        bar.back.setPosition(d.x, d.y - BARRICADE_SIZE / 2 - 6);
        bar.fill.setPosition(d.x - BARRICADE_SIZE / 2, d.y - BARRICADE_SIZE / 2 - 6);
        bar.fill.width = BARRICADE_SIZE * frac;
        bar.fill.setFillStyle(frac < 0.3 ? 0xc23b3b : frac < 0.6 ? 0xe0b040 : 0x4bd06a);
      } else {
        seenTrap.add(d.id);
        const prev = this.prevTrapCd.get(d.id) ?? 0;
        const zapped = (d.cd ?? 0) > prev + 0.001; // cd jumped up → it just fired
        this.prevTrapCd.set(d.id, d.cd ?? 0);
        let node = this.trapRings.get(d.id);
        if (!node) {
          const ring = this.add.circle(d.x, d.y, TRAP_RADIUS, 0x4ec6ff, 0.08).setStrokeStyle(2, 0x8affff, 0.7).setDepth(DEPTH_FLOOR + 0.55);
          const core = this.add.circle(d.x, d.y, 10, 0x8affff, 0.9).setDepth(DEPTH_FLOOR + 0.56);
          node = { ring, core };
          this.trapRings.set(d.id, node);
        }
        const pulse = 0.5 + 0.5 * Math.sin(t * 6 + d.id);
        const flash = zapped ? 0.5 : 0;
        node.ring.setPosition(d.x, d.y).setFillStyle(0x4ec6ff, 0.06 + 0.08 * pulse + flash).setStrokeStyle(2, 0x8affff, 0.55 + 0.35 * pulse + flash);
        node.core.setPosition(d.x, d.y).setScale(0.8 + 0.4 * pulse + (zapped ? 0.6 : 0)).setFillStyle(0x8affff, 0.75 + 0.25 * pulse);
        if (zapped) this.sfx('shot', 0.28, 1.8); // sharp electric crack on each zap
      }
    }
    for (const [id, img] of this.barricadeSprites) if (!seenBar.has(id)) (img.destroy(), this.barricadeSprites.delete(id));
    for (const [id, bar] of this.barricadeBars) if (!seenBar.has(id)) (bar.back.destroy(), bar.fill.destroy(), this.barricadeBars.delete(id));
    for (const [id, n] of this.trapRings) if (!seenTrap.has(id)) (n.ring.destroy(), n.core.destroy(), this.trapRings.delete(id), this.prevTrapCd.delete(id));

    // build bar + placement preview at the aim point (local player)
    const kind = this.inputCollector.buildKind();
    if (kind) {
      const lp = this.local();
      const ptr = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      const valid = canPlaceDeployable(s, lp, world.x, world.y, kind);
      this.buildBar
        .setText(`BUILD: ${kind.toUpperCase()}  $${deployCost(kind)}     [B] cycle / off   ·   click to place`)
        .setVisible(true)
        .setColor(s.cash >= deployCost(kind) ? '#ffe08a' : '#c07a6a');
      const okC = kind === 'barricade' ? 0xffcf7a : 0x8affff;
      if (kind === 'barricade') {
        this.buildPreviewBox.setPosition(world.x, world.y).setVisible(true)
          .setFillStyle(valid ? 0x8a5a2a : 0x8a1414, 0.35).setStrokeStyle(2, valid ? okC : 0xff4a4a, 0.95);
        this.buildPreviewRing.setVisible(false);
      } else {
        this.buildPreviewRing.setPosition(world.x, world.y).setVisible(true)
          .setFillStyle(valid ? 0x4ec6ff : 0x8a1414, 0.14).setStrokeStyle(2, valid ? okC : 0xff4a4a, 0.95);
        this.buildPreviewBox.setVisible(false);
      }
    } else {
      this.buildBar.setVisible(false);
      this.buildPreviewBox.setVisible(false);
      this.buildPreviewRing.setVisible(false);
    }
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
    // Mystery Box reveal: pop the rolled weapon above the box, tagged with its rarity (B7)
    const box = s.interactables.find((it) => it.kind === 'mysterybox');
    if (s.boxReveal && box) {
      const skin = weaponSkin(s.boxReveal.weapon);
      const rar = WEAPON_RARITY[s.boxReveal.weapon] ?? { label: 'COMMON', color: 0xbfc4cc };
      this.boxRevealIcon.setVisible(true).setTexture(skin.key).setPosition(box.x, box.y - 48);
      // rarity glow: legendary/rare tint the icon; commons keep their own skin colour
      if (rar.label === 'COMMON') skin.tint !== null ? this.boxRevealIcon.setTint(skin.tint) : this.boxRevealIcon.clearTint();
      else this.boxRevealIcon.setTint(rar.color);
      const pop = 1 + 0.1 * Math.sin(s.time * 10);
      this.setSpriteHeight(this.boxRevealIcon, 30 * pop);
      this.boxRevealLabel
        .setVisible(true)
        .setText(rar.label)
        .setColor('#' + rar.color.toString(16).padStart(6, '0'))
        .setPosition(box.x, box.y - 28);
    } else {
      this.boxRevealIcon.setVisible(false);
      this.boxRevealLabel.setVisible(false);
    }
    // B7 — teddy-bear relocate TELL: when the box teleports, leave a fading ghost
    // marker at the OLD spot so players learn the box left (the move itself is
    // host-authoritative in the sim; this is a pure render reaction).
    if (box) {
      if (this.boxPrevXY && (this.boxPrevXY.x !== box.x || this.boxPrevXY.y !== box.y)) {
        this.spawnBoxMovedTell(this.boxPrevXY.x, this.boxPrevXY.y);
      }
      this.boxPrevXY = { x: box.x, y: box.y };
    }
    // proximity buy prompt (nearest buyable, else a nearby pay-door)
    const near = nearestBuyable(s, lp);
    let prompt = '';
    if (near) {
      const evo = near.kind === 'packapunch' ? evolutionReady(s, lp) : undefined;
      const papTier = near.kind === 'packapunch' ? (s.papTier[lp.weapon] ?? 0) : 0;
      if (near.needsPower && !s.powerOn) prompt = `${near.label.toUpperCase()} — NEEDS POWER`;
      else if (near.kind === 'power') prompt = s.powerOn ? '' : '[F] Turn on POWER';
      else if (evo) prompt = `[F] EVOLVE — ${evo.name}`;
      else if (near.kind === 'packapunch' && papTier >= PAP_MAX_TIER) prompt = `${WEAPONS[lp.weapon].name} ✦${PAP_ROMAN[PAP_MAX_TIER]} — MAX`;
      else if (near.kind === 'packapunch') prompt = `[F] PACK-A-PUNCH ${PAP_ROMAN[papTier + 1]} — $${interactCost(s, near)}`;
      else if (interactReady(s, near) || near.kind === 'wallbuy' || near.kind === 'mysterybox')
        prompt = `[F] ${near.label} — $${interactCost(s, near)}`;
    } else {
      const door = this.nearestPayDoor(lp);
      if (door) prompt = `[F] Open Door — $${door.cost}`;
    }
    this.codPrompt.setText(prompt).setVisible(prompt !== '');
    // announcer banner (+ caption its callouts on the rising edge, e.g. "[MAX AMMO]")
    if (s.noticeT > 0 && s.notice) {
      this.codNotice.setText(s.notice).setVisible(true).setAlpha(Math.min(1, s.noticeT));
      if (s.notice !== this.prevNotice) this.caption(`[${s.notice}]`);
    } else this.codNotice.setVisible(false);
    this.prevNotice = s.noticeT > 0 ? s.notice : '';
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

  /**
   * B7 — teddy-bear relocate telegraph. Fires when the Mystery Box teleports:
   * a distinct whoosh + a fading "☒ BOX LEFT" ghost that lifts and dissolves at
   * the OLD spot, so the disappearance reads as an event, not a silent surprise.
   */
  private spawnBoxMovedTell(x: number, y: number): void {
    this.sfx('whoosh', 0.6, 0.7); // low, packing-up whoosh — distinct from a spin
    const ghost = this.add.star(x, y, 4, 6, 15, 0xffcf4e, 0.9).setDepth(DEPTH_HUD - 2);
    const tag = this.add
      .text(x, y - 30, '☒ BOX LEFT', { fontFamily: 'monospace', fontSize: '13px', color: '#ffcf4e', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH_HUD - 2);
    this.tweens.add({
      targets: [ghost, tag],
      alpha: 0,
      y: '-=26',
      duration: 1400,
      ease: 'Cubic.easeOut',
      onComplete: () => { ghost.destroy(); tag.destroy(); },
    });
    this.tweens.add({ targets: ghost, scale: 1.6, duration: 1400, ease: 'Cubic.easeOut' });
  }

  private syncPowerups(): void {
    const seen = new Set<number>();
    const t = this.state.time;
    for (const pu of this.state.powerups) {
      seen.add(pu.id);
      const style = PU_STYLE[pu.kind] ?? { c: 0xffffff, s: '?' };
      const puColor = powerupColor(pu.kind, style.c, this.settings.colorblind); // colour-blind-safe remap
      let node = this.powerupNodes.get(pu.id);
      if (!node) {
        const g = this.add.star(pu.x, pu.y, 5, 7, 16, puColor, 0.95).setDepth(1);
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

  /** Run score = wave reached ×100 + total kills. (Reaching a new wave is the main driver; kills break ties.) */
  private runScore(): number {
    return this.state.wave.index * 100 + this.state.totalKills;
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
    // A10: overlay virtual-stick + button state onto the sampled input (no-op on
    // desktop). Right stick is a direction → world point relative to the local player.
    this.touch.apply(input, this.local().pos);
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
      // Seeded run threads this.simRng; a normal run passes undefined so stepSim's
      // default (Math.random) kicks in — normal play is unchanged.
      alpha = this.loop.tick(dt, () => stepSim(this.state, inputs, SIM_DT, this.simRng));
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
      const wdef = WEAPONS[now.weapon];
      const kick = wdef.recoil ?? 1; // per-weapon heft (data-driven): shotgun/RPG punch, SMG barely nudges
      const dmgFeel = GameScene.dmgFeel(wdef.damage); // damage-scaled magnitudes (flash/shake/light)
      // camera kick + weapon-sprite pushback both ride the per-weapon recoil (kickCamera
      // won't let a light shot weaken a heavier shake already running).
      this.kickCamera(38 + kick * 14, Math.min(0.004, 0.0007 * kick * dmgFeel));
      const fx = now.pos.x + Math.cos(now.aimAngle) * 30;
      const fy = now.pos.y + Math.sin(now.aimAngle) * 30;
      const flash = this.add.image(fx, fy, 'muzzle').setRotation(now.aimAngle).setAlpha(0.95);
      this.setSpriteHeight(flash, 20 + 14 * dmgFeel); // bigger guns flash bigger
      this.time.delayedCall(45, () => flash.destroy());
      this.recoil = 5 * kick; // sprite shoved back along aim, decays fast in renderState
      this.lightPulses.push({ x: fx, y: fy, life: 0.09, max: 0.09, size: 110 + 60 * dmgFeel });
      this.sfx(GUN_SOUND[now.weapon] ?? 'shot', now.weapon === 'shotgun' || now.weapon === 'rpg' ? 0.55 : 0.42);
    }
    this.gameFeelEvents(dt);
    this.updateTips(dt);
    this.renderState(this.role === 'guest' ? 1 : alpha, dt);
  }

  /**
   * B9 — queue a contextual tip the FIRST time its situation is relevant, then never
   * again (persisted once-ever). Reads existing sim state only — no sim/netcode touch.
   * The in-memory `tipsSeen` mirror gates re-fires without a per-frame localStorage read;
   * markTipSeen persists so the flag survives runs/sessions.
   */
  private maybeTip(id: TipId): void {
    if (this.tipsSeen.has(id)) return;
    this.tipsSeen.add(id);
    markTipSeen(id);
    enqueueTip(this.tipQueue, id, TIPS[id]);
  }

  /** B9 — detect first-time onboarding situations, drive the tip queue, render the toast. */
  private updateTips(dt: number): void {
    const s = this.state;
    if (!s.gameOver) {
      const lp = this.local();
      // near a pay-door (only when up — a downed player can't buy)
      if (isUp(lp) && this.nearestPayDoor(lp)) this.maybeTip('paydoor');
      // any power-up on the ground
      if (s.powerups.length > 0) this.maybeTip('powerup');
      // near a buyable → the tip for that specific kind
      const near = isUp(lp) ? nearestBuyable(s, lp) : null;
      if (near) {
        if (near.kind === 'mysterybox') this.maybeTip('mysterybox');
        else if (near.kind === 'packapunch') this.maybeTip('packapunch');
        else if (near.kind === 'wallbuy') this.maybeTip('wallbuy');
        else if (near.kind === 'power') this.maybeTip('power');
      }
      // perk draft is open
      if (s.perkDraft) this.maybeTip('perkdraft');
      // local player just went down
      if (lp.downed) this.maybeTip('downed');
      // a boss is on the field
      if (s.enemies.some((e) => e.boss)) this.maybeTip('boss');
      // a hellhound special round
      if (s.dogRound) this.maybeTip('doground');
      // the shared Zed-Time meter is full and ready
      if (s.zedCharge >= 1) this.maybeTip('zedtime');
    }
    // advance the queue (age the current tip, promote the next) and render it
    tickTipQueue(this.tipQueue, dt);
    const cur = this.tipQueue.current;
    if (cur) {
      // fade out over the last 0.6 s so dismissal reads as intentional, not a pop
      const fade = Math.min(1, cur.life / 0.6);
      this.tipText.setText(cur.text).setVisible(true).setAlpha(fade);
    } else {
      this.tipText.setVisible(false);
    }
  }

  /**
   * B5 — fire a one-shot mood stinger, deduped by a shared cooldown so a burst of
   * transitions (e.g. two bosses at once) can't stack stingers into a wall of noise.
   * Guarded by `cache.audio.exists` via sfx(); never plays before the audio loads.
   */
  private stinger(key: (typeof SOUNDS)[number], volume: number, rate = 1): void {
    if (this.stingerCd > 0) return;
    this.sfx(key, volume, rate);
    this.stingerCd = 1.6; // s until another mood stinger may play
  }

  /**
   * B5 — client-side dynamic soundtrack. Reads the already-serialized AI-Director
   * `state.intensity` (0..1) locally and drives the persistent `music_tension`
   * layer's volume (silent when calm → up to a capped max at peak), smoothly
   * lerped each frame so nothing jumps. The base bed swells slightly at the top
   * end. Ducks the tension layer under the near-death heartbeat so the two don't
   * pile up. Pure math lives in ./music (unit-tested); this only applies it.
   */
  private updateDynamicMusic(dt: number): void {
    if (!this.tensionMusic) this.tensionMusic = this.sound.get('music_tension') ?? undefined;
    const intensity = Math.max(0, Math.min(1, this.state.intensity ?? 0));
    let tensionTarget = tensionVolume(intensity);
    if (this.heartbeat) tensionTarget *= 0.6; // duck under the heartbeat when near death
    const bedTarget = bedVolume(intensity);
    // Frame-rate-independent ease toward the targets (~0.7 s settle — musical, no pops).
    this.tensionVol = lerpTo(this.tensionVol, tensionTarget, dt, 0.7);
    this.bedVol = lerpTo(this.bedVol, bedTarget, dt, 0.7);
    const tension = this.tensionMusic as (Phaser.Sound.BaseSound & { setVolume?: (v: number) => void }) | undefined;
    if (tension && tension.isPlaying && tension.setVolume) tension.setVolume(this.tensionVol);
    const bed = this.sound.get('music') as (Phaser.Sound.BaseSound & { setVolume?: (v: number) => void }) | null;
    if (bed && bed.isPlaying && bed.setVolume) bed.setVolume(this.bedVol);
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
        this.shakeCam(110, 0.005);
        this.sfx('hurt', 0.55);
        this.caption('[hurt]');
      }
    }
    this.prevHp = p.hp;
    this.hurtFx = Math.max(0, this.hurtFx - dt * 2.0);
    // Red damage vignette, scaled by the flash setting (0 = no red flash — photosensitivity).
    this.hurtOverlay.setFillStyle(0xff1414, scaledFlash(this.hurtFx * 0.5, this.settings));

    // A9: Zed-Time — cool-blue slow-mo vignette + a one-shot pop on activation.
    const zedActive = this.state.zedTime > 0;
    if (zedActive && !this.prevZedActive) {
      // Full-screen activation flash, dimmed by the flash setting (skipped entirely at 0).
      const ff = scaledFlash(1, this.settings);
      if (ff > 0) this.cameras.main.flash(180, Math.round(30 * ff), Math.round(90 * ff), Math.round(200 * ff));
      this.sfx('whoosh', 0.6, 0.7); // deep, pitched-down time-dilation whoosh
      this.caption('[zed-time]');
      this.lightPulses.push({ x: p.pos.x, y: p.pos.y, life: 0.45, max: 0.45, size: 340 }); // radial shockwave
    }
    this.prevZedActive = zedActive;
    // Subtle breathing tint, also scaled by the flash setting (full-screen colour effect).
    const zedA = zedActive ? scaledFlash(0.13 + 0.05 * Math.sin(this.state.time * 8), this.settings) : 0;
    this.zedOverlay.setFillStyle(0x2b6bff, zedA);

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

    // B5 — mood stingers: shared cooldown ticks down so bursts can't spam.
    this.stingerCd = Math.max(0, this.stingerCd - dt);

    // boss spawn → caption + boss sting (rising edge on the live boss count)
    const bossCount = this.state.enemies.reduce((n, e) => (e.boss ? n + 1 : n), 0);
    if (bossCount > this.prevBossCount) {
      const b = this.state.enemies.find((e) => e.boss);
      this.caption(b ? `[${ZOMBIES[b.type].name.toUpperCase()} INCOMING]` : '[boss incoming]');
      this.stinger('sting_boss', 0.6); // dread hit under the boss bar reveal
    }
    this.prevBossCount = bossCount;

    // hellhound round begins → a rising snarl-driven stinger (ties to the HELLHOUNDS notice)
    if (this.state.dogRound && !this.prevDogRound) {
      this.stinger('snarl', 0.7, 0.7); // pitched down = a rising, ominous swell distinct from a live snarl
    }
    this.prevDogRound = this.state.dogRound;

    // B5 — reactive soundtrack mix (client-side, from the serialized Director intensity)
    this.updateDynamicMusic(dt);

    // doors opening → creak + minimap update
    const open = this.state.doors.filter((d) => d.open).length;
    if (open > this.prevOpenDoors) {
      this.sfx('door', 0.6);
      this.sfx('creak', 0.5, 0.9 + Math.random() * 0.3);
      this.caption('[door opens]');
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
        if (vol > 0.28) this.caption(near.type === 'hound' ? '[hellhound snarl]' : runner ? '[snarl]' : '[growl]');
      }
      this.growlCd = 1.3 + Math.random() * 3;
    }

    // sparse creepy atmosphere: a distant baby wail, knocking or a groan
    this.ambientCd -= dt;
    if (this.ambientCd <= 0 && !this.state.gameOver) {
      const pick = Math.random();
      if (pick < 0.4) { this.sfx('creak', 0.4, 0.8 + Math.random() * 0.4); this.caption('[creak]'); }
      else if (pick < 0.72) { this.sfx('knock', 0.5, 0.9 + Math.random() * 0.2); this.caption('[door knock]'); }
      else { this.sfx('baby', 0.32, 0.92 + Math.random() * 0.16); this.caption('[baby crying]'); }
      this.ambientCd = 11 + Math.random() * 17;
    }

    // melee swing / dash start → whoosh
    if (p.meleeSwing > this.prevMeleeSwing + 0.05) this.sfx('whoosh', 0.45);
    this.prevMeleeSwing = p.meleeSwing;
    if (p.dash.timeLeft > this.prevDashLeft + 0.05) this.sfx('whoosh', 0.3, 1.4);
    this.prevDashLeft = p.dash.timeLeft;

    // fresh hits → armored bodies SPARK (bullets ping off), everything else bleeds.
    // Spray/impact heft ride the LOCAL weapon's damage so a big gun reads as a big hit.
    const dmgFeel = GameScene.dmgFeel(WEAPONS[p.weapon].damage);
    let squelched = false;
    let hitKick = 0; // strongest per-hit camera kick this frame (max, not sum → no pile-up)
    for (const e of this.state.enemies) {
      if (e.hitFlash > 0.065) {
        // Impact punch (hit-stop, RENDER-ONLY): a brief squash-and-stretch on the struck
        // body + a tiny camera kick. The sim tick is never paused/scaled, so co-op stays
        // deterministic — this only tweens the Phaser sprite's scale.
        const img = this.enemySprites.get(e.id);
        if (img && img.visible) {
          const base = (ZOMBIES[e.type].radius * 4.7) / img.texture.getSourceImage().height;
          this.tweens.killTweensOf(img); // restart cleanly on rapid re-hits (no scale drift)
          img.setScale(base);
          this.tweens.add({ targets: img, scale: base * 1.18, duration: 34, yoyo: true, ease: 'Quad.easeOut' });
        }
        hitKick = Math.max(hitKick, Math.min(0.0022, 0.0011 * dmgFeel));
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
        const drops = Math.min(11, Math.round(6 * dmgFeel)); // bigger guns → bigger spray (capped for perf)
        for (let i = 0; i < drops; i++) {
          const a = dir + (Math.random() - 0.5) * 2.4;
          const dist = (20 + Math.random() * 44) * (0.85 + 0.35 * dmgFeel);
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
    if (hitKick > 0) this.kickCamera(46, hitKick); // one tiny kick per frame, hardest hit wins

    this.updateCaptions(dt); // age + fade the accessibility caption stack
  }

  /** A small permanent-ish blood stain on the floor (capped pool). */
  private stainFloor(x: number, y: number, r: number): void {
    const s = this.add.circle(x, y, r, 0x5a0e10, 0.7).setDepth(DEPTH_BLOOD);
    this.bloodDecals.push(s as unknown as Phaser.GameObjects.Image);
    if (this.bloodDecals.length > 160) this.bloodDecals.shift()!.destroy();
  }

  /** Death gore: a pool + flying flesh/bone gibs. `intensity` (render-only, ~0.7–2) scales
   *  the pool size + gib count/spread so a kill with a heavier gun sprays harder. */
  private spawnGore(x: number, y: number, intensity = 1): void {
    const pool = this.add.image(x, y, 'blood').setDepth(DEPTH_BLOOD).setAlpha(0.85).setRotation(Math.random() * 6.28);
    this.setSpriteHeight(pool, (40 + Math.random() * 24) * (0.9 + 0.2 * intensity));
    this.bloodDecals.push(pool);
    if (this.bloodDecals.length > 160) this.bloodDecals.shift()!.destroy();
    const gibs = Math.min(14, Math.round(9 * intensity)); // capped so the RPG doesn't flood the pool
    for (let i = 0; i < gibs; i++) {
      const a = Math.random() * 6.28;
      const dist = (24 + Math.random() * 60) * (0.85 + 0.35 * intensity);
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
    // co-op ping blips on the minimap, kind-coloured, fading with the ping's ttl
    for (const pg of this.state.pings) {
      this.minimapDot.fillStyle(PING_KIND_COLOR[pg.kind] ?? 0xffffff, Math.min(1, pg.ttl / 1.2));
      this.minimapDot.fillCircle(mx + pg.x * scale, my + pg.y * scale, 2);
    }
    // highlight remaining enemies (<= 3) when wave is active so players don't get stuck searching
    if (this.state.wave.phase === 'active' && this.state.enemies.length <= 3) {
      this.minimapDot.fillStyle(0xff3333, 1);
      for (const e of this.state.enemies) {
        this.minimapDot.fillCircle(mx + e.pos.x * scale, my + e.pos.y * scale, 2.2);
      }
    }
  }

  /**
   * World-space co-op ping markers: a kind-coloured chevron + dot tinted with the
   * owner's TEAM_TINT and a short label, bobbing and fading as the ping's ttl runs
   * out. Pooled by ping id; nothing lingers once the ping expires on the sim side.
   */
  private syncPings(): void {
    const seen = new Set<number>();
    const t = this.state.time;
    for (const p of this.state.pings) {
      seen.add(p.id);
      const kc = PING_KIND_COLOR[p.kind] ?? 0xffffff;
      const oc = TEAM_TINT[p.owner % 4];
      let node = this.pingNodes.get(p.id);
      if (!node) {
        // chevron points DOWN at the pinged spot; label sits above it
        const chevron = this.add.triangle(p.x, p.y, 0, 0, 16, 0, 8, 13, kc, 1).setDepth(DEPTH_HUD - 4);
        const dot = this.add.circle(p.x, p.y, 5, kc, 0.85).setStrokeStyle(2, oc, 1).setDepth(DEPTH_HUD - 4);
        const label = this.add
          .text(p.x, p.y, PING_KIND_LABEL[p.kind] ?? '', { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold' })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH_HUD - 4);
        node = { chevron, dot, label };
        this.pingNodes.set(p.id, node);
      }
      const bob = Math.sin(t * 5 + p.id) * 3;
      const a = Math.min(1, p.ttl / 1.2); // fade out over the final ~1.2s
      const cc = '#' + kc.toString(16).padStart(6, '0');
      node.chevron.setPosition(p.x, p.y - 22 + bob).setFillStyle(kc).setAlpha(a);
      node.dot.setPosition(p.x, p.y).setStrokeStyle(2, oc, a).setAlpha(a * 0.85);
      node.label.setPosition(p.x, p.y - 30 + bob).setText(PING_KIND_LABEL[p.kind] ?? '').setColor(cc).setAlpha(a);
    }
    for (const [id, n] of this.pingNodes) {
      if (!seen.has(id)) {
        n.chevron.destroy();
        n.dot.destroy();
        n.label.destroy();
        this.pingNodes.delete(id);
      }
    }
  }

  /**
   * Teammate status floating above each co-op ally: a small health bar in the
   * slot tint, a slot tag, and a clear DOWN / REVIVING indicator. Pooled by slot;
   * only drawn in co-op (players.length > 1). World-space so it tracks the ally.
   */
  private drawTeammateStatus(i: number, pl: PlayerState, px: number, py: number): void {
    let hud = this.teammateHud.get(i);
    if (!hud) {
      const back = this.add.rectangle(0, 0, 46, 5, 0x1a0505, 0.85).setDepth(DEPTH_HUD - 5);
      const fill = this.add.rectangle(0, 0, 46, 5, 0x4bd06a, 1).setOrigin(0, 0.5).setDepth(DEPTH_HUD - 5);
      const name = this.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold' })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH_HUD - 5);
      hud = { back, fill, name };
      this.teammateHud.set(i, hud);
    }
    const tint = TEAM_TINT[i % 4];
    const cc = '#' + tint.toString(16).padStart(6, '0');
    const by = py - 32;
    const frac = Math.max(0, Math.min(1, pl.hp / effectiveMaxHp(this.state)));
    hud.back.setPosition(px, by).setVisible(true);
    hud.fill.setPosition(px - 23, by).setVisible(true);
    hud.fill.width = 46 * frac;
    hud.fill.setFillStyle(pl.downed ? 0x6a1418 : frac < 0.3 ? 0xc23b3b : 0x4bd06a);
    const label = pl.downed
      ? pl.reviveProgress > 0
        ? `REVIVING ${Math.floor(pl.reviveProgress * 100)}%`
        : 'DOWN'
      : `P${i + 1}`;
    hud.name.setPosition(px, by - 5).setText(label).setColor(pl.downed ? '#ff6b80' : cc).setVisible(true);
  }

  /**
   * Screen-edge arrows pointing toward OFF-SCREEN heavy threats — bosses (bloater/
   * screamer + any boss) and hellhounds — so the squad gets warned before they
   * arrive. Kept in solo too. Pooled per enemy id, capped so a dog round can't
   * ring the whole screen.
   */
  private updateThreatArrows(): void {
    const view = this.cameras.main.worldView;
    const lp = this.local();
    const threats = this.state.enemies
      .filter((e) => (e.boss || e.type === 'hound') && !view.contains(e.pos.x, e.pos.y))
      .sort(
        (a, b) =>
          (a.pos.x - lp.pos.x) ** 2 + (a.pos.y - lp.pos.y) ** 2 - ((b.pos.x - lp.pos.x) ** 2 + (b.pos.y - lp.pos.y) ** 2),
      )
      .slice(0, 8);
    const seen = new Set<number>();
    for (const e of threats) {
      seen.add(e.id);
      const ang = Math.atan2(e.pos.y - lp.pos.y, e.pos.x - lp.pos.x);
      const ax = 480 + Math.cos(ang) * 430;
      const ay = 270 + Math.sin(ang) * 235;
      const color = e.boss ? 0xff8a3a : 0xff5a5a;
      let arrow = this.threatArrows.get(e.id);
      if (!arrow) {
        arrow = this.add.triangle(0, 0, 0, 16, 22, 16, 11, 0, color, 0.92).setScrollFactor(0).setDepth(DEPTH_HUD + 1);
        this.threatArrows.set(e.id, arrow);
      }
      const pulse = e.boss ? 0.75 + 0.25 * Math.sin(this.state.time * 8) : 0.9;
      arrow.setPosition(ax, ay).setRotation(ang + Math.PI / 2).setFillStyle(color).setAlpha(pulse).setVisible(true);
    }
    for (const [id, arrow] of this.threatArrows) {
      if (!seen.has(id)) {
        arrow.destroy();
        this.threatArrows.delete(id);
      }
    }
  }

  private renderState(alpha: number, dt: number): void {
    const players = this.state.players;
    const lp = this.local();
    const killFeel = GameScene.dmgFeel(WEAPONS[lp.weapon].damage); // render-only gore intensity from the local weapon
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
      const wskin = weaponSkin(src.weapon);
      wpn
        .setVisible(!src.downed)
        .setTexture(wskin.key)
        .setPosition(px + kx + Math.cos(src.aimAngle) * hand, py + ky + Math.sin(src.aimAngle) * hand)
        .setRotation(src.aimAngle);
      if (wskin.tint !== null) wpn.setTint(wskin.tint);
      else wpn.clearTint();
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

      // co-op teammate status floats above each ally (health bar + slot tag + downed state)
      if (players.length > 1 && !isLocal) this.drawTeammateStatus(i, pl, px, py);

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
    // retire teammate-status huds for slots no longer shown (solo, local, or dead)
    for (const [i, hud] of this.teammateHud) {
      if (players.length > 1 && i !== this.localIndex && players[i]?.alive) continue;
      hud.back.destroy();
      hud.fill.destroy();
      hud.name.destroy();
      this.teammateHud.delete(i);
    }

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
    // Rapid strobe drives the stalker's lunge tell — a menacing flicker, not a flat block.
    const windupStrobe = Math.sin(this.state.time * 42) > -0.35;
    this.syncSprites(
      this.enemySprites,
      this.state.enemies.map((e) => {
        const sp = guest ? this.smooth(this.smoothEnemy, e.id, e.pos.x, e.pos.y, dt) : e.pos;
        if (e.affix === 'volatile') this.volatileIds.add(e.id); // detonates on death (like a boomer)
        const winding = (e.windup ?? 0) > 0;
        return {
        id: e.id,
        x: sp.x,
        y: sp.y,
        texture: e.type,
        height: ZOMBIES[e.type].radius * 4.7,
        rotation: (e.vel.x || e.vel.y) ? Math.atan2(e.vel.y, e.vel.x) - ART_FACING : 0,
        visible: onScreen(e.pos.x, e.pos.y) && segmentClear(eye, e.pos, solids),
        // Hit-flash (white) always wins so hits stay readable; then boss telegraph;
        // then the special wind-up tells: stalker strobes red (about to pounce),
        // spitter glows acid-green (charging a glob you can still sidestep).
        tintFill: e.hitFlash > 0 ? 0xffffff
          : e.boss && e.boss.telegraph > 0 ? COLORS.telegraphTint
          : winding && e.type === 'stalker' && windupStrobe ? COLORS.stalkerWindup
          : winding && e.type === 'spitter' ? COLORS.spitterCharge
          : undefined,
        // elite colour-code (colour-blind-safe remap when a mode is on) — hit-flash still wins
        tint: e.affix ? affixTint(e.affix, AFFIXES[e.affix].tint, this.settings.colorblind) : undefined,
        wobble: e.boss ? 0.05 : 0.11, // shamble sway; heavier bodies sway less
        };
      }),
      (lastX, lastY, id, img) => {
        this.tweens.killTweensOf(img); // stop any in-flight impact-punch before the sprite dies
        if (img.texture.key === 'boomer' || this.volatileIds.has(id)) this.boomerExplode(lastX, lastY); // detonates on death
        this.spawnGore(lastX, lastY, killFeel); // pool + flying flesh/bone gibs, sprayed by weapon heft
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
    this.syncHighContrastOutlines(); // bright ring around every enemy when high-contrast is on
    this.syncDangerAuras(); // pulsing "about to blow" rings behind boomers / volatile elites
    this.syncTelegraphAudio(); // tension cue on the rising edge of a stalker / spitter wind-up

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
    // A9: Zed-Time charge meter — fills with kills, glows [X] READY when full,
    // and shows the live countdown while the slow-mo window is running.
    const zc = Math.max(0, Math.min(1, this.state.zedCharge));
    if (this.state.zedTime > 0) {
      this.zedMeterFill.width = 200;
      this.zedMeterFill.setFillStyle(0x8affff);
      this.zedMeterLabel.setText(`ZED-TIME ${this.state.zedTime.toFixed(1)}s`).setColor('#8affff').setAlpha(1);
    } else if (zc >= 1) {
      const glow = 0.55 + 0.45 * Math.sin(this.state.time * 6);
      this.zedMeterFill.width = 200;
      this.zedMeterFill.setFillStyle(0x6fd0ff);
      this.zedMeterLabel.setText('ZED-TIME  [X] READY').setColor('#bfe8ff').setAlpha(glow);
    } else {
      this.zedMeterFill.width = 200 * zc;
      this.zedMeterFill.setFillStyle(0x2b6bff);
      this.zedMeterLabel.setText(`ZED ${Math.floor(zc * 100)}%`).setColor('#6f9fd0').setAlpha(1);
    }
    const w = this.state.wave;
    const status = w.phase === 'intermission' ? `next in ${Math.ceil(w.timer)}s` : `${this.state.enemies.length} left`;
    const squad = this.state.players.filter((q) => q.alive).length;
    const squadTag = this.role === 'solo' ? '' : `  ·  squad ${squad}`;
    this.hud.setText(`WAVE ${w.index}  ·  ${status}  ·  kills ${w.killsThisWave}${squadTag}`);

    const ammo = def.startAmmo === undefined ? '∞' : String(Math.ceil(lp.ammo[def.id] ?? 0));
    const slots = lp.owned.map((id, i) => `${i + 1}:${WEAPONS[id].name}${id === lp.weapon ? '*' : ''}`).join('  ');
    const hudSkin = weaponSkin(lp.weapon);
    this.weaponIcon.setTexture(hudSkin.key);
    if (hudSkin.tint !== null) this.weaponIcon.setTint(hudSkin.tint);
    else this.weaponIcon.clearTint();
    this.setSpriteHeight(this.weaponIcon, 34);
    // B7 — show the held weapon's Pack-a-Punch tier ("SMG ✦II") so the chase is legible.
    const tier = this.state.papTier[lp.weapon] ?? 0;
    const papTag = tier > 0 ? ` ✦${PAP_ROMAN[tier]}` : '';
    // A6 — show unspent catalysts so the player knows an evolution is fuelled.
    const cat = lp.catalysts > 0 ? `   ◈x${lp.catalysts}` : '';
    this.weaponHud.setText(`${def.name}${papTag}  [${ammo}]${cat}     ${slots}`);

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

    // Downed feedback: dark vignette + a centered prompt showing self-revive state.
    if (lp.downed && lp.alive) {
      this.downOverlay.setAlpha(0.34);
      const pct = Math.floor(lp.reviveProgress * 100);
      const charges = lp.selfReviveCharges;
      const line =
        this.role === 'solo'
          ? charges > 0
            ? `DOWNED — QUICK REVIVE ${pct}%\nself-revives left: ${charges}`
            : `DOWNED — NO REVIVES LEFT\nbleeding out: ${Math.ceil(lp.bleedout)}s`
          : `DOWNED — WAIT FOR A TEAMMATE\nbleeding out: ${Math.ceil(lp.bleedout)}s`;
      this.downedHud.setText(line).setVisible(true);
    } else {
      this.downOverlay.setAlpha(0);
      this.downedHud.setVisible(false);
    }

    if (this.dailyHud) this.dailyHud.setText(`DAILY · ${this.seed}   SCORE ${this.runScore()}`);
    this.updateShopUI();
    this.updateDraftUI();
    this.updateExtractionHud(dt);
    this.updateCodRender();
    this.updateDeployRender(); // A7: barricades (+hp bars), traps, build bar + placement preview
    this.syncPings(); // world-space co-op ping markers
    this.updateThreatArrows(); // screen-edge arrows toward off-screen bosses/hounds

    if (this.state.gameOver && !this.overlay) {
      // Meta-progression: award run currency exactly once (the !this.overlay guard —
      // the overlay is created just below and gates this whole block per run). Stored
      // in the localStorage profile, OUTSIDE GameState / the netcoded snapshot.
      const reward = runReward(this.state.wave.index, this.state.totalKills);
      addCurrency(reward);
      const won = this.state.won;
      const head = won ? 'YOU ESCAPED' : 'YOU DIED';
      const seeded = !!this.seed;
      // Seeded run: compute the score, persist the local best for this seed, and
      // surface both on the end screen (+ a copyable seed for sharing a run).
      const scoreLines = seeded
        ? (() => {
            const score = this.runScore();
            const best = recordScore(this.seed!, score);
            return `\n\nSCORE ${score}    BEST ${best}\n${this.seed}`;
          })()
        : '';
      this.overlay = this.add
        .text(480, seeded ? 250 : 270, `${head}${scoreLines}\n\n[R] ${won ? 'play again' : 'restart'}`, {
          fontFamily: 'monospace',
          fontSize: seeded ? '34px' : '48px',
          color: won ? '#7dffa0' : '#c23b3b',
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_HUD);
      if (seeded) {
        // click-to-copy the seed string so players can share/challenge a run
        const copy = this.add
          .text(480, 400, '⧉ click to copy seed', { fontFamily: 'monospace', fontSize: '15px', color: '#8affbf' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(DEPTH_HUD)
          .setInteractive({ useHandCursor: true });
        copy.on('pointerdown', () => {
          void navigator.clipboard?.writeText(this.seed!);
          copy.setText('✓ seed copied');
        });
      }
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
    const ptr = this.input.activePointer;
    const canBanish = this.state.cash >= BANISH_COST;
    // B6 rarity tint: common grey/green, rare blue, legendary gold (border + title + label)
    const RARITY = {
      common: { hex: 0x3ea45a, css: '#8fef9f' },
      rare: { hex: 0x4a8fe0, css: '#8fc4ff' },
      legendary: { hex: 0xffd45e, css: '#ffe08a' },
    } as const;
    this.draftCards.forEach((card, i) => {
      const opt = draft[i];
      const id = opt?.id as PerkId | undefined;
      const shown = !!(id && opt);
      card.bg.setVisible(shown);
      if (id && opt) {
        const rc = RARITY[opt.rarity];
        card.bg.setStrokeStyle(2, rc.hex);
        card.title.setColor(rc.css);
      }
      card.title.setVisible(shown).setText(id ? PERKS[id].name : '');
      const lvl = id ? this.state.perks[id] ?? 0 : 0;
      const n = opt ? LEVELS_FOR[opt.rarity] : 0;
      card.body
        .setVisible(shown)
        .setText(id && opt ? `${PERKS[id].desc}\n\n${opt.rarity.toUpperCase()}  +${n} lvl${lvl > 0 ? `  ·  owned ×${lvl}` : ''}` : '');
      // banish ✕: bright when affordable + hovered, dim otherwise
      const bHover = canBanish && !!this.banishHit[i] && GameScene.hit(ptr.x, ptr.y, this.banishHit[i]);
      card.banish.setVisible(shown).setColor(!canBanish ? '#4a3d3b' : bHover ? '#ff7a6e' : '#c0554d');
    });
    // reroll button: cost label + affordability styling
    const cost = rerollCost(this.state);
    const afford = this.state.cash >= cost;
    const rHover = !!this.rerollHit && GameScene.hit(ptr.x, ptr.y, this.rerollHit);
    this.rerollBtn.label.setText(`REROLL  $${cost}`).setColor(afford ? '#cfe8d4' : '#5a6b60');
    this.rerollBtn.bg.setFillStyle(afford && rHover ? 0x1c3323 : 0x101a12).setAlpha(afford ? 1 : 0.5);
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
        this.shakeCam(120, 0.006);
        this.caption('[explosion]');
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
      const tint = affixTint(e.affix, AFFIXES[e.affix].tint, this.settings.colorblind); // colour-blind-safe remap
      let ring = this.affixAuras.get(e.id);
      if (!ring) {
        ring = this.add.circle(img.x, img.y, ZOMBIES[e.type].radius * 1.9, tint, 0.16).setDepth(DEPTH_BLOOD + 0.5);
        this.affixAuras.set(e.id, ring);
      }
      const pulse = 0.9 + 0.16 * Math.sin(t * 4 + e.id); // gentle breathe
      ring.setPosition(img.x, img.y).setScale(pulse).setFillStyle(tint, 0.16);
      // Letter tag so the affix is distinguishable WITHOUT hue (never colour-only).
      // Only shown in a colour-blind mode — defaults keep the current clean look.
      if (this.settings.colorblind !== 'off') {
        let tag = this.affixTags.get(e.id);
        if (!tag) {
          tag = this.add
            .text(img.x, img.y, AFFIX_TAG[e.affix], { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })
            .setOrigin(0.5)
            .setDepth(DEPTH_BLOOD + 0.6);
          this.affixTags.set(e.id, tag);
        }
        tag.setPosition(img.x, img.y - ZOMBIES[e.type].radius * 2.1);
      }
    }
    for (const [id, ring] of this.affixAuras) {
      if (!seen.has(id)) {
        ring.destroy();
        this.affixAuras.delete(id);
        this.affixTags.get(id)?.destroy();
        this.affixTags.delete(id);
      }
    }
  }

  /**
   * High-contrast aid: a bright thin ring around every on-screen enemy so bodies
   * pop against the dark, low-glare floor. Pure render, pooled by enemy id, and a
   * no-op (pool cleared) unless the high-contrast setting is on.
   */
  private syncHighContrastOutlines(): void {
    const seen = new Set<number>();
    if (this.settings.highContrast) {
      for (const e of this.state.enemies) {
        const img = this.enemySprites.get(e.id);
        if (!img || !img.visible) continue;
        seen.add(e.id);
        const r = ZOMBIES[e.type].radius * 1.35;
        let ring = this.hcOutlines.get(e.id);
        if (!ring) {
          ring = this.add.circle(img.x, img.y, r, 0xffffff, 0).setStrokeStyle(2, 0xffffff, 0.85).setDepth(DEPTH_BLOOD + 0.7);
          this.hcOutlines.set(e.id, ring);
        }
        ring.setPosition(img.x, img.y).setRadius(r);
      }
    }
    for (const [id, ring] of this.hcOutlines) {
      if (!seen.has(id)) {
        ring.destroy();
        this.hcOutlines.delete(id);
      }
    }
  }

  /**
   * Persistent PULSING danger ring behind anything that detonates on death
   * (boomers + volatile elites), sized to the blast radius so players read
   * "don't melee this point-blank" at a glance. Pure render — keyed off type /
   * affix, pooled by enemy id, throbbing harder/faster than the elite aura.
   */
  private syncDangerAuras(): void {
    const t = this.state.time;
    const seen = new Set<number>();
    for (const e of this.state.enemies) {
      if (!(e.type === 'boomer' || affixExplodesOnDeath(e))) continue;
      const img = this.enemySprites.get(e.id);
      if (!img || !img.visible) continue; // hidden in the dark → no aura
      seen.add(e.id);
      let ring = this.dangerAuras.get(e.id);
      if (!ring) {
        ring = this.add.circle(img.x, img.y, ZOMBIES[e.type].radius * 2.3, COLORS.dangerAura, 0.14).setDepth(DEPTH_BLOOD + 0.4);
        this.dangerAuras.set(e.id, ring);
      }
      const beat = 0.5 + 0.5 * Math.sin(t * 7 + e.id); // fast, urgent throb
      ring.setPosition(img.x, img.y).setScale(0.85 + 0.3 * beat).setFillStyle(COLORS.dangerAura, 0.1 + 0.14 * beat);
    }
    for (const [id, ring] of this.dangerAuras) {
      if (!seen.has(id)) {
        ring.destroy();
        this.dangerAuras.delete(id);
      }
    }
  }

  /**
   * Sound the tension cue the instant an enemy commits to a telegraphed wind-up
   * (rising edge only, so it fires once per wind-up). Stalker → a sharp high
   * snarl ("it's about to pounce"); spitter → a low charging growl. Volume
   * falls off with distance from the local player.
   */
  private syncTelegraphAudio(): void {
    const p = this.local();
    const now = new Set<number>();
    for (const e of this.state.enemies) {
      if ((e.windup ?? 0) <= 0 || (e.type !== 'stalker' && e.type !== 'spitter')) continue;
      now.add(e.id);
      if (this.chargingIds.has(e.id)) continue; // already cued this wind-up
      const dist = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
      const vol = Math.max(0, (e.type === 'stalker' ? 0.6 : 0.42) * (1 - dist / 820));
      if (vol > 0.04) {
        if (e.type === 'stalker') this.sfx('snarl', vol, 1.55); // high, sharp — coiling to pounce
        else this.sfx('growl', vol, 0.6); // low, guttural — charging acid
      }
    }
    this.chargingIds = now;
  }

  /** Boomer death detonation — orange blast, shake, light flash. */
  private boomerExplode(x: number, y: number): void {
    const boom = this.add.image(x, y, 'explosion').setAlpha(0.95).setTint(0xff7a3a);
    this.setSpriteHeight(boom, 110);
    this.tweens.add({ targets: boom, alpha: 0, scale: boom.scale * 1.6, duration: 280, onComplete: () => boom.destroy() });
    this.shakeCam(120, 0.005);
    this.lightPulses.push({ x, y, life: 0.26, max: 0.26, size: 280 });
    this.sfx('explosion', 0.5);
    this.caption('[explosion]');
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
