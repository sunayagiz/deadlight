import { describe, it, expect } from 'vitest';
import { PLAYER_RADIUS, PLAYER_SPEED, SIM_DT } from '../../src/config';
import { updateMovement } from '../../src/sim/movement';
import { createPlayer, emptyInput } from '../../src/sim/state';
import type { Wall } from '../../src/sim/types';

describe('updateMovement', () => {
  it('moves at PLAYER_SPEED', () => {
    const p = createPlayer(100, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1 }, [], SIM_DT);
    expect(p.pos.x).toBeCloseTo(100 + PLAYER_SPEED * SIM_DT);
    expect(p.pos.y).toBe(100);
  });

  it('normalizes diagonal input (no speed boost)', () => {
    const p = createPlayer(100, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1, moveY: 1 }, [], SIM_DT);
    const moved = Math.hypot(p.pos.x - 100, p.pos.y - 100);
    expect(moved).toBeCloseTo(PLAYER_SPEED * SIM_DT);
  });

  it('stops at a wall on the X axis', () => {
    const wall: Wall = { x: 120, y: 0, w: 32, h: 200 };
    const p = createPlayer(120 - PLAYER_RADIUS - 1, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1 }, [wall], SIM_DT);
    expect(p.pos.x).toBeCloseTo(120 - PLAYER_RADIUS);
  });

  it('slides along a wall when moving diagonally into it', () => {
    const wall: Wall = { x: 120, y: 0, w: 32, h: 200 };
    const p = createPlayer(120 - PLAYER_RADIUS - 1, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1, moveY: 1 }, [wall], SIM_DT);
    expect(p.pos.x).toBeCloseTo(120 - PLAYER_RADIUS); // blocked on X
    expect(p.pos.y).toBeGreaterThan(100); // still moving on Y
  });
});

describe('sprint', () => {
  it('moves faster while sprinting', async () => {
    const { SPRINT_MULT } = await import('../../src/config');
    const p = createPlayer(100, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1, sprint: true }, [], SIM_DT);
    expect(p.pos.x).toBeCloseTo(100 + PLAYER_SPEED * SPRINT_MULT * SIM_DT);
  });
});
