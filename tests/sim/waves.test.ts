import { describe, it, expect } from 'vitest';
import { BRUTE_MIN_WAVE, WAVE_SPAWN_INTERVAL, SIM_DT } from '../../src/config';
import { ZOMBIES } from '../../src/sim/enemies';
import { createGameState } from '../../src/sim/state';
import { buildWaveQueue, updateWaves, waveBudget } from '../../src/sim/waves';
import type { EnemyType } from '../../src/sim/types';

/** Deterministic rng cycling through fixed values. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const cost = (q: EnemyType[]) => q.reduce((sum, t) => sum + ZOMBIES[t].cost, 0);

describe('waves', () => {
  it('spends the budget: queue cost never exceeds it and no cheaper enemy still fits', () => {
    for (let index = 1; index <= 6; index++) {
      const q = buildWaveQueue(index, seq([0.1, 0.5, 0.9]));
      const b = waveBudget(index);
      expect(cost(q)).toBeLessThanOrEqual(b);
      expect(b - cost(q)).toBeLessThan(ZOMBIES.shambler.cost); // cheapest is 1
    }
  });

  it('no brutes before BRUTE_MIN_WAVE, brutes possible after', () => {
    const early = buildWaveQueue(BRUTE_MIN_WAVE - 1, seq([0.99]));
    expect(early).not.toContain('brute');
    // force brute pick: with budget high enough and rng pointing at last option
    const late = buildWaveQueue(BRUTE_MIN_WAVE, seq([0.99]));
    expect(late).toContain('brute');
  });

  it('leaves intermission and starts spawning after the timer elapses', () => {
    const s = createGameState([], [{ x: 50, y: 50 }]);
    expect(s.wave.phase).toBe('intermission');
    // burn down the intermission timer
    for (let i = 0; i < 1000 && s.wave.phase === 'intermission'; i++) {
      updateWaves(s, SIM_DT, seq([0]));
    }
    expect(s.wave.phase).toBe('active');
    expect(s.wave.spawnQueue.length + s.enemies.length).toBeGreaterThan(0);
  });

  it('drains the spawn queue over time at the spawn interval', () => {
    const s = createGameState([], [{ x: 50, y: 50 }]);
    // skip intermission
    s.wave.phase = 'active';
    s.wave.spawnQueue = ['shambler', 'shambler', 'shambler'];
    s.wave.spawnCooldown = 0;
    updateWaves(s, SIM_DT, seq([0])); // first spawn
    expect(s.enemies).toHaveLength(1);
    // not enough time yet for the next one
    updateWaves(s, SIM_DT, seq([0]));
    expect(s.enemies).toHaveLength(1);
    // advance past the interval
    for (let t = 0; t < WAVE_SPAWN_INTERVAL; t += SIM_DT) updateWaves(s, SIM_DT, seq([0]));
    expect(s.enemies.length).toBeGreaterThanOrEqual(2);
  });

  it('advances to the next wave once cleared', () => {
    const s = createGameState([], [{ x: 50, y: 50 }]);
    s.wave.index = 1;
    s.wave.phase = 'active';
    s.wave.spawnQueue = [];
    s.enemies = [];
    updateWaves(s, SIM_DT, seq([0]));
    expect(s.wave.index).toBe(2);
    expect(s.wave.phase).toBe('intermission');
  });

  it('freezes when gameOver', () => {
    const s = createGameState([], [{ x: 50, y: 50 }]);
    s.gameOver = true;
    const beforeTimer = s.wave.timer;
    updateWaves(s, SIM_DT, seq([0]));
    expect(s.wave.timer).toBe(beforeTimer);
    expect(s.wave.phase).toBe('intermission');
  });
});
