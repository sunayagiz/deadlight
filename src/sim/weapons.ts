import type { GameState, PlayerInput, PlayerState, Vec2, Wall, WeaponId } from './types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  fireRate: number; // shots per second
  bulletSpeed: number; // px/s
  bulletTtl: number; // seconds
}

/** Data-driven weapon table (design spec §4.2). New weapon = new row, not a new class. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    damage: 25,
    fireRate: 4,
    bulletSpeed: 900,
    bulletTtl: 0.8,
  },
};

export function updateAim(p: PlayerState, input: PlayerInput): void {
  p.aimAngle = Math.atan2(input.aimWorldY - p.pos.y, input.aimWorldX - p.pos.x);
}

export function updateFiring(state: GameState, input: PlayerInput, dt: number): void {
  const p = state.player;
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  if (!input.fire || p.fireCooldown > 0) return;

  const w = WEAPONS[p.weapon];
  state.bullets.push({
    id: state.nextBulletId++,
    pos: { x: p.pos.x, y: p.pos.y },
    vel: { x: Math.cos(p.aimAngle) * w.bulletSpeed, y: Math.sin(p.aimAngle) * w.bulletSpeed },
    ttl: w.bulletTtl,
    damage: w.damage,
  });
  p.fireCooldown = 1 / w.fireRate;
}

function insideWall(pos: Vec2, walls: Wall[]): boolean {
  return walls.some((w) => pos.x > w.x && pos.x < w.x + w.w && pos.y > w.y && pos.y < w.y + w.h);
}

export function updateBullets(state: GameState, dt: number): void {
  for (const b of state.bullets) {
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.ttl -= dt;
  }
  state.bullets = state.bullets.filter((b) => b.ttl > 0 && !insideWall(b.pos, state.walls));
}
