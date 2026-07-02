import { describe, it, expect } from 'vitest';
import { PLAYER_MAX_HP, SIM_DT } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { ZOMBIES, spawnEnemy } from '../../src/sim/enemies';
import { createGameState } from '../../src/sim/state';
import type { BulletState } from '../../src/sim/types';

function bullet(x: number, y: number, damage: number): BulletState {
  return { id: 1, pos: { x, y }, vel: { x: 0, y: 0 }, ttl: 1, damage };
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

  it('player death clamps hp to 0 and sets gameOver', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.hp = 1;
    spawnEnemy(s, 'brute', { x: 100, y: 100 });
    for (let i = 0; i < 10; i++) updateCombat(s, SIM_DT);
    expect(s.player.hp).toBe(0);
    expect(s.gameOver).toBe(true);
  });
});
