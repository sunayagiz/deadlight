import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../../src/config';
import { ZOMBIES, spawnEnemy } from '../../src/sim/enemies';
import { updateMelee } from '../../src/sim/melee';
import { createGameState, emptyInput } from '../../src/sim/state';
import { WEAPONS } from '../../src/sim/weapons';

const swing = { ...emptyInput(), fire: true };

describe('melee', () => {
  it('katana hits an enemy in front within reach', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.aimAngle = 0; // facing +x
    s.player.weapon = 'katana';
    const e = spawnEnemy(s, 'shambler', { x: 140, y: 100 }); // 40px ahead, within 64 reach
    updateMelee(s, swing, SIM_DT);
    expect(e.hp).toBe(ZOMBIES.shambler.hp - WEAPONS.katana.damage);
  });

  it('katana does not hit an enemy behind the player', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.aimAngle = 0; // facing +x
    s.player.weapon = 'katana';
    const e = spawnEnemy(s, 'shambler', { x: 50, y: 100 }); // behind (−x)
    updateMelee(s, swing, SIM_DT);
    expect(e.hp).toBe(ZOMBIES.shambler.hp);
  });

  it('katana does not reach a far enemy', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.aimAngle = 0;
    s.player.weapon = 'katana';
    const e = spawnEnemy(s, 'shambler', { x: 400, y: 100 });
    updateMelee(s, swing, SIM_DT);
    expect(e.hp).toBe(ZOMBIES.shambler.hp);
  });

  it('swing respects cooldown: a second immediate swing does nothing', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.aimAngle = 0;
    s.player.weapon = 'katana';
    const e = spawnEnemy(s, 'shambler', { x: 140, y: 100 });
    updateMelee(s, swing, SIM_DT);
    const afterFirst = e.hp;
    updateMelee(s, swing, SIM_DT); // still on cooldown
    expect(e.hp).toBe(afterFirst);
  });

  it('chainsaw applies continuous damage each tick while held', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.aimAngle = 0;
    s.player.weapon = 'chainsaw';
    s.player.ammo.chainsaw = 999;
    const e = spawnEnemy(s, 'runner', { x: 130, y: 100 });
    updateMelee(s, swing, SIM_DT);
    updateMelee(s, swing, SIM_DT);
    const expected = ZOMBIES.runner.hp - WEAPONS.chainsaw.damage * SIM_DT * 2;
    expect(e.hp).toBeCloseTo(expected);
  });

  it('chainsaw stops when out of fuel', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.aimAngle = 0;
    s.player.weapon = 'chainsaw';
    s.player.ammo.chainsaw = 0;
    const e = spawnEnemy(s, 'runner', { x: 130, y: 100 });
    updateMelee(s, swing, SIM_DT);
    expect(e.hp).toBe(ZOMBIES.runner.hp);
  });
});
