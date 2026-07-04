import { describe, expect, it } from 'vitest';
import { LEVELS_FOR, PERK_MAX_LEVEL, RARITY_WEIGHTS } from '../../src/config';
import { applySnapshot, snapshot } from '../../src/net/protocol';
import {
  PERKS,
  choosePerk,
  greedMult,
  lifestealFrac,
  rollDraft,
  rollRarity,
  stacked,
  thornsDamage,
} from '../../src/sim/perks';
import { mulberry32 } from '../../src/sim/rng';
import { createGameState } from '../../src/sim/state';
import type { GameState, Rarity } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([{ x: 0, y: 0, w: 10, h: 10 }], [], [], { x: 100, y: 100 }, { width: 800, height: 600 }, 1);
}

describe('B6 rarity tiers', () => {
  it('rolls rarity deterministically under a seeded rng', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 100; i++) expect(rollRarity(a, 1)).toBe(rollRarity(b, 1));
  });

  it('is weighted heavily toward common', () => {
    const rng = mulberry32(99);
    const counts: Record<Rarity, number> = { common: 0, rare: 0, legendary: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) counts[rollRarity(rng, 1)]++;
    // common should dominate; legendary should be rare — sanity bands around the weights
    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.legendary);
    expect(counts.common / N).toBeGreaterThan(0.6); // ~70% common at wave 1
    expect(counts.legendary / N).toBeLessThan(0.12); // ~6% legendary
    // matches the configured weight ordering
    expect(RARITY_WEIGHTS.common).toBeGreaterThan(RARITY_WEIGHTS.rare);
    expect(RARITY_WEIGHTS.rare).toBeGreaterThan(RARITY_WEIGHTS.legendary);
  });

  it('drifts slightly toward shinier tiers on later waves', () => {
    const early = mulberry32(7);
    const late = mulberry32(7);
    const shinyEarly = { rare: 0, legendary: 0 };
    const shinyLate = { rare: 0, legendary: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const e = rollRarity(early, 1);
      const l = rollRarity(late, 40);
      if (e !== 'common') shinyEarly[e]++;
      if (l !== 'common') shinyLate[l]++;
    }
    expect(shinyLate.rare + shinyLate.legendary).toBeGreaterThan(shinyEarly.rare + shinyEarly.legendary);
  });

  it('rollDraft tags every option with a rarity', () => {
    const s = fresh();
    const draft = rollDraft(s, mulberry32(3));
    expect(draft.length).toBeGreaterThan(0);
    for (const o of draft) {
      expect(typeof o.id).toBe('string');
      expect(['common', 'rare', 'legendary']).toContain(o.rarity);
    }
  });
});

describe('B6 rarity → levels granted', () => {
  it('common grants +1, rare +2, legendary +3', () => {
    for (const [rarity, want] of Object.entries(LEVELS_FOR) as [Rarity, number][]) {
      const s = fresh();
      s.perkDraft = [{ id: 'damage', rarity }];
      choosePerk(s, 0);
      expect(s.perks.damage).toBe(want);
    }
  });

  it('a legendary pick grants +3 levels, clamped at PERK_MAX_LEVEL', () => {
    const s = fresh();
    s.perks.thorns = PERK_MAX_LEVEL - 1; // one below cap
    s.perkDraft = [{ id: 'thorns', rarity: 'legendary' }];
    choosePerk(s, 0);
    expect(s.perks.thorns).toBe(PERK_MAX_LEVEL); // +3 would overshoot → clamped
  });

  it('vigor grants its per-level HP for every level the rarity gives', () => {
    const s = fresh();
    const base = s.players[0].hp;
    s.perkDraft = [{ id: 'vigor', rarity: 'rare' }]; // +2 levels
    choosePerk(s, 0);
    expect(s.perks.vigor).toBe(2);
    expect(s.players[0].hp).toBe(base + PERKS.vigor.coeff * 2);
  });
});

describe('B6 hyperbolic stacking', () => {
  const hyperPerks = ['lifesteal', 'thorns', 'greed'] as const;

  it('the percentage/chance perks are declared hyperbolic; the additive ones stay linear', () => {
    for (const id of hyperPerks) expect(PERKS[id].stack).toBe('hyperbolic');
    for (const id of ['damage', 'firerate', 'speed', 'vigor', 'regen'] as const) {
      expect(PERKS[id].stack).toBe('linear');
    }
  });

  it('hyperbolic value is 0 at level 0, monotonic increasing, and approaches but never exceeds its cap', () => {
    for (const id of hyperPerks) {
      const def = PERKS[id];
      const cap = def.cap!;
      expect(stacked(def, 0)).toBe(0);
      let prev = -1;
      for (let lvl = 0; lvl <= 1000; lvl++) {
        const v = stacked(def, lvl);
        expect(v).toBeGreaterThan(prev); // strictly increasing
        expect(v).toBeLessThan(cap); // never reaches the cap
        prev = v;
      }
      // deep stacks are within a hair of the cap (it truly approaches it)
      expect(stacked(def, 100000)).toBeGreaterThan(cap * 0.99);
    }
  });

  it('linear value scales without a cap', () => {
    const def = PERKS.damage;
    expect(stacked(def, 1)).toBeCloseTo(def.coeff);
    expect(stacked(def, 5)).toBeCloseTo(def.coeff * 5);
  });

  it('the getters read the hyperbolic curve (cap-bounded, monotonic)', () => {
    const s = fresh();
    let ls = -1;
    let th = -1;
    let gr = -1;
    for (let lvl = 1; lvl <= PERK_MAX_LEVEL; lvl++) {
      s.perks.lifesteal = lvl;
      s.perks.thorns = lvl;
      s.perks.greed = lvl;
      expect(lifestealFrac(s)).toBeGreaterThan(ls);
      expect(thornsDamage(s)).toBeGreaterThan(th);
      expect(greedMult(s)).toBeGreaterThan(gr);
      ls = lifestealFrac(s);
      th = thornsDamage(s);
      gr = greedMult(s);
    }
    expect(lifestealFrac(s)).toBeLessThan(PERKS.lifesteal.cap!);
    expect(thornsDamage(s)).toBeLessThan(PERKS.thorns.cap!);
    expect(greedMult(s)).toBeLessThan(1 + PERKS.greed.cap!);
  });
});

describe('B6 draft shape round-trips over the wire', () => {
  it('serializes {id,rarity} options through the snapshot', () => {
    const host = fresh();
    host.perkDraft = [
      { id: 'lifesteal', rarity: 'legendary' },
      { id: 'thorns', rarity: 'rare' },
      { id: 'greed', rarity: 'common' },
    ];
    const guest = fresh();
    applySnapshot(guest, snapshot(host));
    expect(guest.perkDraft).toEqual(host.perkDraft);
  });
});
