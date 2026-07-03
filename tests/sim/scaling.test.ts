import { describe, expect, it } from 'vitest';
import { ENEMY_SPEED_SCALE_MAX, MAX_ALIVE_BASE, MAX_ALIVE_CEIL, MAX_ALIVE_PER_PLAYER, SIM_DT } from '../../src/config';
import { ZOMBIES, enemyHpScale, enemySpeedScale, maxAlive, spawnEnemy } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import { isFinalWave, updateWaves } from '../../src/sim/waves';
import type { GameState } from '../../src/sim/types';

function fresh(numPlayers = 1): GameState {
  return createGameState([], [], [], { x: 100, y: 100 }, { width: 4000, height: 4000 }, numPlayers);
}

describe('COD-style scaling', () => {
  it('HP is unchanged on wave 1 and ramps every wave after', () => {
    expect(enemyHpScale(1)).toBe(1);
    expect(enemyHpScale(2)).toBeCloseTo(1.18);
    // late-game soften: the wave 25→26 step is gentler than the 24→25 step
    expect(enemyHpScale(26) - enemyHpScale(25)).toBeLessThan(enemyHpScale(25) - enemyHpScale(24));
    // strictly increasing
    for (let w = 1; w < 25; w++) expect(enemyHpScale(w + 1)).toBeGreaterThan(enemyHpScale(w));
    // compounds after the threshold: wave 10 grows faster than the linear step
    const linearStep = enemyHpScale(9) - enemyHpScale(8);
    const expStep = enemyHpScale(11) - enemyHpScale(10);
    expect(expStep).toBeGreaterThan(linearStep);
  });

  it('spawns bullet-spongier zombies on later waves', () => {
    const s1 = fresh();
    s1.wave.index = 1;
    expect(spawnEnemy(s1, 'shambler', { x: 0, y: 0 }).hp).toBe(ZOMBIES.shambler.hp);
    const s10 = fresh();
    s10.wave.index = 10;
    expect(spawnEnemy(s10, 'shambler', { x: 0, y: 0 }).hp).toBeGreaterThan(ZOMBIES.shambler.hp * 2);
    // bosses take only a fraction of the ramp (they're already huge)
    const scaledBossFrac = spawnEnemy(s10, 'bloater', { x: 0, y: 0 }).hp / ZOMBIES.bloater.hp;
    expect(scaledBossFrac).toBeLessThan(enemyHpScale(10)); // softened
    expect(scaledBossFrac).toBeGreaterThan(1); // but still scaled
  });

  it('speed ramps with waves and caps', () => {
    expect(enemySpeedScale(1)).toBe(1);
    expect(enemySpeedScale(5)).toBeGreaterThan(1);
    expect(enemySpeedScale(999)).toBe(ENEMY_SPEED_SCALE_MAX);
  });

  it('max-alive cap grows with squad size', () => {
    expect(maxAlive(1)).toBe(MAX_ALIVE_BASE);
    expect(maxAlive(4)).toBe(MAX_ALIVE_BASE + 3 * MAX_ALIVE_PER_PLAYER);
  });

  it('max-alive cap grows each wave up to a ceiling', () => {
    expect(maxAlive(1, 1)).toBe(MAX_ALIVE_BASE);
    expect(maxAlive(1, 10)).toBeGreaterThan(maxAlive(1, 1));
    expect(maxAlive(1, 30)).toBeGreaterThan(maxAlive(1, 10));
    expect(maxAlive(1, 9999)).toBe(MAX_ALIVE_CEIL); // capped for lag safety
  });

  it('is endless — no final wave, high rounds keep advancing', () => {
    expect(isFinalWave(20)).toBe(false); // the old extraction end is gone
    expect(isFinalWave(500)).toBe(false);
    const s = fresh();
    s.wave.index = 50;
    s.wave.phase = 'active';
    s.wave.spawnQueue = [];
    s.enemies = [];
    updateWaves(s, 0.1, () => 0.5); // cleared → advances rather than locking
    expect(s.wave.index).toBe(51);
  });

  it('never exceeds the max-alive cap even on a huge wave', () => {
    // spawn far from the (kept-alive) player so the horde accumulates before it arrives
    const s = createGameState([], [{ x: 3800, y: 3800 }], [], { x: 100, y: 100 }, { width: 4000, height: 4000 }, 1);
    s.wave.index = 25; // enormous budget
    s.wave.phase = 'intermission';
    s.wave.timer = 0.1;
    const rng = () => 0.5;
    let peak = 0;
    for (let i = 0; i < 20 / SIM_DT; i++) {
      s.players[0].hp = 9999; // pin the player alive so the wave keeps flooding
      stepSim(s, [emptyInput()], SIM_DT, rng);
      peak = Math.max(peak, s.enemies.length);
    }
    expect(peak).toBeGreaterThan(20); // it did flood
    expect(peak).toBeLessThanOrEqual(maxAlive(1, s.wave.index) + 1); // but never blew past the wave-scaled cap
  });
});
