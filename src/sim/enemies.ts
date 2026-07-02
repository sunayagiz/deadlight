import { ENEMY_SEPARATION_FORCE, ENEMY_SEPARATION_RADIUS } from '../config';
import { sampleFlow, type FlowField } from './flowfield';
import { norm } from './vec';
import type { EnemyState, EnemyType, GameState, PlayerState, SpawnZone, Wall } from './types';

export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  speed: number; // px/s
  radius: number;
  contactDamage: number; // damage-per-second while touching a player
  cost: number; // wave-budget cost (0 for bosses; they are spawned directly)
  boss?: boolean;
}

/** Data-driven enemy table (design spec / slice-2 spec). New enemy = new row, not a new class. */
export const ZOMBIES: Record<EnemyType, EnemyDef> = {
  shambler: { type: 'shambler', name: 'Shambler', hp: 60, speed: 55, radius: 13, contactDamage: 18, cost: 1 },
  runner: { type: 'runner', name: 'Runner', hp: 30, speed: 130, radius: 10, contactDamage: 12, cost: 2 },
  brute: { type: 'brute', name: 'Brute', hp: 220, speed: 42, radius: 20, contactDamage: 35, cost: 5 },
  bloater: { type: 'bloater', name: 'Bloater', hp: 900, speed: 40, radius: 30, contactDamage: 40, cost: 0, boss: true },
  screamer: { type: 'screamer', name: 'Screamer', hp: 650, speed: 72, radius: 26, contactDamage: 25, cost: 0, boss: true },
};

export function isBoss(type: EnemyType): boolean {
  return ZOMBIES[type].boss === true;
}

export function spawnEnemy(state: GameState, type: EnemyType, zone: SpawnZone): EnemyState {
  const def = ZOMBIES[type];
  const e: EnemyState = {
    id: state.nextEnemyId++,
    type,
    pos: { x: zone.x, y: zone.y },
    vel: { x: 0, y: 0 },
    hp: def.hp,
    hitFlash: 0,
    ...(def.boss ? { boss: { attackCd: 1.5, telegraph: 0, pending: null } } : {}),
  };
  state.enemies.push(e);
  return e;
}

function hitWall(x: number, y: number, r: number, walls: Wall[]): Wall | undefined {
  return walls.find(
    (w) => x + r > w.x && x - r < w.x + w.w && y + r > w.y && y - r < w.y + w.h,
  );
}

/** Steer away from nearby enemies so a swarm doesn't collapse into one point. */
function separation(e: EnemyState, enemies: EnemyState[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const other of enemies) {
    if (other === e) continue;
    const dx = e.pos.x - other.pos.x;
    const dy = e.pos.y - other.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0 && d2 < ENEMY_SEPARATION_RADIUS * ENEMY_SEPARATION_RADIUS) {
      const d = Math.sqrt(d2);
      sx += dx / d;
      sy += dy / d;
    }
  }
  return { x: sx, y: sy };
}

export function updateEnemies(
  enemies: EnemyState[],
  player: PlayerState,
  walls: Wall[],
  dt: number,
  flow?: FlowField,
): void {
  for (const e of enemies) {
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    const def = ZOMBIES[e.type];

    // Route via the flow field (handles rooms/doors); fall back to straight
    // seek when off-grid or unreachable. Separation keeps the horde spread.
    const seek =
      (flow && sampleFlow(flow, e.pos.x, e.pos.y)) ??
      norm({ x: player.pos.x - e.pos.x, y: player.pos.y - e.pos.y });
    const sep = separation(e, enemies);
    const desired = norm({
      x: seek.x * def.speed + sep.x * ENEMY_SEPARATION_FORCE,
      y: seek.y * def.speed + sep.y * ENEMY_SEPARATION_FORCE,
    });
    e.vel = { x: desired.x * def.speed, y: desired.y * def.speed };

    // Per-axis AABB wall collision (same model as the player).
    let nx = e.pos.x + e.vel.x * dt;
    const wx = hitWall(nx, e.pos.y, def.radius, walls);
    if (wx) nx = e.vel.x > 0 ? wx.x - def.radius : wx.x + wx.w + def.radius;
    e.pos.x = nx;

    let ny = e.pos.y + e.vel.y * dt;
    const wy = hitWall(e.pos.x, ny, def.radius, walls);
    if (wy) ny = e.vel.y > 0 ? wy.y - def.radius : wy.y + wy.h + def.radius;
    e.pos.y = ny;
  }
}
