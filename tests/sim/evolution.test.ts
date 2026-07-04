import { describe, expect, it } from 'vitest';
import { COST_WEAPON_CATALYST, PAP_DMG_MULT } from '../../src/config';
import { evolutionReady, updateInteractions } from '../../src/sim/cod';
import { buy, SHOP } from '../../src/sim/shop';
import { createGameState, emptyInput } from '../../src/sim/state';
import { EVOLUTIONS, evolutionFor, WEAPONS } from '../../src/sim/weapons';
import type { GameState, Interactable } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([], [{ x: 0, y: 0 }], [], { x: 100, y: 100 }, { width: 3000, height: 3000 }, 1);
}
const use = () => [{ ...emptyInput(), use: true }];
const CATALYST_INDEX = SHOP.findIndex((i) => i.kind === 'catalyst');

/** A PaP machine the player is standing on, power already flipped. */
function papState(cash = 0): GameState {
  const s = fresh();
  const it: Interactable = { kind: 'packapunch', x: 100, y: 100, cost: 5000, label: 'pap', needsPower: true };
  s.interactables = [it];
  s.players[0].pos = { x: it.x, y: it.y };
  s.powerOn = true;
  s.cash = cash;
  return s;
}

describe('A6 weapon evolutions', () => {
  it('shop Weapon Catalyst grants a token and deducts its cost', () => {
    const s = fresh();
    s.cash = COST_WEAPON_CATALYST + 100;
    expect(s.players[0].catalysts).toBe(0);
    const ok = buy(s, 0, CATALYST_INDEX);
    expect(ok).toBe(true);
    expect(s.players[0].catalysts).toBe(1);
    expect(s.cash).toBe(100);
  });

  it('cannot afford a catalyst → no token, no charge', () => {
    const s = fresh();
    s.cash = COST_WEAPON_CATALYST - 1;
    expect(buy(s, 0, CATALYST_INDEX)).toBe(false);
    expect(s.players[0].catalysts).toBe(0);
    expect(s.cash).toBe(COST_WEAPON_CATALYST - 1);
  });

  it('every evolution recipe maps a real base to a real evolved weapon', () => {
    for (const evo of EVOLUTIONS) {
      expect(WEAPONS[evo.base]).toBeTruthy();
      expect(WEAPONS[evo.result]).toBeTruthy();
      expect(evolutionFor(evo.base)).toEqual(evo);
    }
  });

  it('PaP + a packed base + a catalyst + a recipe → evolves (free), consuming the catalyst', () => {
    const s = papState(0); // cash 0 proves the evolve itself is free
    const p = s.players[0];
    p.owned = ['raygun'];
    p.weapon = 'raygun';
    s.papTier['raygun'] = 1;
    p.catalysts = 1;
    p.ammo['raygun'] = 40;

    expect(evolutionReady(s, p)?.result).toBe('wunderwaffe');
    updateInteractions(s, use(), () => 0.5);

    expect(p.weapon).toBe('wunderwaffe');
    expect(p.owned).toContain('wunderwaffe');
    expect(p.owned).not.toContain('raygun'); // the base slot is replaced, not duplicated
    expect(p.catalysts).toBe(0); // token spent
    expect(s.papTier['wunderwaffe']).toBe(1); // evolved form is Pack-a-Punched from birth
    expect(p.ammo['wunderwaffe']).toBe(WEAPONS.wunderwaffe.startAmmo! * 2); // packed reserve
    expect(s.cash).toBe(0); // free
  });

  it('evolving a limited base that started infinite-ammo (shotgun→dragonsbreath) grants a reserve', () => {
    const s = papState();
    const p = s.players[0];
    p.owned = ['shotgun'];
    p.weapon = 'shotgun';
    s.papTier['shotgun'] = 1;
    p.catalysts = 1;
    updateInteractions(s, use(), () => 0.5);
    expect(p.weapon).toBe('dragonsbreath');
    expect(p.ammo['dragonsbreath']).toBe(WEAPONS.dragonsbreath.startAmmo! * 2);
  });

  it('no catalyst → normal PaP, no evolution', () => {
    const s = papState(6000);
    const p = s.players[0];
    p.owned = ['raygun'];
    p.weapon = 'raygun';
    p.catalysts = 0;
    // first use packs the base (normal PaP), never touching the evolution path
    updateInteractions(s, use(), () => 0.5);
    expect(p.weapon).toBe('raygun');
    expect(s.papTier['raygun']).toBe(1);
    expect(p.owned).not.toContain('wunderwaffe');
    expect(s.cash).toBe(1000); // charged the normal 5000
  });

  it('base not yet packed → normal PaP first, no evolution even with a catalyst', () => {
    const s = papState(6000);
    const p = s.players[0];
    p.owned = ['raygun'];
    p.weapon = 'raygun';
    p.catalysts = 1;
    expect(evolutionReady(s, p)).toBeUndefined(); // base isn't packed yet
    updateInteractions(s, use(), () => 0.5);
    expect(p.weapon).toBe('raygun'); // just got packed, not evolved
    expect(s.papTier['raygun']).toBe(1);
    expect(p.catalysts).toBe(1); // catalyst untouched
    expect(s.cash).toBe(1000);
  });

  it('a base with no recipe never evolves (pistol)', () => {
    const s = papState(6000);
    const p = s.players[0];
    p.weapon = 'pistol';
    s.papTier['pistol'] = 1;
    p.catalysts = 1;
    expect(evolutionReady(s, p)).toBeUndefined();
    updateInteractions(s, use(), () => 0.5);
    expect(p.weapon).toBe('pistol');
    expect(p.catalysts).toBe(1);
  });

  it('every evolved weapon out-damages its Pack-a-Punched base (both packed)', () => {
    for (const evo of EVOLUTIONS) {
      const basePacked = WEAPONS[evo.base].damage * PAP_DMG_MULT;
      const evolvedPacked = WEAPONS[evo.result].damage * PAP_DMG_MULT; // evolved is packed from birth
      expect(evolvedPacked).toBeGreaterThan(basePacked);
    }
  });
});
