import { describe, expect, it } from 'vitest';
import { runReward } from '../../src/game/profile';
import { LOADOUTS, applyLoadout, getLoadout } from '../../src/game/loadouts';
import { WEAPONS } from '../../src/sim/weapons';
import { PERKS } from '../../src/sim/perks';
import { effectiveMaxHp } from '../../src/sim/perks';
import { createGameState } from '../../src/sim/state';

// ── currency-award formula (pure, sim-agnostic) ──────────────────────────────
describe('runReward', () => {
  it('scores wave reached ×5 plus one currency per 10 kills', () => {
    expect(runReward(1, 0)).toBe(5);
    expect(runReward(10, 0)).toBe(50);
    expect(runReward(10, 95)).toBe(50 + 9); // floor(95/10) = 9
    expect(runReward(3, 27)).toBe(15 + 2);
  });

  it('never goes negative and floors fractional inputs', () => {
    expect(runReward(0, 0)).toBe(0);
    expect(runReward(-5, -5)).toBe(0);
    expect(runReward(2.9, 19)).toBe(10 + 1); // floors wave and kills/10
  });
});

// ── loadout-table validity ───────────────────────────────────────────────────
describe('LOADOUTS table', () => {
  it('has a free, always-available default that mirrors the current start', () => {
    const def = getLoadout('default');
    expect(def.cost).toBe(0);
    expect(def.startWeapons).toEqual(['pistol', 'katana']);
  });

  it('every loadout has a unique id, a non-empty weapon list, and valid weapon ids', () => {
    const ids = new Set<string>();
    for (const l of LOADOUTS) {
      expect(ids.has(l.id)).toBe(false);
      ids.add(l.id);
      expect(l.startWeapons.length).toBeGreaterThan(0);
      for (const w of l.startWeapons) expect(WEAPONS[w]).toBeDefined();
    }
  });

  it('references only real perks and keeps non-default costs positive', () => {
    for (const l of LOADOUTS) {
      if (l.id !== 'default') expect(l.cost).toBeGreaterThan(0);
      for (const pid of Object.keys(l.startPerks ?? {})) {
        expect((PERKS as Record<string, unknown>)[pid]).toBeDefined();
      }
    }
  });

  it('getLoadout falls back to default for unknown ids', () => {
    expect(getLoadout('does-not-exist').id).toBe('default');
  });
});

// ── applyLoadout mutates plain sim data correctly (no localStorage involved) ──
describe('applyLoadout', () => {
  const fresh = () => createGameState([], [{ x: 0, y: 0 }], [], { x: 100, y: 100 }, { width: 800, height: 800 }, 1);

  it('sets owned/equipped and grants ammo for limited weapons (brawler → chainsaw)', () => {
    const s = fresh();
    applyLoadout(s, s.players[0], 'brawler');
    expect(s.players[0].owned).toEqual(['chainsaw', 'katana']);
    expect(s.players[0].weapon).toBe('chainsaw');
    expect(s.players[0].ammo.chainsaw).toBe(WEAPONS.chainsaw.startAmmo);
  });

  it('seeds shared perks and applies the max-HP bonus via vigor', () => {
    const s = fresh();
    applyLoadout(s, s.players[0], 'brawler');
    expect(s.perks.thorns).toBe(1);
    expect(s.perks.vigor).toBe(1); // +25 max HP folded into one vigor stack
    expect(s.players[0].hp).toBe(effectiveMaxHp(s)); // starts full at the raised cap
  });

  it('grants an extra self-revive charge for medic and seeds regen', () => {
    const s = fresh();
    const before = s.players[0].selfReviveCharges;
    applyLoadout(s, s.players[0], 'medic');
    expect(s.players[0].selfReviveCharges).toBe(before + 1);
    expect(s.perks.regen).toBe(1);
    expect(s.players[0].weapon).toBe('pistol');
  });

  it('default loadout keeps the vanilla start', () => {
    const s = fresh();
    applyLoadout(s, s.players[0], 'default');
    expect(s.players[0].owned).toEqual(['pistol', 'katana']);
    expect(s.perks).toEqual({});
  });
});
