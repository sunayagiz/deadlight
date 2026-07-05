import { BOOMER_BLAST_DMG, BOOMER_BLAST_RADIUS, BULLET_KNOCKBACK, CASH_BOSS, CASH_PER_HIT, CASH_PER_KILL, GENERATOR_RADIUS, PLAYER_RADIUS, POWERUP_DROP_CHANCE, ZED_CHARGE_PER_KILL } from '../config';
import { affixBulletResist, affixExplodesOnDeath } from './affix';
import { cashMult, dropPowerUp, rollPowerUp } from './cod';
import { directorDropMult } from './director';
import { downPlayer } from './coop';
import { ZOMBIES } from './enemies';
import { rewoundEnemyPos } from './lagcomp';
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

/**
 * Apply damage; a lethal hit downs the player (co-op: a teammate revives; solo:
 * self-revive via Quick Revive charges). Only when a downed player finally bleeds
 * out do they die — that death path lives in updateRevives, not here.
 */
function hurt(state: GameState, p: PlayerState, dmg: number): void {
  p.hp -= dmg;
  if (p.hp <= 0) downPlayer(p);
}

/** A death detonation (boomer, or a volatile elite): every standing player in the blast takes damage (dash dodges it). */
function boomerBlast(state: GameState, at: Vec2): void {
  const r2 = BOOMER_BLAST_RADIUS * BOOMER_BLAST_RADIUS;
  for (const p of state.players) {
    if (!hittable(p)) continue;
    const dx = p.pos.x - at.x;
    const dy = p.pos.y - at.y;
    if (dx * dx + dy * dy <= r2) hurt(state, p, BOOMER_BLAST_DMG);
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
  // B10: a guest bullet (lag > 0) tests against each enemy's position AS OF the
  // tick the shooter saw (favor-the-shooter). lag === 0 (host/solo/live) uses the
  // enemy's CURRENT pos — byte-for-byte the pre-B10 path. Only the overlap
  // POSITION is rewound; the hit enemy, damage, knockback and payout are the
  // live enemy resolved by the caller. Rewind is bounded (clampLag) so a stale
  // shot can't reach across the map, and walls are checked at the bullet's real
  // position elsewhere, so it can't hit through them.
  const lag = b.lag ?? 0;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const r = ZOMBIES[e.type].radius;
    const ep = lag > 0 ? rewoundEnemyPos(state, e, lag) : e.pos;
    const dx = b.pos.x - ep.x;
    const dy = b.pos.y - ep.y;
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
      // armor resists blasts too, and a shielded elite stacks on top of that
      const dealt = damage * (1 - (ZOMBIES[e.type].bulletResist ?? 0)) * (1 - affixBulletResist(e));
      e.hp -= dealt;
      e.hitFlash = HIT_FLASH;
      applyLifesteal(state, shooter, dealt);
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
 *
 * `enemyScale` (A9 Zed-Time) slows ONLY the enemy-driven half of the tick: the
 * contact-damage DPS (and the thorns it triggers) integrate with `dt * enemyScale`
 * so a slowed horde claws slower, while bullet resolution, kills, cash and drops
 * are position-based and stay full-rate. Player bullets already flew full-speed.
 */
export function updateCombat(state: GameState, dt: number, rng: () => number = Math.random, enemyScale = 1): void {
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
        // armored bodies shrug off bullets — melee is the answer; shielded elites resist further
        const dealt = b.damage * (1 - (ZOMBIES[hit.type].bulletResist ?? 0)) * (1 - affixBulletResist(hit));
        if (state.instaKillT > 0 && !hit.boss) hit.hp = 0; // Insta-Kill power-up ignores armor
        else hit.hp -= dealt;
        hit.hitFlash = HIT_FLASH;
        applyLifesteal(state, state.players[b.owner], dealt); // leech perk credit
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
  // AI Director supply relief: when the squad is starved it biases drops upward.
  // Same rng() draw as before (deterministic) — only the threshold moves.
  const dropMult = directorDropMult(state);
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp > 0) {
      alive.push(e);
    } else {
      state.wave.killsThisWave += 1;
      state.totalKills += 1; // run-wide tally for the daily score
      state.zedCharge = Math.min(1, state.zedCharge + ZED_CHARGE_PER_KILL); // A9: kills charge the Zed-Time meter
      const bounty = ZOMBIES[e.type].boss ? CASH_BOSS : CASH_PER_KILL * ZOMBIES[e.type].cost;
      state.cash += Math.round(bounty * greed * cm); // Double Points doubles kill cash too
      dropLoot(state, e.pos, rng, dropMult);
      if (rng() < POWERUP_DROP_CHANCE * dropMult) dropPowerUp(state, e.pos.x, e.pos.y, rollPowerUp(rng));
      // Boomers and volatile elites detonate on death (same AoE) — mind your kills.
      if (e.type === 'boomer' || affixExplodesOnDeath(e)) boomerBlast(state, e.pos);
    }
  }
  state.enemies = alive;

  // Enemy contact damage (DPS) — each enemy claws the nearest standing player it
  // overlaps; the thorns perk reflects damage back onto the attacker.
  const thorns = thornsDamage(state);
  const edt = dt * enemyScale; // A9: contact DPS (and the thorns it triggers) slow with the horde
  for (const e of state.enemies) {
    const def = ZOMBIES[e.type];
    const rr = def.radius + PLAYER_RADIUS;
    const p = nearestHittable(state, e.pos.x, e.pos.y);
    if (!p) continue;
    const dx = p.pos.x - e.pos.x;
    const dy = p.pos.y - e.pos.y;
    if (dx * dx + dy * dy <= rr * rr) {
      hurt(state, p, def.contactDamage * edt);
      if (thorns > 0) {
        e.hp -= thorns * edt;
        e.hitFlash = HIT_FLASH;
      }
    }
  }

  // A8 defend: any enemy overlapping the generator claws it down at its contact
  // DPS (the same model as clawing a player). The win/lose read of the result
  // lives in updateDefend; here we only drain HP. Bosses hit it too.
  const gen = state.objective;
  if (gen && gen.hp > 0) {
    for (const e of state.enemies) {
      const rr = ZOMBIES[e.type].radius + GENERATOR_RADIUS;
      const dx = gen.x - e.pos.x;
      const dy = gen.y - e.pos.y;
      if (dx * dx + dy * dy <= rr * rr) gen.hp = Math.max(0, gen.hp - ZOMBIES[e.type].contactDamage * edt);
    }
  }
  // gameOver (all players down/dead) is decided in stepSim.
}
