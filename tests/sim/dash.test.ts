import { describe, it, expect } from 'vitest';
import { DASH_COOLDOWN, DASH_DURATION, PLAYER_SPEED, SIM_DT } from '../../src/config';
import { isInvulnerable, updateDash, updateMovement } from '../../src/sim/movement';
import { createPlayer, emptyInput } from '../../src/sim/state';
import type { PlayerInput, PlayerState } from '../../src/sim/types';

function step(p: PlayerState, input: PlayerInput): void {
  updateDash(p, input, SIM_DT);
  updateMovement(p, input, [], SIM_DT);
}

describe('dash', () => {
  it('dash moves faster than running and grants i-frames', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    expect(p.pos.x - 100).toBeGreaterThan(PLAYER_SPEED * SIM_DT);
    expect(isInvulnerable(p)).toBe(true);
  });

  it('dash ends after DASH_DURATION and i-frames end with it', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    const ticks = Math.ceil(DASH_DURATION / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) step(p, { ...emptyInput(), moveX: 1 });
    expect(isInvulnerable(p)).toBe(false);
  });

  it('cannot dash again during cooldown', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    // ride out the dash itself, then ask for another dash mid-cooldown
    const ticks = Math.ceil(DASH_DURATION / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) step(p, { ...emptyInput(), moveX: 1 });
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    expect(isInvulnerable(p)).toBe(false);
    expect(p.dash.cooldownLeft).toBeGreaterThan(0);
  });

  it('dash is available again after DASH_COOLDOWN', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    const ticks = Math.ceil(DASH_COOLDOWN / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) step(p, { ...emptyInput(), moveX: 1 });
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    expect(isInvulnerable(p)).toBe(true);
  });

  it('dash with no movement input goes toward aim direction', () => {
    const p = createPlayer(100, 100);
    p.aimAngle = 0; // aiming right
    step(p, { ...emptyInput(), dash: true });
    expect(p.pos.x).toBeGreaterThan(100);
    expect(p.pos.y).toBeCloseTo(100);
  });
});
