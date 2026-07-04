import { describe, expect, it } from 'vitest';
import { ARMOR_MELEE_BONUS, PLAYER_MAX_HP, SIM_DT, STALKER_LUNGE_SPEED } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy, updateEnemies, updateRangedEnemies, ZOMBIES } from '../../src/sim/enemies';
import { updateMelee } from '../../src/sim/melee';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import type { BulletState, GameState } from '../../src/sim/types';

function fresh(): GameState {
  return createGameState([], [{ x: 0, y: 0 }], [], { x: 500, y: 500 }, { width: 4000, height: 4000 }, 1);
}

describe('spitter (ranged)', () => {
  it('charges (wind-up) before it fires — no bullet during the charge, one after', () => {
    const s = fresh();
    const sp = spawnEnemy(s, 'spitter', { x: 800, y: 500 }); // 300px away, LOS clear
    sp.cd = 0;
    expect(s.bullets.length).toBe(0);
    updateRangedEnemies(s, SIM_DT); // tick 1: begins the telegraphed charge
    expect(sp.windup).toBeGreaterThan(0); // visibly charging now
    expect(s.bullets.length).toBe(0); // …but nothing has launched yet — dodge it
    let guard = 0;
    while ((sp.windup ?? 0) > 0 && guard++ < 200) updateRangedEnemies(s, SIM_DT); // run out the charge
    expect(s.bullets.length).toBe(1); // charge complete → acid glob launches
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
  it('braces (wind-up) before it lunges, then dashes at high speed toward the player', () => {
    const s = fresh();
    const st = spawnEnemy(s, 'stalker', { x: 700, y: 500 }); // 200px, within lunge range
    st.cd = 0;
    updateEnemies(s.enemies, s.players, [], SIM_DT); // tick 1: enters the braced wind-up
    expect(st.windup).toBeGreaterThan(0); // telegraphing the pounce
    expect(st.lunge ?? 0).toBe(0); // not lunging yet
    const braceSpeed = Math.hypot(st.vel.x, st.vel.y);
    expect(braceSpeed).toBeLessThan(ZOMBIES.stalker.speed); // braced: slower than a normal walk
    let guard = 0;
    while ((st.windup ?? 0) > 0 && guard++ < 200) updateEnemies(s.enemies, s.players, [], SIM_DT); // run out the wind-up
    expect(st.lunge).toBeGreaterThan(0); // wind-up done → the lunge is armed
    updateEnemies(s.enemies, s.players, [], SIM_DT); // the dash fires
    const speed = Math.hypot(st.vel.x, st.vel.y);
    expect(speed).toBeGreaterThan(STALKER_LUNGE_SPEED * 0.9); // moving fast, toward the player (-x)
    expect(st.vel.x).toBeLessThan(0);
  });
});

describe('stalker (flank tactic)', () => {
  it('biases its approach toward the player’s dark side, away from the flashlight aim', () => {
    const s = fresh();
    // Player at (500,500) aiming due +x (east); the dark side is behind them (west).
    s.players[0].pos = { x: 500, y: 500 };
    s.players[0].aimAngle = 0;
    // Stalker due NORTH of the player: a straight seek would head purely south (vx≈0).
    const st = spawnEnemy(s, 'stalker', { x: 500, y: 200 });
    updateEnemies(s.enemies, s.players, [], SIM_DT);
    expect(st.lunge ?? 0).toBe(0); // just approaching, not lunging
    expect(st.vel.y).toBeGreaterThan(0); // still closing toward the player (south)
    expect(st.vel.x).toBeLessThan(0); // …but steered WEST — circling to the unlit flank
  });
});

describe('armored (melee-only)', () => {
  function bullet(x: number, y: number, dmg: number): BulletState {
    return { id: 1, pos: { x, y }, vel: { x: 100, y: 0 }, ttl: 1, damage: dmg, splashRadius: 0, splashDamage: 0, hostile: false, owner: 0 };
  }

  it('shrugs off most bullet damage (75% resisted)', () => {
    const s = fresh();
    const a = spawnEnemy(s, 'armored', { x: 600, y: 500 });
    const hp0 = a.hp;
    s.bullets.push(bullet(600, 500, 100));
    updateCombat(s, SIM_DT, () => 0.99);
    expect(hp0 - a.hp).toBeCloseTo(100 * (1 - ZOMBIES.armored.bulletResist!)); // only 25 dealt
  });

  it('takes full melee damage plus a bonus', () => {
    const s = fresh();
    const a = spawnEnemy(s, 'armored', { x: 550, y: 500 }); // in front, within katana reach
    const p = s.players[0];
    p.weapon = 'katana';
    p.aimAngle = 0; // facing +x toward the enemy
    const hp0 = a.hp;
    updateMelee(s, p, { ...emptyInput(), fire: true }, SIM_DT);
    // katana base 70 × ARMOR_MELEE_BONUS, no perks/PaP
    expect(hp0 - a.hp).toBeCloseTo(70 * ARMOR_MELEE_BONUS);
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
