import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../../src/config';
import { dailySeedString, hashSeed, mulberry32 } from '../../src/sim/rng';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import { testRoomSpawnZones, testRoomWalls } from '../../src/sim/room';
import type { GameState } from '../../src/sim/types';

describe('rng — seeded PRNG', () => {
  it('mulberry32 is deterministic: same seed → identical sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('every value is in [0, 1)', () => {
    const r = mulberry32(hashSeed('DEADLIGHT-20260705'));
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashSeed is stable and returns an unsigned 32-bit int', () => {
    expect(hashSeed('DEADLIGHT-20260705')).toBe(hashSeed('DEADLIGHT-20260705'));
    const h = hashSeed('some seed');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    // distinct strings almost always hash differently
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });

  it('dailySeedString formats the date', () => {
    expect(dailySeedString('20260705')).toBe('DEADLIGHT-20260705');
  });
});

describe('rng — seeded sim reproducibility', () => {
  /** Run a full seeded sim: one fresh rng instance from `seed`, threaded to every tick. */
  function runSeeded(seed: string, ticks: number): GameState {
    const s = createGameState(testRoomWalls(), testRoomSpawnZones());
    const rng = mulberry32(hashSeed(seed));
    const input = emptyInput();
    for (let i = 0; i < ticks; i++) stepSim(s, input, SIM_DT, rng);
    return s;
  }

  it('two runs from the same seed produce identical GameState', () => {
    const seed = dailySeedString('20260705');
    const ticks = Math.round(20 / SIM_DT); // well past the first intermission + spawns
    const a = runSeeded(seed, ticks);
    const b = runSeeded(seed, ticks);

    // wave progression identical
    expect(a.wave.index).toBe(b.wave.index);
    expect(a.wave.phase).toBe(b.wave.phase);
    expect(a.totalKills).toBe(b.totalKills);

    // enemy population identical: count, types, and positions
    expect(a.enemies.length).toBe(b.enemies.length);
    expect(a.enemies.length).toBeGreaterThan(0); // proves spawns actually happened
    for (let i = 0; i < a.enemies.length; i++) {
      expect(a.enemies[i].type).toBe(b.enemies[i].type);
      expect(a.enemies[i].pos.x).toBe(b.enemies[i].pos.x);
      expect(a.enemies[i].pos.y).toBe(b.enemies[i].pos.y);
      expect(a.enemies[i].affix).toBe(b.enemies[i].affix);
    }

    // full-state equality (belt and suspenders)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different runs', () => {
    const ticks = Math.round(20 / SIM_DT);
    const a = runSeeded(dailySeedString('20260705'), ticks);
    const b = runSeeded(dailySeedString('20991231'), ticks);
    // extremely unlikely to be byte-identical across a full 20s divergent run
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
