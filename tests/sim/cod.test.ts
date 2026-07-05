import { describe, expect, it } from 'vitest';
import { CASH_PER_HIT, COST_MYSTERY_BOX, COST_MYSTERY_BOX_FIRESALE, PAP_TIER_COST, PAP_TIER_DMG } from '../../src/config';
import { applyPowerUp, updateInteractions } from '../../src/sim/cod';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy } from '../../src/sim/enemies';
import { buildDogPack, isDogRound } from '../../src/sim/waves';
import { createGameState, emptyInput } from '../../src/sim/state';
import type { BulletState, GameState, Interactable } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([], [{ x: 0, y: 0 }], [], { x: 100, y: 100 }, { width: 3000, height: 3000 }, 1);
}
function bulletAt(x: number, y: number, dmg: number): BulletState {
  return { id: 1, pos: { x, y }, vel: { x: 100, y: 0 }, ttl: 1, damage: dmg, splashRadius: 0, splashDamage: 0, hostile: false, owner: 0, lag: 0 };
}
const use = () => [{ ...emptyInput(), use: true }];

describe('COD economy', () => {
  it('awards points per non-lethal hit and a bounty on kill', () => {
    const s = fresh();
    const e = spawnEnemy(s, 'brute', { x: 200, y: 200 }); // tanky, survives one hit
    s.bullets.push({ ...bulletAt(200, 200, 20), id: 1 });
    updateCombat(s, 1 / 60, () => 0.99);
    expect(s.cash).toBe(CASH_PER_HIT); // +10 for the hit
    expect(e.hp).toBeGreaterThan(0);
  });

  it('Double Points doubles cash gains', () => {
    const s = fresh();
    s.doublePtsT = 5;
    spawnEnemy(s, 'brute', { x: 200, y: 200 });
    s.bullets.push(bulletAt(200, 200, 20));
    updateCombat(s, 1 / 60, () => 0.99);
    expect(s.cash).toBe(CASH_PER_HIT * 2);
  });

  it('Insta-Kill one-shots normal zombies but not bosses', () => {
    const s = fresh();
    s.instaKillT = 5;
    const z = spawnEnemy(s, 'brute', { x: 200, y: 200 });
    const boss = spawnEnemy(s, 'bloater', { x: 600, y: 600 });
    s.bullets.push(bulletAt(200, 200, 1));
    s.bullets.push({ ...bulletAt(600, 600, 1), id: 2 });
    updateCombat(s, 1 / 60, () => 0.99);
    expect(s.enemies.includes(z)).toBe(false); // zombie died
    expect(boss.hp).toBeGreaterThan(0); // boss survived instakill
  });
});

describe('COD power-ups', () => {
  it('Max Ammo refills owned limited weapons', () => {
    const s = fresh();
    s.players[0].owned.push('minigun');
    s.players[0].ammo.minigun = 3;
    applyPowerUp(s, 'maxammo');
    expect(s.players[0].ammo.minigun).toBeGreaterThan(3);
    expect(s.notice).toBe('MAX AMMO');
  });

  it('Nuke clears normal zombies and pays the squad', () => {
    const s = fresh();
    spawnEnemy(s, 'shambler', { x: 200, y: 200 });
    spawnEnemy(s, 'runner', { x: 300, y: 300 });
    applyPowerUp(s, 'nuke');
    updateCombat(s, 1 / 60, () => 0.99); // reaps the zeroed enemies
    expect(s.enemies.length).toBe(0);
    expect(s.cash).toBeGreaterThan(0);
  });
});

describe('COD interactables', () => {
  function withInteractable(it: Interactable, cash: number): GameState {
    const s = fresh();
    s.interactables = [it];
    s.players[0].pos = { x: it.x, y: it.y };
    s.cash = cash;
    return s;
  }

  it('Mystery Box charges 950, grants a weapon, and Fire Sale drops the price', () => {
    const s = withInteractable({ kind: 'mysterybox', x: 100, y: 100, cost: 950, label: 'box', boxUses: 0, homes: [{ x: 100, y: 100 }] }, 1000);
    const owned0 = s.players[0].owned.length;
    updateInteractions(s, use(), () => 0.5);
    expect(s.cash).toBe(1000 - COST_MYSTERY_BOX);
    expect(s.players[0].owned.length).toBeGreaterThan(owned0);
    // fire sale price
    const s2 = withInteractable({ kind: 'mysterybox', x: 100, y: 100, cost: 950, label: 'box', boxUses: 0, homes: [{ x: 100, y: 100 }] }, 1000);
    s2.fireSaleT = 5;
    updateInteractions(s2, use(), () => 0.5);
    expect(s2.cash).toBe(1000 - COST_MYSTERY_BOX_FIRESALE);
  });

  it('Pack-a-Punch needs power, then upgrades the held weapon to tier I', () => {
    const s = withInteractable({ kind: 'packapunch', x: 100, y: 100, cost: 5000, label: 'pap', needsPower: true }, 6000);
    updateInteractions(s, use(), () => 0.5);
    expect(s.papTier[s.players[0].weapon] ?? 0).toBe(0); // gated: power off
    expect(s.cash).toBe(6000); // not charged
    s.powerOn = true;
    updateInteractions(s, use(), () => 0.5);
    expect(s.papTier[s.players[0].weapon]).toBe(1);
    expect(s.cash).toBe(6000 - PAP_TIER_COST[0]); // tier-I cost
  });

  it('wall-buy grants the wall gun; power switch flips power', () => {
    const wall = withInteractable({ kind: 'wallbuy', x: 100, y: 100, cost: 500, label: 'Shotgun', weapon: 'shotgun' }, 800);
    updateInteractions(wall, use(), () => 0.5);
    expect(wall.players[0].owned).toContain('shotgun');
    expect(wall.cash).toBe(300);

    const power = withInteractable({ kind: 'power', x: 100, y: 100, cost: 0, label: 'Power' }, 0);
    expect(power.powerOn).toBe(false);
    updateInteractions(power, use(), () => 0.5);
    expect(power.powerOn).toBe(true);
  });

  it('applies a rising Pack-a-Punch multiplier per tier', () => {
    // sanity: each tier is a strictly bigger buff than the last
    expect(PAP_TIER_DMG[0]).toBe(1);
    expect(PAP_TIER_DMG[1]).toBeGreaterThan(PAP_TIER_DMG[0]);
    expect(PAP_TIER_DMG[2]).toBeGreaterThan(PAP_TIER_DMG[1]);
    expect(PAP_TIER_DMG[3]).toBeGreaterThan(PAP_TIER_DMG[2]);
  });
});

describe('COD dog rounds', () => {
  it('schedules hellhound rounds and builds a hound pack', () => {
    expect(isDogRound(5)).toBe(true);
    expect(isDogRound(6)).toBe(false);
    expect(isDogRound(4)).toBe(false); // boss wave, not a dog round
    const pack = buildDogPack(10, 1);
    expect(pack.length).toBeGreaterThan(0);
    expect(pack.every((t) => t === 'hound')).toBe(true);
  });
});
