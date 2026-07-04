import { describe, expect, it } from 'vitest';
import { PLAYER_MAX_HP, SIM_DT, STALKER_LUNGE_SPEED } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy, updateEnemies, updateRangedEnemies } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import type { GameState } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([], [{ x: 0, y: 0 }], [], { x: 500, y: 500 }, { width: 4000, height: 4000 }, 1);
}

describe('spitter (ranged)', () => {
  it('lobs an acid bullet at a player in range with clear LOS', () => {
    const s = fresh();
    const sp = spawnEnemy(s, 'spitter', { x: 800, y: 500 }); // 300px away, LOS clear
    sp.cd = 0;
    expect(s.bullets.length).toBe(0);
    updateRangedEnemies(s, SIM_DT);
    expect(s.bullets.length).toBe(1);
    expect(s.bullets[0].hostile).toBe(true); // it damages the player
    expect(sp.cd).toBeGreaterThan(0); // on cooldown now
  });

  it('does not fire when the player is out of range', () => {
    const s = fresh();
    const sp = spawnEnemy(s, 'spitter', { x: 3000, y: 500 }); // way out of range
    sp.cd = 0;
    updateRangedEnemies(s, SIM_DT);
    expect(s.bullets.length).toBe(0);
  });
});

describe('boomer (explode on death)', () => {
  it('damages a nearby player when it dies', () => {
    const s = fresh();
    const b = spawnEnemy(s, 'boomer', { x: 520, y: 500 }); // right next to the player
    b.hp = 0; // combat reaps it this tick → blast
    const before = s.players[0].hp;
    updateCombat(s, SIM_DT, () => 0.99);
    expect(s.players[0].hp).toBeLessThan(before);
  });

  it('does not damage a player far from the blast', () => {
    const s = fresh();
    const b = spawnEnemy(s, 'boomer', { x: 500, y: 500 });
    b.pos = { x: 1500, y: 1500 };
    b.hp = 0;
    updateCombat(s, SIM_DT, () => 0.99);
    expect(s.players[0].hp).toBe(PLAYER_MAX_HP);
  });
});

describe('stalker (lunge)', () => {
  it('lunges at the player at high speed when the gap is right', () => {
    const s = fresh();
    const st = spawnEnemy(s, 'stalker', { x: 700, y: 500 }); // 200px, within lunge range
    st.cd = 0;
    updateEnemies(s.enemies, s.players, [], SIM_DT); // tick 1: charges + starts the lunge
    expect(st.lunge).toBeGreaterThan(0);
    updateEnemies(s.enemies, s.players, [], SIM_DT); // tick 2: the lunge dash fires
    const speed = Math.hypot(st.vel.x, st.vel.y);
    expect(speed).toBeGreaterThan(STALKER_LUNGE_SPEED * 0.9); // moving fast, toward the player (-x)
    expect(st.vel.x).toBeLessThan(0);
  });
});

describe('spawns fan out across zones', () => {
  it('round-robins the horde across multiple reachable zones', () => {
    const s = createGameState([], [{ x: 300, y: 300 }, { x: 3600, y: 3600 }], [], { x: 1950, y: 1950 }, { width: 4000, height: 4000 }, 1);
    s.wave.index = 2;
    s.wave.phase = 'intermission';
    s.wave.timer = 0.05;
    const rng = () => 0.5;
    for (let i = 0; i < 60 * 8; i++) {
      s.players[0].hp = 9999; // keep the wave flooding
      stepSim(s, [emptyInput()], SIM_DT, rng);
    }
    const nearA = s.enemies.filter((e) => e.pos.x < 2000).length;
    const nearB = s.enemies.filter((e) => e.pos.x >= 2000).length;
    expect(nearA).toBeGreaterThan(0); // came from zone A
    expect(nearB).toBeGreaterThan(0); // AND zone B — not all from one point
  });
});
