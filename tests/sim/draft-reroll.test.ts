import { describe, expect, it } from 'vitest';
import { BANISH_COST, PERK_CHOICES, REROLL_BASE, REROLL_STEP } from '../../src/config';
import { SIM_DT } from '../../src/config';
import { banishPerk, rerollCost, rerollDraft, rollDraft } from '../../src/sim/perks';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import type { GameState } from '../../src/sim/types';

/** Minimal state for pure perk-draft logic. */
function fresh(): GameState {
  return createGameState([{ x: 0, y: 0, w: 10, h: 10 }], [], [], { x: 100, y: 100 }, { width: 800, height: 600 }, 1);
}

/** Deterministic rng cycling through a fixed value sequence. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('draft reroll', () => {
  it('spends cash and rolls a fresh set of options deterministically', () => {
    const s = fresh();
    s.cash = 1000;
    s.perkDraft = rollDraft(s, () => 0.99); // seed a known draft
    const before = s.perkDraft.slice();

    const ok = rerollDraft(s, seq([0.1, 0.5, 0.9]));
    expect(ok).toBe(true);
    expect(s.cash).toBe(1000 - REROLL_BASE);
    expect(s.rerollCount).toBe(1);
    expect(s.perkDraft!.length).toBe(PERK_CHOICES);
    expect(new Set(s.perkDraft!).size).toBe(s.perkDraft!.length); // distinct

    // same seed + same state → same roll (determinism for co-op/tests)
    const t = fresh();
    t.cash = 1000;
    t.perkDraft = before;
    rerollDraft(t, seq([0.1, 0.5, 0.9]));
    expect(t.perkDraft).toEqual(s.perkDraft);
  });

  it('cost rises with each reroll within the same draft', () => {
    const s = fresh();
    s.cash = 5000;
    s.perkDraft = rollDraft(s, () => 0);
    expect(rerollCost(s)).toBe(REROLL_BASE);
    rerollDraft(s, () => 0.3);
    expect(rerollCost(s)).toBe(REROLL_BASE + REROLL_STEP);
    rerollDraft(s, () => 0.6);
    expect(rerollCost(s)).toBe(REROLL_BASE + 2 * REROLL_STEP);
    // cumulative spend = 150 + 300 = 450
    expect(s.cash).toBe(5000 - (REROLL_BASE + (REROLL_BASE + REROLL_STEP)));
  });

  it('is a no-op when the squad cannot afford it', () => {
    const s = fresh();
    s.cash = REROLL_BASE - 1;
    s.perkDraft = rollDraft(s, () => 0);
    const before = s.perkDraft.slice();
    const ok = rerollDraft(s, () => 0.5);
    expect(ok).toBe(false);
    expect(s.cash).toBe(REROLL_BASE - 1);
    expect(s.rerollCount).toBe(0);
    expect(s.perkDraft).toEqual(before);
  });

  it('is a no-op when no draft is pending', () => {
    const s = fresh();
    s.cash = 1000;
    s.perkDraft = null;
    expect(rerollDraft(s, () => 0.5)).toBe(false);
    expect(s.cash).toBe(1000);
  });
});

describe('draft banish', () => {
  it('removes a perk from the pool so rollDraft never offers it again', () => {
    const s = fresh();
    s.cash = 1000;
    s.perkDraft = ['damage', 'firerate', 'speed'];
    const ok = banishPerk(s, 0, () => 0); // banish 'damage'
    expect(ok).toBe(true);
    expect(s.cash).toBe(1000 - BANISH_COST);
    expect(s.banished).toContain('damage');
    // draft still shows a full set, and the banished perk is gone from it
    expect(s.perkDraft!.length).toBe(PERK_CHOICES);
    expect(s.perkDraft).not.toContain('damage');

    // exhaustively roll many drafts — 'damage' must never resurface
    for (let i = 0; i < 200; i++) {
      const draft = rollDraft(s, seq([0.05, 0.37, 0.61, 0.83, 0.19, 0.5]));
      expect(draft).not.toContain('damage');
    }
  });

  it('refills the banished slot with a fresh, non-duplicate option', () => {
    const s = fresh();
    s.cash = 1000;
    s.perkDraft = ['damage', 'firerate', 'speed'];
    banishPerk(s, 1, seq([0.5])); // banish 'firerate', refill slot 1
    expect(s.perkDraft!.length).toBe(PERK_CHOICES);
    expect(new Set(s.perkDraft!).size).toBe(s.perkDraft!.length); // still distinct
    expect(s.perkDraft![0]).toBe('damage'); // untouched slots preserved
    expect(s.perkDraft![2]).toBe('speed');
    expect(s.perkDraft).not.toContain('firerate');
  });

  it('is a no-op when broke or when no draft is pending', () => {
    const s = fresh();
    s.cash = BANISH_COST - 1;
    s.perkDraft = ['damage', 'firerate', 'speed'];
    expect(banishPerk(s, 0, () => 0)).toBe(false);
    expect(s.banished).toEqual([]);
    s.perkDraft = null;
    s.cash = 1000;
    expect(banishPerk(s, 0, () => 0)).toBe(false);
  });
});

describe('draft agency flows through PlayerInput (host-authoritative)', () => {
  it('reroll and banish inputs are honored during intermission', () => {
    const s = fresh(); // starts in intermission (wave.phase === 'intermission')
    s.cash = 1000;
    s.perkDraft = ['damage', 'firerate', 'speed'];

    // reroll via input
    const rr = emptyInput();
    rr.reroll = true;
    stepSim(s, [rr], SIM_DT, seq([0.2, 0.5, 0.8]));
    expect(s.rerollCount).toBe(1);
    expect(s.cash).toBeLessThan(1000);

    // banish option 0 via input
    const cashAfterReroll = s.cash;
    const banished = s.perkDraft![0];
    const bn = emptyInput();
    bn.banish = 0;
    stepSim(s, [bn], SIM_DT, seq([0.4]));
    expect(s.banished).toContain(banished);
    expect(s.cash).toBeLessThan(cashAfterReroll);
  });
});
