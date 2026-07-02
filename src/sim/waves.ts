import {
  BRUTE_MIN_WAVE,
  WAVE_BUDGET_BASE,
  WAVE_BUDGET_GROWTH,
  WAVE_INTERMISSION,
  WAVE_SPAWN_INTERVAL,
} from '../config';
import { ZOMBIES, spawnEnemy } from './enemies';
import type { EnemyType, GameState, SpawnZone } from './types';

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

function pickZone(state: GameState, rng: Rng): SpawnZone {
  const zones = state.spawnZones;
  if (zones.length === 0) return { x: 24, y: 24 }; // fallback; real maps always define zones
  return zones[Math.floor(rng() * zones.length) % zones.length];
}

function startWave(state: GameState, rng: Rng): void {
  const wave = state.wave;
  wave.phase = 'active';
  wave.spawnQueue = buildWaveQueue(wave.index, rng);
  wave.spawnCooldown = 0; // first enemy spawns on the next tick
  wave.killsThisWave = 0;
}

export function updateWaves(state: GameState, dt: number, rng: Rng = Math.random): void {
  if (state.gameOver) return;
  const wave = state.wave;

  if (wave.phase === 'intermission') {
    wave.timer = Math.max(0, wave.timer - dt);
    if (wave.timer <= 0) startWave(state, rng);
    return;
  }

  // active phase: drain the spawn queue on an interval
  wave.spawnCooldown -= dt;
  if (wave.spawnQueue.length > 0 && wave.spawnCooldown <= 0) {
    const type = wave.spawnQueue.shift()!;
    spawnEnemy(state, type, pickZone(state, rng));
    wave.spawnCooldown = WAVE_SPAWN_INTERVAL;
  }

  // wave is cleared once nothing is left to spawn and nothing is left alive
  if (wave.spawnQueue.length === 0 && state.enemies.length === 0) {
    wave.index += 1;
    wave.phase = 'intermission';
    wave.timer = WAVE_INTERMISSION;
  }
}
