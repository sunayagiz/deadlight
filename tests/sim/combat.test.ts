import { describe, it, expect } from 'vitest';
import { BLEEDOUT_TIME, PLAYER_MAX_HP, SIM_DT } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { updateRevives } from '../../src/sim/coop';
import { ZOMBIES, spawnEnemy } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import type { BulletState } from '../../src/sim/types';

function bullet(x: number, y: number, damage: number): BulletState {
  return { id: 1, pos: { x, y }, vel: { x: 0, y: 0 }, ttl: 1, damage, splashRadius: 0, splashDamage: 0, hostile: false, owner: 0 };
}

describe('combat', () => {
  it('a bullet overlapping an enemy damages it and is consumed', () => {
    const s = createGameState([]);
    const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    s.bullets = [bullet(100, 100, 25)];
    updateCombat(s, SIM_DT);
    expect(e.hp).toBe(ZOMBIES.shambler.hp - 25);
    expect(s.bullets).toHaveLength(0); // consumed
    expect(e.hitFlash).toBeGreaterThan(0);
  });

  it('a bullet that hits nothing survives', () => {
    const s = createGameState([]);
    spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    s.bullets = [bullet(500, 500, 25)];
    updateCombat(s, SIM_DT);
    expect(s.bullets).toHaveLength(1);
  });

  it('lethal damage removes the enemy and counts a kill', () => {
    const s = createGameState([]);
    spawnEnemy(s, 'runner', { x: 100, y: 100 }); // 30 hp
    s.bullets = [bullet(100, 100, 999)];
    updateCombat(s, SIM_DT);
    expect(s.enemies).toHaveLength(0);
    expect(s.wave.killsThisWave).toBe(1);
  });

  it('an enemy touching the player deals contact damage over time', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    updateCombat(s, SIM_DT);
    expect(s.player.hp).toBeCloseTo(PLAYER_MAX_HP - ZOMBIES.shambler.contactDamage * SIM_DT);
  });

  it('a dashing player is immune to contact damage (i-frames)', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.dash.timeLeft = 0.1; // mid-dash
    spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    updateCombat(s, SIM_DT);
    expect(s.player.hp).toBe(PLAYER_MAX_HP);
  });

  it('a solo lethal hit DOWNS the player (Quick Revive), not instant death, while charges remain', () => {
    const s = createGameState([]); // 1 player
    s.player.pos = { x: 100, y: 100 };
    s.player.hp = 1;
    expect(s.player.selfReviveCharges).toBeGreaterThan(0);
    spawnEnemy(s, 'brute', { x: 100, y: 100 });
    for (let i = 0; i < 10; i++) updateCombat(s, SIM_DT);
    expect(s.player.hp).toBe(0);
    expect(s.player.downed).toBe(true); // downed, not dead — solo can self-revive
    expect(s.player.alive).toBe(true);
  });

  it('a solo player with no self-revive charges bleeds out to death', () => {
    const s = createGameState([]); // 1 player
    s.player.pos = { x: 100, y: 100 };
    s.player.hp = 1;
    s.player.selfReviveCharges = 0; // spent them all
    spawnEnemy(s, 'brute', { x: 100, y: 100 });
    for (let i = 0; i < 10; i++) updateCombat(s, SIM_DT);
    expect(s.player.downed).toBe(true); // still downed first (bleedout runs in updateRevives)
    const ticks = Math.ceil(BLEEDOUT_TIME / SIM_DT) + 2;
    for (let i = 0; i < ticks; i++) updateRevives(s, [emptyInput()], SIM_DT);
    expect(s.player.alive).toBe(false); // bled out => dead; stepSim raises gameOver
  });
});

describe('knockback', () => {
  it('a bullet shoves the enemy along its travel direction', () => {
    const s = createGameState([]);
    const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    s.bullets = [{ ...bullet(100, 100, 5), vel: { x: 900, y: 0 } }];
    updateCombat(s, SIM_DT);
    expect(e.pos.x).toBeGreaterThan(100); // pushed east
    expect(e.pos.y).toBe(100);
  });
});
