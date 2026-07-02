import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../../src/config';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import { WEAPONS } from '../../src/sim/weapons';
import type { Wall } from '../../src/sim/types';

describe('weapons', () => {
  it('aims at the cursor', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    stepSim(s, { ...emptyInput(), aimWorldX: 100, aimWorldY: 200 }, SIM_DT); // straight down
    expect(s.player.aimAngle).toBeCloseTo(Math.PI / 2);
  });

  it('fires at the weapon fire rate while trigger is held', () => {
    const s = createGameState([]);
    const input = { ...emptyInput(), fire: true, aimWorldX: 999, aimWorldY: 0 };
    const ticks = Math.round(1 / SIM_DT); // one second
    for (let i = 0; i < ticks; i++) stepSim(s, input, SIM_DT);
    const expected = WEAPONS.pistol.fireRate;
    // bullets fired in 1s ≈ fireRate (some may have expired via ttl — count ids instead)
    expect(s.nextBulletId - 1).toBeGreaterThanOrEqual(expected);
    expect(s.nextBulletId - 1).toBeLessThanOrEqual(expected + 1);
  });

  it('bullets travel in the aim direction', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    stepSim(s, { ...emptyInput(), fire: true, aimWorldX: 200, aimWorldY: 100 }, SIM_DT);
    expect(s.bullets).toHaveLength(1);
    expect(s.bullets[0].pos.x).toBeGreaterThan(100);
    expect(s.bullets[0].pos.y).toBeCloseTo(100);
  });

  it('bullets die when hitting a wall', () => {
    const wall: Wall = { x: 200, y: 0, w: 32, h: 400 };
    const s = createGameState([wall]);
    s.player.pos = { x: 100, y: 100 };
    const input = { ...emptyInput(), fire: true, aimWorldX: 300, aimWorldY: 100 };
    for (let i = 0; i < 30; i++) stepSim(s, input, SIM_DT);
    for (const b of s.bullets) {
      expect(b.pos.x).toBeLessThan(200); // none ever inside/past the wall
    }
  });

  it('bullets expire after ttl', () => {
    const s = createGameState([]);
    stepSim(s, { ...emptyInput(), fire: true, aimWorldX: 999, aimWorldY: 0 }, SIM_DT);
    const ticks = Math.ceil(WEAPONS.pistol.bulletTtl! / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) stepSim(s, emptyInput(), SIM_DT);
    expect(s.bullets).toHaveLength(0);
  });
});
