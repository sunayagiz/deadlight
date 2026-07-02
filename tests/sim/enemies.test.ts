import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../../src/config';
import { ZOMBIES, spawnEnemy, updateEnemies } from '../../src/sim/enemies';
import { createGameState } from '../../src/sim/state';
import type { Wall } from '../../src/sim/types';

describe('enemies', () => {
  it('spawnEnemy creates a typed enemy at the zone with full hp and a unique id', () => {
    const s = createGameState([]);
    const a = spawnEnemy(s, 'shambler', { x: 10, y: 20 });
    const b = spawnEnemy(s, 'runner', { x: 30, y: 40 });
    expect(a.pos).toEqual({ x: 10, y: 20 });
    expect(a.hp).toBe(ZOMBIES.shambler.hp);
    expect(b.hp).toBe(ZOMBIES.runner.hp);
    expect(a.id).not.toBe(b.id);
    expect(s.enemies).toHaveLength(2);
  });

  it('seeks the player: moves closer each tick', () => {
    const s = createGameState([]);
    s.player.pos = { x: 500, y: 100 };
    const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    const before = Math.hypot(500 - e.pos.x, 100 - e.pos.y);
    updateEnemies(s.enemies, s.players, s.walls, SIM_DT);
    const after = Math.hypot(500 - e.pos.x, 100 - e.pos.y);
    expect(after).toBeLessThan(before);
    expect(e.pos.x).toBeGreaterThan(100); // moved toward player on +x
  });

  it('runner closes distance faster than shambler', () => {
    const s = createGameState([]);
    s.player.pos = { x: 900, y: 100 };
    const slow = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    const fast = spawnEnemy(s, 'runner', { x: 100, y: 300 });
    s.player.pos = { x: 900, y: 100 }; // keep both roughly same horizontal chase
    for (let i = 0; i < 30; i++) updateEnemies(s.enemies, s.players, s.walls, SIM_DT);
    expect(fast.pos.x - 100).toBeGreaterThan(slow.pos.x - 100);
  });

  it('separation pushes two stacked enemies apart', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    const a = spawnEnemy(s, 'shambler', { x: 200, y: 200 });
    const b = spawnEnemy(s, 'shambler', { x: 203, y: 200 }); // almost on top of a
    const before = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    for (let i = 0; i < 10; i++) updateEnemies(s.enemies, s.players, s.walls, SIM_DT);
    const after = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(after).toBeGreaterThan(before);
  });

  it('is blocked by a wall between it and the player', () => {
    const wall: Wall = { x: 150, y: 0, w: 20, h: 400 };
    const s = createGameState([wall]);
    s.player.pos = { x: 400, y: 100 };
    const e = spawnEnemy(s, 'runner', { x: 100, y: 100 });
    for (let i = 0; i < 60; i++) updateEnemies(s.enemies, s.players, s.walls, SIM_DT);
    expect(e.pos.x).toBeLessThanOrEqual(150 - ZOMBIES.runner.radius + 0.001); // never crossed the wall
  });

  it('hitFlash decays toward zero', () => {
    const s = createGameState([]);
    const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
    e.hitFlash = 0.1;
    updateEnemies(s.enemies, s.players, s.walls, SIM_DT);
    expect(e.hitFlash).toBeLessThan(0.1);
  });
});
