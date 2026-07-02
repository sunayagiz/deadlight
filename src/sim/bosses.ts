import { BOSS_ATTACK_CD, BOSS_SUMMON_COUNT, BOSS_TELEGRAPH } from '../config';
import { spawnEnemy } from './enemies';
import type { BossAttack, EnemyState, EnemyType, GameState } from './types';

/** Which attacks each boss can pick from. */
const ATTACKS: Partial<Record<EnemyType, BossAttack[]>> = {
  bloater: ['spew'],
  screamer: ['spit', 'summon'],
};

function hostileBullet(
  state: GameState,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  ttl: number,
): void {
  state.bullets.push({
    id: state.nextBulletId++,
    pos: { x, y },
    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
    ttl,
    damage,
    splashRadius: 0,
    splashDamage: 0,
    hostile: true,
  });
}

function executeAttack(state: GameState, e: EnemyState, attack: BossAttack, rng: () => number): void {
  // target the nearest standing player (fall back to players[0])
  const up = state.players.filter((q) => q.alive && !q.downed);
  const pool = up.length > 0 ? up : state.players;
  const p = pool.reduce((a, b) =>
    (a.pos.x - e.pos.x) ** 2 + (a.pos.y - e.pos.y) ** 2 <= (b.pos.x - e.pos.x) ** 2 + (b.pos.y - e.pos.y) ** 2 ? a : b,
  );
  if (attack === 'spew') {
    const n = 14; // radial ring of projectiles
    for (let i = 0; i < n; i++) hostileBullet(state, e.pos.x, e.pos.y, (i / n) * Math.PI * 2, 240, 16, 1.8);
  } else if (attack === 'spit') {
    const a = Math.atan2(p.pos.y - e.pos.y, p.pos.x - e.pos.x);
    hostileBullet(state, e.pos.x, e.pos.y, a, 340, 22, 2.0);
  } else if (attack === 'summon') {
    for (let i = 0; i < BOSS_SUMMON_COUNT; i++) {
      const type: EnemyType = rng() < 0.5 ? 'shambler' : 'runner';
      const ang = rng() * Math.PI * 2;
      spawnEnemy(state, type, { x: e.pos.x + Math.cos(ang) * 40, y: e.pos.y + Math.sin(ang) * 40 });
    }
  }
}

/**
 * Boss attack loop: each boss counts down to an attack, telegraphs it (a visible
 * wind-up the player can react to), then executes. Movement is handled by
 * updateEnemies; this only drives the patterns.
 */
export function updateBosses(state: GameState, dt: number, rng: () => number = Math.random): void {
  const bosses = state.enemies.filter((e) => e.boss); // snapshot: summon mutates state.enemies
  for (const e of bosses) {
    const brain = e.boss!;
    if (brain.telegraph > 0) {
      brain.telegraph -= dt;
      if (brain.telegraph <= 0 && brain.pending) {
        executeAttack(state, e, brain.pending, rng);
        brain.pending = null;
        brain.attackCd = BOSS_ATTACK_CD;
      }
      continue;
    }
    brain.attackCd -= dt;
    if (brain.attackCd <= 0) {
      const opts = ATTACKS[e.type] ?? [];
      if (opts.length > 0) {
        brain.pending = opts[Math.floor(rng() * opts.length) % opts.length];
        brain.telegraph = BOSS_TELEGRAPH;
      } else {
        brain.attackCd = BOSS_ATTACK_CD;
      }
    }
  }
}
