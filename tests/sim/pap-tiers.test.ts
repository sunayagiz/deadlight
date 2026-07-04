import { describe, expect, it } from 'vitest';
import { PAP_MAX_TIER, PAP_TIER_AMMO, PAP_TIER_COST, PAP_TIER_DMG } from '../../src/config';
import { evolutionReady, papDamageMult, updateInteractions } from '../../src/sim/cod';
import { applySnapshot, snapshot } from '../../src/net/protocol';
import { createGameState, emptyInput } from '../../src/sim/state';
import type { GameState, Interactable } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([], [{ x: 0, y: 0 }], [], { x: 100, y: 100 }, { width: 3000, height: 3000 }, 1);
}
const use = () => [{ ...emptyInput(), use: true }];

/** A powered PaP machine the solo player is standing on, with cash to burn. */
function papState(cash = 1_000_000): GameState {
  const s = fresh();
  const it: Interactable = { kind: 'packapunch', x: 100, y: 100, cost: 5000, label: 'pap', needsPower: true };
  s.interactables = [it];
  s.players[0].pos = { x: it.x, y: it.y };
  s.powerOn = true;
  s.cash = cash;
  return s;
}

describe('B7 Pack-a-Punch tiers', () => {
  it('climbs I → II → III at a RISING cost, then caps at the max tier', () => {
    const s = papState();
    const w = s.players[0].weapon; // pistol
    const spent: number[] = [];

    for (let want = 1; want <= PAP_MAX_TIER; want++) {
      const before = s.cash;
      updateInteractions(s, use(), () => 0.5);
      expect(s.papTier[w]).toBe(want);
      spent.push(before - s.cash);
    }
    // each upgrade charged its tier's cost, and the costs strictly rise
    expect(spent).toEqual([PAP_TIER_COST[0], PAP_TIER_COST[1], PAP_TIER_COST[2]]);
    expect(PAP_TIER_COST[1]).toBeGreaterThan(PAP_TIER_COST[0]);
    expect(PAP_TIER_COST[2]).toBeGreaterThan(PAP_TIER_COST[1]);

    // maxed: a further use is a no-op and charges nothing
    const cashAtMax = s.cash;
    updateInteractions(s, use(), () => 0.5);
    expect(s.papTier[w]).toBe(PAP_MAX_TIER);
    expect(s.cash).toBe(cashAtMax);
  });

  it('the damage multiplier scales with the weapon tier', () => {
    const s = papState();
    const w = s.players[0].weapon;
    expect(papDamageMult(s, w)).toBe(PAP_TIER_DMG[0]); // tier 0 → ×1
    for (let tier = 1; tier <= PAP_MAX_TIER; tier++) {
      s.papTier[w] = tier;
      expect(papDamageMult(s, w)).toBe(PAP_TIER_DMG[tier]);
    }
    // strictly increasing across tiers
    expect(PAP_TIER_DMG[3]).toBeGreaterThan(PAP_TIER_DMG[2]);
    expect(PAP_TIER_DMG[2]).toBeGreaterThan(PAP_TIER_DMG[1]);
    expect(PAP_TIER_DMG[1]).toBeGreaterThan(PAP_TIER_DMG[0]);
  });

  it('a limited-ammo weapon gains a bigger reserve at each tier', () => {
    const s = papState();
    const p = s.players[0];
    p.owned = ['minigun'];
    p.weapon = 'minigun';
    p.ammo['minigun'] = 400; // base reserve
    updateInteractions(s, use(), () => 0.5); // → tier I
    expect(s.papTier['minigun']).toBe(1);
    expect(p.ammo['minigun']).toBeGreaterThan(400); // reserve grew
    expect(PAP_TIER_AMMO[2]).toBeGreaterThan(PAP_TIER_AMMO[1]); // and keeps growing per tier
  });

  it('evolution (A6) still requires the base to be at least tier I', () => {
    const s = papState();
    const p = s.players[0];
    p.owned = ['raygun'];
    p.weapon = 'raygun';
    p.catalysts = 1;
    expect(s.papTier['raygun'] ?? 0).toBe(0);
    expect(evolutionReady(s, p)).toBeUndefined(); // un-packed → no evolve
    s.papTier['raygun'] = 1;
    expect(evolutionReady(s, p)?.result).toBe('wunderwaffe'); // tier I + catalyst → ready
  });

  it('papTier round-trips through a snapshot (deterministic serialization)', () => {
    const s = papState();
    s.papTier = { pistol: 3, minigun: 1, raygun: 2 };
    const snap = snapshot(s);
    // survives a JSON hop over the wire
    const wire = JSON.parse(JSON.stringify(snap));
    const g = fresh();
    applySnapshot(g, wire);
    expect(g.papTier).toEqual({ pistol: 3, minigun: 1, raygun: 2 });
  });
});
