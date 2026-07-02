import { describe, it, expect } from 'vitest';
import { BOSS_TELEGRAPH, BOSS_WAVE_INTERVAL, PLAYER_MAX_HP, SIM_DT } from '../../src/config';
import { updateBosses } from '../../src/sim/bosses';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy } from '../../src/sim/enemies';
import { createGameState } from '../../src/sim/state';
import { bossForWave, isBossWave, updateWaves } from '../../src/sim/waves';
import type { BulletState } from '../../src/sim/types';

function advanceTelegraph(s: ReturnType<typeof createGameState>, rng: () => number): void {
  for (let t = 0; t <= BOSS_TELEGRAPH + SIM_DT; t += SIM_DT) updateBosses(s, SIM_DT, rng);
}

describe('boss attacks', () => {
  it('telegraphs before it executes (no projectiles during wind-up)', () => {
    const s = createGameState([]);
    const boss = spawnEnemy(s, 'bloater', { x: 100, y: 100 });
    boss.boss!.attackCd = 0;
    updateBosses(s, SIM_DT, () => 0); // choose attack -> telegraph starts
    expect(boss.boss!.telegraph).toBeGreaterThan(0);
    expect(s.bullets).toHaveLength(0);
  });

  it('bloater spews a full ring of hostile projectiles', () => {
    const s = createGameState([]);
    const boss = spawnEnemy(s, 'bloater', { x: 100, y: 100 });
    boss.boss!.attackCd = 0;
    advanceTelegraph(s, () => 0);
    expect(s.bullets.length).toBeGreaterThan(8);
    expect(s.bullets.every((b) => b.hostile)).toBe(true);
  });

  it('screamer spits a projectile toward the player', () => {
    const s = createGameState([]);
    s.player.pos = { x: 400, y: 100 };
    const boss = spawnEnemy(s, 'screamer', { x: 100, y: 100 });
    boss.boss!.attackCd = 0;
    advanceTelegraph(s, () => 0); // rng 0 -> first attack = 'spit'
    expect(s.bullets.length).toBe(1);
    expect(s.bullets[0].hostile).toBe(true);
    expect(s.bullets[0].vel.x).toBeGreaterThan(0); // aimed at the player on +x
  });

  it('screamer summon spawns additional enemies', () => {
    const s = createGameState([]);
    spawnEnemy(s, 'screamer', { x: 100, y: 100 });
    const before = s.enemies.length;
    s.enemies[0].boss!.attackCd = 0;
    advanceTelegraph(s, () => 0.9); // rng 0.9 -> second attack = 'summon'
    expect(s.enemies.length).toBeGreaterThan(before);
  });
});

describe('hostile projectiles', () => {
  function hostile(x: number, y: number, damage: number): BulletState {
    return { id: 1, pos: { x, y }, vel: { x: 0, y: 0 }, ttl: 1, damage, splashRadius: 0, splashDamage: 0, hostile: true };
  }

  it('damages the player on contact', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.bullets = [hostile(100, 100, 20)];
    updateCombat(s, SIM_DT);
    expect(s.player.hp).toBe(PLAYER_MAX_HP - 20);
    expect(s.bullets).toHaveLength(0); // consumed
  });

  it('passes through a dashing player (i-frames dodge it)', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    s.player.dash.timeLeft = 0.1;
    s.bullets = [hostile(100, 100, 20)];
    updateCombat(s, SIM_DT);
    expect(s.player.hp).toBe(PLAYER_MAX_HP);
    expect(s.bullets).toHaveLength(1); // not consumed, flies on
  });
});

describe('boss waves', () => {
  it('marks every Nth wave as a boss wave and alternates the two bosses', () => {
    expect(isBossWave(BOSS_WAVE_INTERVAL)).toBe(true);
    expect(isBossWave(BOSS_WAVE_INTERVAL + 1)).toBe(false);
    expect(bossForWave(BOSS_WAVE_INTERVAL)).toBe('bloater');
    expect(bossForWave(BOSS_WAVE_INTERVAL * 2)).toBe('screamer');
  });

  it('spawns a boss when a boss wave starts', () => {
    const s = createGameState([], [{ x: 50, y: 50 }]);
    s.wave.index = BOSS_WAVE_INTERVAL;
    s.wave.phase = 'intermission';
    s.wave.timer = SIM_DT / 2; // about to start
    updateWaves(s, SIM_DT, () => 0);
    expect(s.enemies.some((e) => e.boss)).toBe(true);
  });
});
