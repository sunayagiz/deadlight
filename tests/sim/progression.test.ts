import { describe, expect, it } from 'vitest';
import { CASH_PER_KILL, EXTRACT_HOLD, EXTRACTION_WAVE, PLAYER_MAX_HP } from '../../src/config';
import { spawnEnemy } from '../../src/sim/enemies';
import { updateExtraction } from '../../src/sim/extraction';
import { choosePerk, damageMult, effectiveMaxHp, rollDraft } from '../../src/sim/perks';
import { buy, SHOP } from '../../src/sim/shop';
import { createGameState } from '../../src/sim/state';
import { updateCombat } from '../../src/sim/combat';
import type { GameState } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([], [], [], { x: 100, y: 100 }, { width: 2000, height: 2000 }, 1);
}

describe('economy', () => {
  it('awards cash when an enemy dies, scaled by its cost', () => {
    const s = fresh();
    const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    e.hp = 0; // combat will reap it this tick
    updateCombat(s, 1 / 60, () => 0.99); // rng high so no loot drop
    expect(s.cash).toBe(CASH_PER_KILL * 1); // shambler cost 1
  });

  it('buys a medkit only when hurt and deducts cash', () => {
    const s = fresh();
    s.cash = 500;
    const heal = SHOP.findIndex((i) => i.id === 'heal');
    s.players[0].hp = 20;
    expect(buy(s, 0, heal)).toBe(true);
    expect(s.players[0].hp).toBeGreaterThan(20);
    expect(s.cash).toBe(500 - SHOP[heal].cost);
    // at full hp the buy is refused (no waste)
    s.players[0].hp = effectiveMaxHp(s);
    const before = s.cash;
    expect(buy(s, 0, heal)).toBe(false);
    expect(s.cash).toBe(before);
  });

  it('refuses a purchase you cannot afford', () => {
    const s = fresh();
    s.cash = 10;
    expect(buy(s, 0, SHOP.findIndex((i) => i.id === 'minigun'))).toBe(false);
    expect(s.cash).toBe(10);
  });

  it('grants a new weapon on purchase', () => {
    const s = fresh();
    s.cash = 1000;
    const smg = SHOP.findIndex((i) => i.id === 'smg');
    expect(s.players[0].owned).not.toContain('smg');
    expect(buy(s, 0, smg)).toBe(true);
    expect(s.players[0].owned).toContain('smg');
  });
});

describe('perks', () => {
  it('rolls a distinct draft and applying one raises the damage multiplier', () => {
    const s = fresh();
    const draft = rollDraft(s, () => 0); // deterministic
    expect(draft.length).toBeGreaterThan(0);
    expect(new Set(draft).size).toBe(draft.length); // distinct
    s.perkDraft = ['damage', 'speed', 'vigor'];
    expect(damageMult(s)).toBe(1);
    choosePerk(s, 0); // pick damage
    expect(s.perks.damage).toBe(1);
    expect(damageMult(s)).toBeCloseTo(1.18);
    expect(s.perkDraft).toBeNull();
  });

  it('vigor raises max hp and heals immediately', () => {
    const s = fresh();
    s.players[0].hp = PLAYER_MAX_HP;
    s.perkDraft = ['vigor', 'speed', 'regen'];
    choosePerk(s, 0);
    expect(effectiveMaxHp(s)).toBe(PLAYER_MAX_HP + 25);
    expect(s.players[0].hp).toBe(PLAYER_MAX_HP + 25);
  });
});

describe('extraction', () => {
  it('wins the run after holding the exit for EXTRACT_HOLD seconds', () => {
    const s = fresh();
    s.wave.index = EXTRACTION_WAVE;
    s.extractPoint = { x: 100, y: 100 };
    s.players[0].pos = { x: 100, y: 100 }; // standing on the exit
    for (let t = 0; t < EXTRACT_HOLD * 60 + 5; t++) updateExtraction(s, 1 / 60);
    expect(s.won).toBe(true);
    expect(s.gameOver).toBe(true);
  });

  it('does not trigger before the final wave', () => {
    const s = fresh();
    s.wave.index = 1;
    updateExtraction(s, 1);
    expect(s.extraction).toBeNull();
    expect(s.won).toBe(false);
  });

  it('progress bleeds back out when the exit is abandoned', () => {
    const s = fresh();
    s.wave.index = EXTRACTION_WAVE;
    s.extractPoint = { x: 100, y: 100 };
    s.players[0].pos = { x: 100, y: 100 };
    for (let t = 0; t < 120; t++) updateExtraction(s, 1 / 60); // 2s of holding
    const held = s.extraction!.progress;
    expect(held).toBeGreaterThan(0);
    s.players[0].pos = { x: 9999, y: 9999 }; // walk away
    updateExtraction(s, 1);
    expect(s.extraction!.progress).toBeLessThan(held);
  });
});
