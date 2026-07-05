import { describe, it, expect } from 'vitest';
import { PLAYER_MAX_HP, SIM_DT } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { ZOMBIES, spawnEnemy } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { WEAPONS, updateFiring } from '../../src/sim/weapons';
import type { BulletState } from '../../src/sim/types';

const held = { ...emptyInput(), fire: true, aimWorldX: 999, aimWorldY: 0 };

function rpgBullet(x: number, y: number): BulletState {
  const def = WEAPONS.rpg;
  return {
    id: 1,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    ttl: 0, // already expired -> explodes this tick
    damage: def.damage,
    splashRadius: def.splashRadius!,
    splashDamage: def.splashDamage!,
    hostile: false,
    owner: 0,
    lag: 0,
  };
}

describe('arsenal', () => {
  it('shotgun fires a burst of pellets in one trigger pull', () => {
    const s = createGameState([]);
    s.player.weapon = 'shotgun';
    updateFiring(s, s.player, held, SIM_DT, () => 0.5);
    expect(s.bullets).toHaveLength(WEAPONS.shotgun.pellets!);
  });

  it('spread scatters pellet directions', () => {
    const s = createGameState([]);
    s.player.weapon = 'shotgun';
    const vals = [0, 0.25, 0.5, 0.75, 1, 0.1, 0.9, 0.4];
    let i = 0;
    updateFiring(s, s.player, held, SIM_DT, () => vals[i++ % vals.length]);
    const ys = new Set(s.bullets.map((b) => Math.round(b.vel.y)));
    expect(ys.size).toBeGreaterThan(1); // not all going perfectly straight
  });

  it('minigun spins up while held', () => {
    const s = createGameState([]);
    s.player.weapon = 'minigun';
    s.player.ammo.minigun = 999;
    expect(s.player.spin).toBe(0);
    for (let t = 0; t < WEAPONS.minigun.spinUpTime!; t += SIM_DT) {
      updateFiring(s, s.player, held, SIM_DT, () => 0.5);
    }
    expect(s.player.spin).toBeGreaterThan(0.9);
  });

  it('minigun and rpg respect ammo; empty means no shot', () => {
    const s = createGameState([]);
    s.player.weapon = 'rpg';
    s.player.ammo.rpg = 1;
    updateFiring(s, s.player, held, SIM_DT, () => 0.5);
    expect(s.bullets.length).toBe(1);
    expect(s.player.ammo.rpg).toBe(0);
    // cooldown elapsed but no ammo -> nothing more
    s.player.fireCooldown = 0;
    updateFiring(s, s.player, held, SIM_DT, () => 0.5);
    expect(s.bullets.length).toBe(1);
  });

  it('rpg explosion damages every enemy in the blast radius', () => {
    const s = createGameState([]);
    const near = spawnEnemy(s, 'shambler', { x: 50, y: 0 }); // within 110px
    const far = spawnEnemy(s, 'shambler', { x: 400, y: 0 }); // outside
    s.bullets = [rpgBullet(0, 0)];
    updateCombat(s, SIM_DT);
    expect(near.hp).toBeLessThan(ZOMBIES.shambler.hp);
    expect(far.hp).toBe(ZOMBIES.shambler.hp);
  });

  it('rpg blast hurts the player when too close (self-damage risk)', () => {
    const s = createGameState([]);
    s.player.pos = { x: 30, y: 0 };
    s.bullets = [rpgBullet(0, 0)];
    updateCombat(s, SIM_DT);
    expect(s.player.hp).toBeLessThan(PLAYER_MAX_HP);
  });
});
