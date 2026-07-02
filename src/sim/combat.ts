import { PLAYER_RADIUS } from '../config';
import { ZOMBIES } from './enemies';
import { dropLoot } from './loot';
import { mapSolids } from './map';
import { isInvulnerable } from './movement';
import type { BulletState, GameState, Vec2, Wall } from './types';

const HIT_FLASH = 0.08; // seconds an enemy flashes white after taking a hit

function insideWall(pos: Vec2, walls: Wall[]): boolean {
  return walls.some((w) => pos.x > w.x && pos.x < w.x + w.w && pos.y > w.y && pos.y < w.y + w.h);
}

function firstEnemyHit(state: GameState, b: BulletState) {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const r = ZOMBIES[e.type].radius;
    const dx = b.pos.x - e.pos.x;
    const dy = b.pos.y - e.pos.y;
    if (dx * dx + dy * dy <= r * r) return e;
  }
  return undefined;
}

/** Area damage to every enemy in radius, plus the player if caught in the blast (RPG self-harm). */
function explode(state: GameState, at: Vec2, radius: number, damage: number): void {
  const r2 = radius * radius;
  for (const e of state.enemies) {
    const dx = e.pos.x - at.x;
    const dy = e.pos.y - at.y;
    if (dx * dx + dy * dy <= r2) {
      e.hp -= damage;
      e.hitFlash = HIT_FLASH;
    }
  }
  const p = state.player;
  if (p.hp > 0 && !isInvulnerable(p)) {
    const dx = p.pos.x - at.x;
    const dy = p.pos.y - at.y;
    if (dx * dx + dy * dy <= r2) p.hp -= damage * 0.5; // self-damage risk, halved
  }
}

/**
 * Resolve all damage for one tick, using final post-movement positions.
 * Order: bullets (hit / wall / expire, with explosions), clear the dead,
 * then living enemies deal contact damage to a non-dashing player.
 */
export function updateCombat(state: GameState, dt: number, rng: () => number = Math.random): void {
  const solids = mapSolids(state);
  const surviving: BulletState[] = [];
  for (const b of state.bullets) {
    const hit = firstEnemyHit(state, b);
    const blocked = insideWall(b.pos, solids);
    const expired = b.ttl <= 0;

    if (hit) {
      hit.hp -= b.damage;
      hit.hitFlash = HIT_FLASH;
    }
    if (hit || blocked || expired) {
      if (b.splashRadius > 0) explode(state, b.pos, b.splashRadius, b.splashDamage);
      continue; // bullet consumed
    }
    surviving.push(b);
  }
  state.bullets = surviving;

  // Clear the dead, tally kills, and let each corpse maybe drop loot.
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp > 0) {
      alive.push(e);
    } else {
      state.wave.killsThisWave += 1;
      dropLoot(state, e.pos, rng);
    }
  }
  state.enemies = alive;

  // Enemy contact damage (DPS) — dash i-frames make the player immune.
  const p = state.player;
  if (p.hp > 0 && !isInvulnerable(p)) {
    for (const e of state.enemies) {
      const def = ZOMBIES[e.type];
      const rr = def.radius + PLAYER_RADIUS;
      const dx = p.pos.x - e.pos.x;
      const dy = p.pos.y - e.pos.y;
      if (dx * dx + dy * dy <= rr * rr) p.hp -= def.contactDamage * dt;
    }
  }

  if (p.hp <= 0) {
    p.hp = 0;
    state.gameOver = true;
  }
}
