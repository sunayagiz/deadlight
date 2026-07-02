import {
  BOSS_WAVE_INTERVAL,
  BRUTE_MIN_WAVE,
  FLASHLIGHT_HALF_ANGLE,
  FLASHLIGHT_RANGE,
  SPAWN_MIN_DIST,
  SPAWN_RETRY,
  SPAWN_SIGHT_DIST,
  WAVE_BUDGET_BASE,
  WAVE_BUDGET_GROWTH,
  WAVE_INTERMISSION,
  WAVE_SPAWN_INTERVAL,
} from '../config';
import { ZOMBIES, spawnEnemy } from './enemies';
import { mapSolids } from './map';
import { segmentClear } from './vision';
import type { EnemyType, GameState, SpawnZone } from './types';

export function isBossWave(index: number): boolean {
  return index % BOSS_WAVE_INTERVAL === 0;
}

/** Alternate the two bosses: 1st boss wave = bloater, 2nd = screamer, ... */
export function bossForWave(index: number): EnemyType {
  return (index / BOSS_WAVE_INTERVAL) % 2 === 1 ? 'bloater' : 'screamer';
}

/** Deterministic when a seeded rng is passed; defaults to Math.random for the live game. */
export type Rng = () => number;

export function waveBudget(index: number): number {
  return WAVE_BUDGET_BASE + WAVE_BUDGET_GROWTH * (index - 1);
}

function affordable(index: number, budget: number): EnemyType[] {
  const pool: EnemyType[] = ['shambler', 'runner'];
  if (index >= BRUTE_MIN_WAVE) pool.push('brute');
  return pool.filter((t) => ZOMBIES[t].cost <= budget);
}

/** Spend the wave's budget on random affordable enemy rows to build a spawn queue. */
export function buildWaveQueue(index: number, rng: Rng): EnemyType[] {
  let budget = waveBudget(index);
  const queue: EnemyType[] = [];
  for (;;) {
    const opts = affordable(index, budget);
    if (opts.length === 0) break;
    const type = opts[Math.floor(rng() * opts.length) % opts.length];
    queue.push(type);
    budget -= ZOMBIES[type].cost;
  }
  return queue;
}

/** Shortest signed angular distance from a to b. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * L4D-style spawn validity: the zone's room must be unlocked (minWave), it
 * must not be right on top of a player, and it must not sit inside the
 * player's flashlight view (in cone + close + clear line of sight).
 */
function zoneValid(state: GameState, z: SpawnZone): boolean {
  if ((z.minWave ?? 0) > state.wave.index) return false;
  const p = state.player;
  const dx = z.x - p.pos.x;
  const dy = z.y - p.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < SPAWN_MIN_DIST) return false;
  const inCone =
    dist < FLASHLIGHT_RANGE * SPAWN_SIGHT_DIST &&
    Math.abs(angleDiff(Math.atan2(dy, dx), p.aimAngle)) < FLASHLIGHT_HALF_ANGLE * 1.25;
  if (inCone && segmentClear(p.pos, { x: z.x, y: z.y }, mapSolids(state))) return false;
  return true;
}

/** A random valid zone, or null when every zone is currently watched/locked (caller retries). */
function pickZone(state: GameState, rng: Rng): SpawnZone | null {
  const valid = state.spawnZones.filter((z) => zoneValid(state, z));
  if (valid.length === 0) return state.spawnZones.length === 0 ? { x: 24, y: 24 } : null;
  return valid[Math.floor(rng() * valid.length) % valid.length];
}

/** Least-bad zone for a boss entrance: unlocked and farthest from the player. */
function pickBossZone(state: GameState): SpawnZone {
  const p = state.player;
  const eligible = state.spawnZones.filter((z) => (z.minWave ?? 0) <= state.wave.index);
  const pool = eligible.length > 0 ? eligible : [{ x: 24, y: 24 }];
  return pool.reduce((a, b) =>
    Math.hypot(a.x - p.pos.x, a.y - p.pos.y) >= Math.hypot(b.x - p.pos.x, b.y - p.pos.y) ? a : b,
  );
}

function startWave(state: GameState, rng: Rng): void {
  const wave = state.wave;
  wave.phase = 'active';
  wave.spawnQueue = buildWaveQueue(wave.index, rng);
  wave.spawnCooldown = 0; // first enemy spawns on the next tick
  wave.killsThisWave = 0;
  if (isBossWave(wave.index)) {
    spawnEnemy(state, bossForWave(wave.index), pickBossZone(state)); // boss enters alongside the wave
  }
}

export function updateWaves(state: GameState, dt: number, rng: Rng = Math.random): void {
  if (state.gameOver) return;
  const wave = state.wave;

  if (wave.phase === 'intermission') {
    wave.timer = Math.max(0, wave.timer - dt);
    if (wave.timer <= 0) startWave(state, rng);
    return;
  }

  // active phase: drain the spawn queue on an interval; if every zone is
  // watched or locked, HOLD the spawn and retry — budget is never skipped.
  wave.spawnCooldown -= dt;
  if (wave.spawnQueue.length > 0 && wave.spawnCooldown <= 0) {
    const zone = pickZone(state, rng);
    if (zone) {
      const type = wave.spawnQueue.shift()!;
      spawnEnemy(state, type, zone);
      wave.spawnCooldown = WAVE_SPAWN_INTERVAL;
    } else {
      wave.spawnCooldown = SPAWN_RETRY;
    }
  }

  // wave is cleared once nothing is left to spawn and nothing is left alive
  if (wave.spawnQueue.length === 0 && state.enemies.length === 0) {
    wave.index += 1;
    wave.phase = 'intermission';
    wave.timer = WAVE_INTERMISSION;
  }
}
