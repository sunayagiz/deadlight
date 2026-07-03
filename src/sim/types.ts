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
  | 'chainsaw';

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
  reviveProgress: number; // 0..1 while a teammate is reviving this one
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
  kind: 'weapon' | 'ammo';
  weapon: WeaponId; // which weapon this grants, or which weapon's ammo
  amount: number; // ammo count (ignored for weapon pickups)
  ttl: number; // seconds before it despawns
}

export type EnemyType = 'shambler' | 'runner' | 'brute' | 'bloater' | 'screamer';

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

export type WavePhase = 'intermission' | 'active';

export interface WaveState {
  index: number; // 1-based; the wave currently running or being counted down to
  phase: WavePhase;
  timer: number; // seconds left in the current intermission (unused while active)
  spawnQueue: EnemyType[]; // enemies still to spawn this wave
  spawnCooldown: number; // seconds until the next spawn
  killsThisWave: number;
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
  wave: WaveState;
  spawnZones: SpawnZone[];
  walls: Wall[];
  doors: Door[];
  gameOver: boolean;
  won: boolean; // true = the squad escaped (extraction complete)
  cash: number; // shared squad currency, spent in the between-wave shop
  perks: Record<string, number>; // shared squad perk levels (perk id → stacks)
  perkDraft: string[] | null; // 3 perk ids offered right now, or null when no draft is pending
  extractPoint: { x: number; y: number }; // static exit location (from the map; off-wire)
  extraction: ExtractionState | null; // live escape progress once the final wave begins
}
