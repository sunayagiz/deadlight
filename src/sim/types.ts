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
  player: PlayerState;
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
}
