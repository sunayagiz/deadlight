import { describe, expect, it } from 'vitest';
import { AFFIX_MIN_WAVE, SIM_DT } from '../../src/config';
import { AFFIXES, rollAffix } from '../../src/sim/affix';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy, updateEnemies, ZOMBIES } from '../../src/sim/enemies';
import { createGameState } from '../../src/sim/state';
import type { BulletState, GameState } from '../../src/sim/types';

/** Deterministic rng cycling through fixed values. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function fresh(): GameState {
  return createGameState([], [{ x: 0, y: 0 }], [], { x: 500, y: 500 }, { width: 4000, height: 4000 }, 1);
}

function bullet(x: number, y: number, damage: number): BulletState {
  return { id: 1, pos: { x, y }, vel: { x: 0, y: 0 }, ttl: 1, damage, splashRadius: 0, splashDamage: 0, hostile: false, owner: 0, lag: 0 };
}

describe('rollAffix (gating + determinism)', () => {
  it('never rolls (and consumes no rng) before AFFIX_MIN_WAVE', () => {
    for (let w = 1; w < AFFIX_MIN_WAVE; w++) {
      expect(rollAffix(w, seq([0]))).toBeUndefined(); // rng=0 would force an affix if it ran
    }
  });

  it('is deterministic: same wave + same rng sequence → same result', () => {
    const a = rollAffix(20, seq([0.01, 0.5]));
    const b = rollAffix(20, seq([0.01, 0.5]));
    expect(a).toBe(b);
    expect(a).toBeDefined(); // low roll under the (high-wave) chance → an affix
  });

  it('returns undefined when the roll misses the chance', () => {
    // wave AFFIX_MIN_WAVE chance is small (~8%); a 0.99 roll is well above it
    expect(rollAffix(AFFIX_MIN_WAVE, seq([0.99]))).toBeUndefined();
  });

  it('selects an affix that exists in the table', () => {
    const id = rollAffix(50, seq([0, 0])); // pass the gate, pick index 0
    expect(id).toBeDefined();
    expect(AFFIXES[id!]).toBeDefined();
  });
});

describe('affixed spawns', () => {
  it('multiplies spawn HP by the affix hpMult and records maxHp', () => {
    const s = fresh(); // wave 1 → hp ramp is ×1, so the affix mult is isolated
    const base = spawnEnemy(s, 'shambler', { x: 0, y: 0 });
    const tank = spawnEnemy(s, 'shambler', { x: 0, y: 0 }, 'tank');
    expect(tank.affix).toBe('tank');
    expect(tank.hp).toBe(Math.round(base.hp * AFFIXES.tank.hpMult));
    expect(tank.maxHp).toBe(tank.hp);
  });
});

describe('shielded (extra bullet resist)', () => {
  it('takes less bullet damage than an unaffixed enemy of the same type', () => {
    const s = fresh();
    const plain = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    const shielded = spawnEnemy(s, 'shambler', { x: 300, y: 300 }, 'shielded');
    const plainSpawn = plain.hp;
    const shieldedSpawn = shielded.hp;
    s.bullets = [bullet(100, 100, 25), bullet(300, 300, 25)];
    updateCombat(s, SIM_DT, () => 0.99);
    const plainLoss = plainSpawn - plain.hp;
    const shieldedLoss = shieldedSpawn - shielded.hp;
    expect(shieldedLoss).toBeGreaterThan(0);
    expect(shieldedLoss).toBeLessThan(plainLoss); // 0.6 resist → far less damage through
  });
});

describe('volatile (blast on death)', () => {
  it('damages a nearby player when it dies', () => {
    const s = fresh();
    const e = spawnEnemy(s, 'shambler', { x: 520, y: 500 }, 'volatile'); // right next to the player
    e.hp = 0; // combat reaps it this tick → blast
    const before = s.players[0].hp;
    updateCombat(s, SIM_DT, () => 0.99);
    expect(s.players[0].hp).toBeLessThan(before);
  });

  it('a non-volatile enemy dying next to the player does NOT blast', () => {
    const s = fresh();
    const e = spawnEnemy(s, 'shambler', { x: 520, y: 500 }); // plain shambler
    e.hp = 0;
    const before = s.players[0].hp;
    updateCombat(s, SIM_DT, () => 0.99);
    expect(s.players[0].hp).toBe(before);
  });
});

describe('vampiric (self-regen)', () => {
  it('regenerates HP over time, capped at spawn HP', () => {
    const s = fresh();
    const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 }, 'vampiric');
    const max = e.maxHp!;
    e.hp = max - 50; // wounded
    updateEnemies(s.enemies, s.players, [], SIM_DT); // one tick of regen
    expect(e.hp).toBeGreaterThan(max - 50);
    // a big step over-heals but is clamped to spawn HP, never above
    updateEnemies(s.enemies, s.players, [], 100);
    expect(e.hp).toBe(max);
  });
});
