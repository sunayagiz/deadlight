import { BULLET_KNOCKBACK, CASH_BOSS, CASH_PER_HIT, CASH_PER_KILL, PLAYER_RADIUS, POWERUP_DROP_CHANCE } from '../config';
import { cashMult, dropPowerUp, rollPowerUp } from './cod';
import { downPlayer } from './coop';
import { ZOMBIES } from './enemies';
import { dropLoot } from './loot';
import { mapSolids } from './map';
import { isInvulnerable } from './movement';
import { applyLifesteal, greedMult, thornsDamage } from './perks';
import { isUp, type BulletState, type GameState, type PlayerState, type Vec2, type Wall } from './types';

const HIT_FLASH = 0.08; // seconds an enemy flashes white after taking a hit

/** A player is hittable only while standing and not dashing (i-frames). */
function hittable(p: PlayerState): boolean {
  return isUp(p) && p.hp > 0 && !isInvulnerable(p);
}

/** Apply damage; a lethal hit downs the player — or kills outright when solo (no one to revive). */
function hurt(state: GameState, p: PlayerState, dmg: number): void {
  p.hp -= dmg;
  if (p.hp <= 0) {
    if (state.players.length <= 1) {
      p.hp = 0;
      p.alive = false;
    } else {
      downPlayer(p);
    }
  }
}

/** The standing player nearest a point (for contact/blast targeting), or undefined. */
function nearestHittable(state: GameState, x: number, y: number): PlayerState | undefined {
  let best: PlayerState | undefined;
  let bd = Infinity;
  for (const p of state.players) {
    if (!hittable(p)) continue;
    const d = (p.pos.x - x) ** 2 + (p.pos.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

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
function explode(state: GameState, at: Vec2, radius: number, damage: number, owner: number): void {
  const r2 = radius * radius;
  const shooter = state.players[owner];
  for (const e of state.enemies) {
    const dx = e.pos.x - at.x;
    const dy = e.pos.y - at.y;
    if (dx * dx + dy * dy <= r2) {
      e.hp -= damage;
      e.hitFlash = HIT_FLASH;
      applyLifesteal(state, shooter, damage);
    }
  }
  for (const p of state.players) {
    if (!hittable(p)) continue;
    const dx = p.pos.x - at.x;
    const dy = p.pos.y - at.y;
    if (dx * dx + dy * dy <= r2) hurt(state, p, damage * 0.5); // self/friendly-fire risk, halved
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
    const blocked = insideWall(b.pos, solids);
    const expired = b.ttl <= 0;
    let struck = false;

    if (b.hostile) {
      // Enemy projectile: hits any standing player; dash i-frames dodge it.
      for (const p of state.players) {
        if (!hittable(p)) continue;
        const dx = b.pos.x - p.pos.x;
        const dy = b.pos.y - p.pos.y;
        if (dx * dx + dy * dy <= PLAYER_RADIUS * PLAYER_RADIUS) {
          hurt(state, p, b.damage);
          struck = true;
          break;
        }
      }
    } else {
      const hit = firstEnemyHit(state, b);
      if (hit) {
        if (state.instaKillT > 0 && !hit.boss) hit.hp = 0; // Insta-Kill power-up
        else hit.hp -= b.damage;
        hit.hitFlash = HIT_FLASH;
        applyLifesteal(state, state.players[b.owner], b.damage); // leech perk credit
        if (hit.hp > 0) state.cash += Math.round(CASH_PER_HIT * cashMult(state)); // COD points-per-hit
        // Shove along the bullet's travel direction; heavier bodies budge less.
        const vlen = Math.hypot(b.vel.x, b.vel.y);
        if (vlen > 0) {
          const k = BULLET_KNOCKBACK * (13 / ZOMBIES[hit.type].radius);
          hit.pos.x += (b.vel.x / vlen) * k;
          hit.pos.y += (b.vel.y / vlen) * k;
        }
        struck = true;
      }
    }

    if (struck || blocked || expired) {
      if (b.splashRadius > 0) explode(state, b.pos, b.splashRadius, b.splashDamage, b.owner);
      continue; // bullet consumed
    }
    surviving.push(b);
  }
  state.bullets = surviving;

  // Clear the dead, tally kills, award cash, drop loot / power-ups.
  const greed = greedMult(state);
  const cm = cashMult(state);
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp > 0) {
      alive.push(e);
    } else {
      state.wave.killsThisWave += 1;
      const bounty = ZOMBIES[e.type].boss ? CASH_BOSS : CASH_PER_KILL * ZOMBIES[e.type].cost;
      state.cash += Math.round(bounty * greed * cm); // Double Points doubles kill cash too
      dropLoot(state, e.pos, rng);
      if (rng() < POWERUP_DROP_CHANCE) dropPowerUp(state, e.pos.x, e.pos.y, rollPowerUp(rng));
    }
  }
  state.enemies = alive;

  // Enemy contact damage (DPS) — each enemy claws the nearest standing player it
  // overlaps; the thorns perk reflects damage back onto the attacker.
  const thorns = thornsDamage(state);
  for (const e of state.enemies) {
    const def = ZOMBIES[e.type];
    const rr = def.radius + PLAYER_RADIUS;
    const p = nearestHittable(state, e.pos.x, e.pos.y);
    if (!p) continue;
    const dx = p.pos.x - e.pos.x;
    const dy = p.pos.y - e.pos.y;
    if (dx * dx + dy * dy <= rr * rr) {
      hurt(state, p, def.contactDamage * dt);
      if (thorns > 0) {
        e.hp -= thorns * dt;
        e.hitFlash = HIT_FLASH;
      }
    }
  }
  // gameOver (all players down/dead) is decided in stepSim.
}
