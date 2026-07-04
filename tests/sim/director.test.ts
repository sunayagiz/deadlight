import { describe, it, expect } from 'vitest';
import {
  DIRECTOR_PEAK,
  DIRECTOR_PEAK_CAP_MULT,
  DIRECTOR_PEAK_INTERVAL_MULT,
  DIRECTOR_RELAX_INTERVAL_MULT,
  DIRECTOR_STARVED_DROP_MULT,
  PLAYER_MAX_HP,
  SIM_DT,
} from '../../src/config';
import {
  directorCapMult,
  directorDropMult,
  directorIntervalMult,
  isStarved,
  updateDirector,
} from '../../src/sim/director';
import { spawnEnemy } from '../../src/sim/enemies';
import { mulberry32 } from '../../src/sim/rng';
import { createGameState } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import { updateWaves } from '../../src/sim/waves';
import { emptyInput } from '../../src/sim/state';

/** A state with one player at the origin-ish and the given spawn zones. */
function makeState(zones = [{ x: 50, y: 50 }]) {
  return createGameState([], zones, [], { x: 480, y: 270 });
}

/** Drop `n` enemies right on top of the player so they count as pressure. */
function crowd(s: ReturnType<typeof makeState>, n: number): void {
  const p = s.players[0];
  for (let i = 0; i < n; i++) spawnEnemy(s, 'shambler', { x: p.pos.x + 4 * i, y: p.pos.y });
}

describe('AI Director — intensity accumulator', () => {
  it('rises when enemies are near', () => {
    const s = makeState();
    crowd(s, 12); // well past DIRECTOR_PRESSURE_FULL → full pressure
    const before = s.intensity;
    for (let i = 0; i < 60; i++) updateDirector(s, SIM_DT); // ~1s
    expect(s.intensity).toBeGreaterThan(before);
    expect(s.intensity).toBeGreaterThan(0.5);
  });

  it('rises when damage is taken (even with no enemies present)', () => {
    const s = makeState();
    const p = s.players[0];
    // simulate ongoing damage: lose HP each tick, Director sees hpRef drop
    for (let i = 0; i < 40; i++) {
      p.hp -= 3;
      updateDirector(s, SIM_DT);
    }
    expect(s.intensity).toBeGreaterThan(0);
    expect(s.enemies).toHaveLength(0); // came purely from damage, not pressure
  });

  it('decays toward 0 when calm', () => {
    const s = makeState();
    crowd(s, 12);
    for (let i = 0; i < 120; i++) updateDirector(s, SIM_DT); // build it up
    const peak = s.intensity;
    expect(peak).toBeGreaterThan(0.5);
    s.enemies = []; // horde gone → calm
    for (let i = 0; i < 600; i++) updateDirector(s, SIM_DT); // ~10s of quiet
    expect(s.intensity).toBeLessThan(peak);
    expect(s.intensity).toBeLessThan(0.05);
  });

  it('stays clamped in [0,1] under sustained heavy pressure + damage', () => {
    const s = makeState();
    crowd(s, 40);
    const p = s.players[0];
    for (let i = 0; i < 300; i++) {
      p.hp -= 50; // brutal, would blow past 1 if unclamped
      updateDirector(s, SIM_DT);
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe('AI Director — peak/relax throttle multipliers', () => {
  it('at/above peak: cap shrinks and interval lengthens vs calm', () => {
    const calm = makeState();
    expect(directorCapMult(calm)).toBe(1);
    expect(directorIntervalMult(calm)).toBe(1);

    const peaking = makeState();
    peaking.intensity = DIRECTOR_PEAK + 0.05;
    expect(directorCapMult(peaking)).toBe(DIRECTOR_PEAK_CAP_MULT);
    expect(directorCapMult(peaking)).toBeLessThan(1);
    expect(directorIntervalMult(peaking)).toBe(DIRECTOR_PEAK_INTERVAL_MULT);
    expect(directorIntervalMult(peaking)).toBeGreaterThan(1);
  });

  it('opens an eased relax window after a peak eases off', () => {
    const s = makeState();
    // drive it to peak with a big crowd, then remove the horde to let it fall
    crowd(s, 40);
    for (let i = 0; i < 120 && s.intensity < DIRECTOR_PEAK; i++) updateDirector(s, SIM_DT);
    expect(s.director.peaked).toBe(true);
    s.enemies = [];
    for (let i = 0; i < 600 && s.director.relaxT === 0; i++) updateDirector(s, SIM_DT);
    expect(s.director.relaxT).toBeGreaterThan(0); // calm window armed on the way down
    expect(directorIntervalMult(s)).toBe(DIRECTOR_RELAX_INTERVAL_MULT); // eased spawns
  });

  it('throttles spawns: a peaking Director spawns fewer than a calm one over the same ticks', () => {
    const build = () => {
      const s = makeState([{ x: 50, y: 50 }]);
      s.wave.phase = 'active';
      s.wave.spawnQueue = Array.from({ length: 60 }, () => 'shambler' as const);
      s.wave.spawnCooldown = 0;
      return s;
    };
    const calm = build();
    const peaking = build();
    peaking.intensity = DIRECTOR_PEAK + 0.05; // held high; we call updateWaves directly (no re-derive)

    const rng = () => 0.99; // no affixes, deterministic jitter
    for (let i = 0; i < 200; i++) {
      updateWaves(calm, SIM_DT, rng);
      updateWaves(peaking, SIM_DT, rng);
    }
    expect(peaking.enemies.length).toBeLessThan(calm.enemies.length);
  });
});

describe('AI Director — starved supply bias', () => {
  it('raises the drop multiplier when a standing player is low on HP', () => {
    const s = makeState();
    expect(isStarved(s)).toBe(false);
    expect(directorDropMult(s)).toBe(1);

    s.players[0].hp = PLAYER_MAX_HP * 0.2; // under the 35% starved threshold
    expect(isStarved(s)).toBe(true);
    expect(directorDropMult(s)).toBe(DIRECTOR_STARVED_DROP_MULT);
    expect(directorDropMult(s)).toBeGreaterThan(1);
  });

  it('raises the drop multiplier when equipped limited weapon is out of ammo', () => {
    const s = makeState();
    s.players[0].owned.push('minigun'); // a LIMITED weapon (startAmmo); pistol/smg are infinite
    s.players[0].weapon = 'minigun';
    s.players[0].ammo['minigun'] = 0; // dry
    expect(isStarved(s)).toBe(true);
    expect(directorDropMult(s)).toBe(DIRECTOR_STARVED_DROP_MULT);
  });
});

describe('AI Director — determinism', () => {
  it('same seed ⇒ identical intensity trajectory through a full sim', () => {
    // Aim UP-RIGHT (fixed) so the flashlight cone never lights the bottom-left
    // spawn zone — otherwise L4D spawn rules reject every spawn and no stress
    // is ever generated. The horde then reaches the stationary player naturally.
    const input = { ...emptyInput(), aimWorldX: 960, aimWorldY: 0 };
    const run = () => {
      const s = createGameState([], [{ x: 50, y: 500 }], [], { x: 480, y: 270 });
      const rng = mulberry32(12345);
      const trace: number[] = [];
      for (let i = 0; i < 900; i++) {
        stepSim(s, { ...input }, SIM_DT, rng);
        trace.push(s.intensity);
      }
      return trace;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.some((v) => v > 0)).toBe(true); // the run actually generated stress
    expect(a.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});
