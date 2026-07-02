export interface Vec2 {
  x: number;
  y: number;
}

/** Everything the simulation is allowed to know about a player's intent for one tick. */
export interface PlayerInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimX: number; // cursor position in world coords
  aimY: number;
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

/** Axis-aligned solid rectangle. */
export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Serializable plain data — this is what will go over the wire in the netcode slice. */
export interface GameState {
  time: number;
  player: PlayerState;
  bullets: BulletState[];
  nextBulletId: number;
  walls: Wall[];
}
