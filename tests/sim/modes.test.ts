import { describe, expect, it } from 'vitest';
import {
  DEFEND_WAVES,
  EXTRACT_HOLD,
  EXTRACT_OPEN_WAVE,
  GENERATOR_HP,
  GENERATOR_RADIUS,
  SIM_DT,
} from '../../src/config';
import { snapshot, applySnapshot } from '../../src/net/protocol';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy } from '../../src/sim/enemies';
import { isExtractionOpen, updateDefend, updateExtraction } from '../../src/sim/extraction';
import { createGameState } from '../../src/sim/state';
import { isFinalWave } from '../../src/sim/waves';
import type { GameMode, GameState } from '../../src/sim/types';

const GEN = { x: 800, y: 800 };

function fresh(mode: GameMode): GameState {
  // player starts far from the generator so contact tests isolate what hits what
  return createGameState(
    [],
    [],
    [],
    { x: 100, y: 100 },
    { width: 2000, height: 2000 },
    1,
    { x: 1500, y: 1500 }, // extractPoint
    [],
    mode,
    GEN, // generatorPoint (defend)
  );
}

describe('A8 · extraction mode', () => {
  it('keeps the exit shut before EXTRACT_OPEN_WAVE', () => {
    const s = fresh('extraction');
    s.wave.index = EXTRACT_OPEN_WAVE - 1;
    expect(isExtractionOpen(s)).toBe(false);
    updateExtraction(s, SIM_DT);
    expect(s.extraction).toBeNull(); // no beacon yet
    expect(s.won).toBe(false);
  });

  it('opens the exit at EXTRACT_OPEN_WAVE and holding it wins', () => {
    const s = fresh('extraction');
    s.wave.index = EXTRACT_OPEN_WAVE;
    s.extractPoint = { x: 400, y: 400 };
    s.players[0].pos = { x: 400, y: 400 }; // stand on the exit
    expect(isExtractionOpen(s)).toBe(true);
    for (let t = 0; t < EXTRACT_HOLD * 60 + 5; t++) updateExtraction(s, SIM_DT);
    expect(s.won).toBe(true);
    expect(s.gameOver).toBe(true);
  });

  it('routes the endless refill through the escape wave at EXTRACT_OPEN_WAVE', () => {
    expect(isFinalWave(EXTRACT_OPEN_WAVE, 'extraction')).toBe(true);
    expect(isFinalWave(EXTRACT_OPEN_WAVE - 1, 'extraction')).toBe(false);
    expect(isFinalWave(EXTRACT_OPEN_WAVE, 'endless')).toBe(false); // endless never hits it
  });
});

describe('A8 · defend mode', () => {
  it('spawns a generator with full HP; endless/extraction carry none', () => {
    const d = fresh('defend');
    expect(d.objective).toEqual({ x: GEN.x, y: GEN.y, hp: GENERATOR_HP, maxHp: GENERATOR_HP });
    expect(fresh('endless').objective).toBeNull();
    expect(fresh('extraction').objective).toBeNull();
  });

  it('lets enemies adjacent to the generator claw its HP down', () => {
    const s = fresh('defend');
    // an enemy sitting on the generator (well inside its contact reach)
    spawnEnemy(s, 'shambler', { x: GEN.x, y: GEN.y });
    const before = s.objective!.hp;
    for (let t = 0; t < 60; t++) updateCombat(s, SIM_DT, () => 0.99); // 1s of clawing
    expect(s.objective!.hp).toBeLessThan(before);
  });

  it('leaves the generator untouched when no enemy is in reach', () => {
    const s = fresh('defend');
    // enemy far outside GENERATOR_RADIUS + its own radius
    spawnEnemy(s, 'shambler', { x: GEN.x + GENERATOR_RADIUS + 300, y: GEN.y });
    const before = s.objective!.hp;
    updateCombat(s, SIM_DT, () => 0.99);
    expect(s.objective!.hp).toBe(before);
  });

  it('loses the run (gameOver, NOT won) when the generator hits 0', () => {
    const s = fresh('defend');
    s.objective!.hp = 0;
    updateDefend(s, DEFEND_WAVES);
    expect(s.gameOver).toBe(true);
    expect(s.won).toBe(false);
  });

  it('wins when DEFEND_WAVES are survived with the generator alive', () => {
    const s = fresh('defend');
    s.objective!.hp = GENERATOR_HP; // still standing
    s.wave.index = DEFEND_WAVES + 1; // cleared the last defended wave
    updateDefend(s, DEFEND_WAVES);
    expect(s.won).toBe(true);
    expect(s.gameOver).toBe(true);
  });

  it('does not win early while a defended wave remains', () => {
    const s = fresh('defend');
    s.wave.index = DEFEND_WAVES; // last wave still in progress
    updateDefend(s, DEFEND_WAVES);
    expect(s.won).toBe(false);
    expect(s.gameOver).toBe(false);
  });
});

describe('A8 · endless mode is unchanged', () => {
  it('never opens an exit and never carries an objective', () => {
    const s = fresh('endless');
    s.wave.index = 500; // deep into a long run
    expect(isExtractionOpen(s)).toBe(false);
    updateExtraction(s, SIM_DT);
    updateDefend(s, DEFEND_WAVES);
    expect(s.extraction).toBeNull();
    expect(s.objective).toBeNull();
    expect(s.won).toBe(false);
    expect(s.gameOver).toBe(false);
  });
});

describe('A8 · mode + objective round-trip in the snapshot', () => {
  it('carries mode + generator objective onto a guest', () => {
    const host = fresh('defend');
    host.objective!.hp = 1234;
    const guest = fresh('endless'); // guest starts endless, adopts the host's mode
    applySnapshot(guest, snapshot(host));
    expect(guest.mode).toBe('defend');
    expect(guest.objective).toEqual({ x: GEN.x, y: GEN.y, hp: 1234, maxHp: GENERATOR_HP });
  });

  it('round-trips extraction mode with a null objective', () => {
    const host = fresh('extraction');
    const guest = fresh('endless');
    applySnapshot(guest, snapshot(host));
    expect(guest.mode).toBe('extraction');
    expect(guest.objective).toBeNull();
  });
});
