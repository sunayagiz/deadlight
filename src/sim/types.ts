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

export type WeaponId = 'pistol';

export interface PlayerState {
  pos: Vec2;
  vel: Vec2;
  aimAngle: number; // radians
  hp: number;
  weapon: WeaponId;
  fireCooldown: number; // seconds until next shot allowed
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
}

export type EnemyType = 'shambler' | 'runner' | 'brute';

export interface EnemyState {
  id: number;
  type: EnemyType;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  hitFlash: number; // seconds of hit-flash left — pure view hint, still part of sim state
}

/** Axis-aligned solid rectangle. */
export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where enemies enter the map. Never spawn on top of the players. */
export interface SpawnZone {
  x: number;
  y: number;
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
  player: PlayerState;
  bullets: BulletState[];
  nextBulletId: number;
  enemies: EnemyState[];
  nextEnemyId: number;
  wave: WaveState;
  spawnZones: SpawnZone[];
  walls: Wall[];
  gameOver: boolean;
}
