import { describe, it, expect } from 'vitest';
import { LOOT_TTL, SIM_DT } from '../../src/config';
import { dropLoot, updateLoot } from '../../src/sim/loot';
import { createGameState } from '../../src/sim/state';
import { cycleWeapon, equipWeapon } from '../../src/sim/weapons';
import type { LootState } from '../../src/sim/types';

function place(s: ReturnType<typeof createGameState>, loot: Partial<LootState>): LootState {
  const l: LootState = {
    id: s.nextLootId++,
    pos: { x: 0, y: 0 },
    kind: 'ammo',
    amount: 0,
    ttl: LOOT_TTL,
    ...loot,
  };
  s.loot.push(l);
  return l;
}

describe('loot drops', () => {
  it('drops nothing when the roll fails, drops an item when it passes', () => {
    const s = createGameState([]);
    dropLoot(s, { x: 5, y: 5 }, () => 0.99); // above LOOT_DROP_CHANCE
    expect(s.loot).toHaveLength(0);
    dropLoot(s, { x: 5, y: 5 }, () => 0); // passes, picks table[0]
    expect(s.loot).toHaveLength(1);
    expect(s.loot[0].pos).toEqual({ x: 5, y: 5 });
  });
});

describe('loot pickup', () => {
  it('walking over a health pack heals (capped at max HP)', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.hp = 20;
    place(s, { kind: 'health', amount: 55, pos: { x: 100, y: 100 } });
    updateLoot(s, SIM_DT);
    expect(s.player.hp).toBe(75);
    expect(s.loot).toHaveLength(0);
  });

  it('never drops a weapon — only ammo and health', () => {
    const s = createGameState([]);
    const vals = [0, 0.09, 0, 0.29, 0, 0.49, 0, 0.69, 0, 0.89]; // (pass, pick) pairs across the table
    let i = 0;
    const rng = () => vals[i++ % vals.length];
    for (let k = 0; k < 40; k++) dropLoot(s, { x: 0, y: 0 }, rng);
    expect(s.loot.length).toBeGreaterThan(0);
    expect(s.loot.every((l) => l.kind === 'ammo' || l.kind === 'health')).toBe(true);
  });

  it('an ammo pickup resupplies the owned limited weapons', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.owned.push('minigun');
    s.player.ammo.minigun = 10;
    place(s, { kind: 'ammo', pos: { x: 100, y: 100 } });
    updateLoot(s, SIM_DT);
    expect(s.player.ammo.minigun).toBeGreaterThan(10);
  });

  it('does not pick up loot that is out of reach, and despawns it after ttl', () => {
    const s = createGameState([]);
    s.player.pos = { x: 0, y: 0 };
    const l = place(s, { pos: { x: 500, y: 500 }, ttl: SIM_DT * 1.5 });
    updateLoot(s, SIM_DT);
    expect(s.loot).toContain(l); // still there, not reached
    updateLoot(s, SIM_DT); // ttl now elapsed
    expect(s.loot).toHaveLength(0);
  });
});

describe('weapon switching', () => {
  it('equips only owned weapons', () => {
    const s = createGameState([]);
    equipWeapon(s.player, 'katana'); // owned
    expect(s.player.weapon).toBe('katana');
    equipWeapon(s.player, 'minigun'); // not owned
    expect(s.player.weapon).toBe('katana');
  });

  it('cycles through the owned set both directions', () => {
    const s = createGameState([]);
    s.player.owned = ['pistol', 'katana', 'shotgun'];
    s.player.weapon = 'pistol';
    cycleWeapon(s.player, 1);
    expect(s.player.weapon).toBe('katana');
    cycleWeapon(s.player, -1);
    expect(s.player.weapon).toBe('pistol');
    cycleWeapon(s.player, -1); // wraps to the end
    expect(s.player.weapon).toBe('shotgun');
  });
});
