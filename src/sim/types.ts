export interface Vec2 {
  x: number;
  y: number;
}

/** Everything the simulation is allowed to know about a player's intent for one tick. */
export interface PlayerInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimWorldX: number; // cursor position in world coords
  aimWorldY: number;
  fire: boolean;
  dash: boolean;
  sprint: boolean;
  weaponSlot: number; // equip owned[slot] this tick; -1 = no change
  weaponCycle: number; // cycle owned weapons: -1 prev, +1 next, 0 none
  buy: number; // shop purchase index this tick (intermission only); -1 = none
  perk: number; // perk-draft choice this tick (0..PERK_CHOICES-1); -1 = none
  reroll: boolean; // reroll the current perk draft for cash this tick (intermission only)
  banish: number; // banish draft option i (0..PERK_CHOICES-1) from the run's pool; -1 = none
  use: boolean; // interact with the nearest buyable (door/box/PaP/wall/power) this tick
  ability: boolean; // A9: trigger Zed-Time this tick (fires only when the shared meter is full)
  ping: { x: number; y: number } | null; // world point the player pinged this tick; null = no ping
  place: { x: number; y: number; kind: DeployableKind } | null; // A7: request to build a deployable at a world point; null = none
}

/**
 * B6 — draft rarity tier (RoR2 / Killing-Floor style). Each draft option rolls a
 * rarity via the threaded rng; the rarity decides HOW MANY perk levels the pick
 * grants (see LEVELS_FOR in config). Weighted heavily toward `common`.
 */
export type Rarity = 'common' | 'rare' | 'legendary';

/** A single perk-draft option: a perk id plus the rarity it rolled this draft. */
export interface DraftOption {
  id: string; // PerkId
  rarity: Rarity;
}

/** A7 — buildable defence the squad spends points to place (host-authoritative). */
export type DeployableKind = 'barricade' | 'trap';

/**
 * A placed deployable. A barricade is SOLID (folds into mapSolids, so pathing /
 * bullets / LOS all route around it) and has `hp` enemies chew through. A trap is
 * an armed electric floor zone (not solid) that pulses damage on a `cd`.
 * Host-authoritative and serialized so every client renders it.
 */
export interface Deployable {
  id: number;
  kind: DeployableKind;
  x: number;
  y: number;
  hp?: number; // barricade: structure left (removed at 0)
  cd?: number; // trap: seconds until it can zap again
  owner: number; // player slot that placed it
}

/** Apex-style ping kind — auto-chosen by the host from what's near the ping point. */
export type PingKind = 'enemy' | 'loot' | 'go' | 'danger';

/** A live co-op ping in the world. Host-authoritative, serialized so every client renders it. */
export interface PingState {
  id: number;
  x: number;
  y: number;
  kind: PingKind;
  owner: number; // player slot that placed it (drives the TEAM_TINT)
  ttl: number; // seconds left before it fades out
}

export type WeaponId =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'machinegun'
  | 'minigun'
  | 'rpg'
  | 'katana'
  | 'bat'
  | 'chainsaw'
  | 'raygun' // wonder weapon — Mystery Box only
  // ── Evolved super-weapons (A6): a Pack-a-Punched base + a catalyst evolves here.
  // Not sold or box-rolled directly; only reachable through the evolution recipe.
  | 'wunderwaffe' // raygun evolved — chain-splash energy cannon
  | 'dragonsbreath' // shotgun evolved — incendiary flak that clears crowds
  | 'deathmachine'; // minigun evolved — a walking wall of lead

export type WeaponKind = 'gun' | 'rpg' | 'melee';

export interface PlayerState {
  pos: Vec2;
  vel: Vec2;
  aimAngle: number; // radians
  hp: number;
  weapon: WeaponId; // currently equipped
  owned: WeaponId[]; // everything the player can switch to
  ammo: Record<string, number>; // reserve for limited weapons; absent = infinite
  spin: number; // minigun spin-up, 0..1
  meleeSwing: number; // seconds left in the current melee swing (view + re-hit gate)
  fireCooldown: number; // seconds until next shot/swing allowed
  dash: {
    timeLeft: number; // >0 means currently dashing (i-frames)
    cooldownLeft: number;
    dirX: number;
    dirY: number;
  };
  // co-op state
  alive: boolean; // false = fully dead (bled out), a spectator
  downed: boolean; // true = on the ground, revivable by a teammate
  bleedout: number; // seconds left before a downed player dies
  reviveProgress: number; // 0..1 while a teammate (or a solo self-revive) is reviving this one
  selfReviveCharges: number; // solo "Quick Revive" charges left; a downed solo player self-revives while >0
  catalysts: number; // A6: unspent Weapon Catalyst tokens — each fuels one weapon evolution at Pack-a-Punch (serialized wholesale with the player)
}

/** A player is a live combat threat only while up. */
export function isUp(p: PlayerState): boolean {
  return p.alive && !p.downed;
}

export interface BulletState {
  id: number;
  pos: Vec2;
  vel: Vec2;
  ttl: number; // seconds
  damage: number;
  splashRadius: number; // 0 = non-explosive
  splashDamage: number;
  hostile: boolean; // true = enemy projectile that damages the player
  owner: number; // firing player's slot (-1 = enemy/hostile); used for life-steal credit
}

export interface LootState {
  id: number;
  pos: Vec2;
  kind: 'ammo' | 'health'; // zombies only drop ammo boxes and health packs
  amount: number; // health: HP restored; ammo: unused (generic resupply)
  ttl: number; // seconds before it despawns
}

export type EnemyType =
  | 'shambler'
  | 'runner'
  | 'brute'
  | 'bloater'
  | 'screamer'
  | 'hound'
  | 'spitter' // ranged: keeps its distance and lobs acid
  | 'boomer' // fast rusher that explodes on death
  | 'stalker' // lean lurker that periodically lunges
  | 'armored'; // riot-plated: shrugs off bullets, cut down only by melee

/**
 * Elite modifier (Risk of Rain 2 style): a fraction of spawned enemies carry one,
 * tweaking their stats and sometimes adding an on-death effect. Data lives in affix.ts.
 */
export type AffixId = 'swift' | 'tank' | 'volatile' | 'shielded' | 'vampiric';

/** A fixed buyable in the world (COD-style): doors, Mystery Box, Pack-a-Punch, wall guns, power. */
export type InteractKind = 'mysterybox' | 'packapunch' | 'wallbuy' | 'power';

export interface Interactable {
  kind: InteractKind;
  x: number;
  y: number;
  cost: number;
  label: string;
  weapon?: WeaponId; // wall-buy: the gun sold here
  needsPower?: boolean; // Mystery Box / Pack-a-Punch stay dark until power is on
  boxUses?: number; // Mystery Box: spins so far (drives the teddy-bear relocate)
  homes?: { x: number; y: number }[]; // Mystery Box: the spots it can teleport between
}

export type PowerUpKind = 'maxammo' | 'instakill' | 'nuke' | 'doublepoints' | 'firesale';

/** A dropped power-up the players run over (COD drops). */
export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
  ttl: number;
}

export type BossAttack = 'spew' | 'spit' | 'summon';

export interface BossBrain {
  attackCd: number; // seconds until the next attack is chosen
  telegraph: number; // >0 = winding up (visual warning); attack fires when it hits 0
  pending: BossAttack | null;
}

export interface EnemyState {
  id: number;
  type: EnemyType;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  hitFlash: number; // seconds of hit-flash left — pure view hint, still part of sim state
  boss?: BossBrain; // present only on boss enemies
  cd?: number; // generic ability cooldown — spitter acid shot / stalker lunge
  windup?: number; // seconds left in a telegraphed wind-up (stalker brace before lunge / spitter charge before spit); serialized so clients render the tell
  lunge?: number; // stalker: seconds left in an active lunge (dash toward the player)
  affix?: AffixId; // elite modifier (stats + on-death effect); absent = a normal enemy
  maxHp?: number; // spawn HP (post-affix) — caps vampiric self-regen; present on affixed enemies
}

/** Axis-aligned solid rectangle. */
export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A door is a wall-shaped AABB that stops being solid (and see-through) once opened. */
export interface Door {
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
  minWave: number; // 0 = interior door (always openable); gate doors unlock at this wave
  cost: number; // 0 = auto-open on proximity; >0 = COD-style pay-to-open (needs `use`)
}

/** Where enemies enter the map. Never spawn on top of the players. */
export interface SpawnZone {
  x: number;
  y: number;
  minWave?: number; // zone activates at this wave (rooms behind gates)
}

/** The final-wave escape objective: reach the exit and hold it to win the run. */
export interface ExtractionState {
  x: number;
  y: number;
  progress: number; // seconds held so far (0..EXTRACT_HOLD)
}

/**
 * AI Director bookkeeping (host-internal pacing state). `intensity` itself lives
 * on GameState (serialized, client-facing); this holds only the cross-tick state
 * the Director needs to compute it. Not serialized — guests never run the sim.
 */
export interface DirectorState {
  peaked: boolean; // crested DIRECTOR_PEAK and not yet relaxed (arms the post-peak calm window)
  relaxT: number; // seconds left in the eased post-peak spawn window
  hpRef: number; // standing-squad HP at the end of last tick (damage-this-tick baseline)
}

export type WavePhase = 'intermission' | 'active';

export interface WaveState {
  index: number; // 1-based; the wave currently running or being counted down to
  phase: WavePhase;
  timer: number; // seconds left in the current intermission (unused while active)
  spawnQueue: EnemyType[]; // enemies still to spawn this wave
  spawnCooldown: number; // seconds until the next spawn
  killsThisWave: number;
  spawnCursor: number; // round-robins the spawn across zones so they don't cluster
}

/** Serializable plain data — this is what will go over the wire in the netcode slice. */
export interface GameState {
  time: number; // seconds
  mapW: number;
  mapH: number;
  players: PlayerState[]; // 1..4; host-authoritative
  player: PlayerState; // alias to players[0], kept live by the sim (host/solo convenience)
  bullets: BulletState[];
  nextBulletId: number;
  enemies: EnemyState[];
  nextEnemyId: number;
  loot: LootState[];
  nextLootId: number;
  pings: PingState[]; // active co-op pings (host-authoritative, serialized)
  nextPingId: number;
  wave: WaveState;
  spawnZones: SpawnZone[];
  walls: Wall[];
  doors: Door[];
  intensity: number; // AI Director stress accumulator, 0..1 (serialized; B5 dynamic music reads it)
  // ── A9: Zed-Time (shared slow-mo) — both serialized so every client slows identically ──
  zedTime: number; // seconds of slow-mo remaining (0 = off); counts down in REAL time
  zedCharge: number; // 0..1 charge meter; fills on kills, spent to 0 on activation
  director: DirectorState; // host-internal Director pacing bookkeeping (not serialized)
  gameOver: boolean;
  won: boolean; // true = the squad escaped (extraction complete)
  totalKills: number; // running kill tally across all waves (drives the run score)
  cash: number; // shared squad currency, spent in the between-wave shop
  perks: Record<string, number>; // shared squad perk levels (perk id → stacks)
  perkDraft: DraftOption[] | null; // PERK_CHOICES options (id + rolled rarity) offered right now, or null when no draft is pending
  rerollCount: number; // rerolls spent on the CURRENT draft (drives the rising reroll cost); resets per draft
  banished: string[]; // perk ids banished for the rest of the run; rollDraft excludes these forever
  extractPoint: { x: number; y: number }; // static exit location (from the map; off-wire)
  extraction: ExtractionState | null; // live escape progress once the final wave begins
  // ── COD-Zombies layer ──
  interactables: Interactable[]; // fixed buyables (box / PaP / wall guns / power)
  powerups: PowerUp[]; // dropped power-ups on the ground
  nextPowerUpId: number;
  powerOn: boolean; // has the power switch been flipped?
  instaKillT: number; // seconds of Insta-Kill left (every hit one-shots)
  doublePtsT: number; // seconds of Double Points left (all cash ×2)
  fireSaleT: number; // seconds of Fire Sale left (Mystery Box costs 10)
  papTier: Record<string, number>; // B7: weapon id → Pack-a-Punch tier (0 = un-packed, 1..3 = I/II/III)
  dogRound: boolean; // is the current wave a hellhound special round?
  notice: string; // transient announcer line ("MAX AMMO", "POWER ON", …)
  noticeT: number; // seconds the notice stays up
  boxReveal: { weapon: WeaponId; t: number } | null; // Mystery Box spin animation
  // ── A7: buildable defences ──
  deployables: Deployable[]; // placed barricades + traps (host-authoritative, serialized)
  nextDeployableId: number;
}
