import { describe, it, expect } from 'vitest';
import { SIM_DT, ZED_CHARGE_PER_KILL, ZED_DURATION, ZED_TIMESCALE } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { spawnEnemy } from '../../src/sim/enemies';
import { hashSeed, mulberry32 } from '../../src/sim/rng';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import type { GameState, PlayerInput } from '../../src/sim/types';
import { applySnapshot, snapshot } from '../../src/net/protocol';

/** A dead enemy so updateCombat reaps it (and charges the meter) this tick. */
function deadEnemy(s: GameState, x = 100, y = 100): void {
  const e = spawnEnemy(s, 'shambler', { x, y });
  e.hp = 0;
}

function abilityInput(): PlayerInput {
  return { ...emptyInput(), ability: true };
}

describe('A9 zed-time', () => {
  it('kills charge the meter and it caps at 1', () => {
    const s = createGameState([]);
    expect(s.zedCharge).toBe(0);
    deadEnemy(s);
    updateCombat(s, SIM_DT, () => 0.99); // one kill
    expect(s.zedCharge).toBeCloseTo(ZED_CHARGE_PER_KILL, 10);

    // enough kills to overflow the meter — it must clamp at exactly 1
    for (let i = 0; i < 40; i++) deadEnemy(s, 100 + i, 100);
    updateCombat(s, SIM_DT, () => 0.99);
    expect(s.zedCharge).toBe(1);
  });

  it('activating with a full charge sets zedTime and zeroes the charge', () => {
    const s = createGameState([]);
    s.zedCharge = 1;
    stepSim(s, abilityInput(), SIM_DT);
    expect(s.zedTime).toBe(ZED_DURATION);
    expect(s.zedCharge).toBe(0);
  });

  it('activating without a full charge does nothing', () => {
    const s = createGameState([]);
    s.zedCharge = 0.5;
    stepSim(s, abilityInput(), SIM_DT);
    expect(s.zedTime).toBe(0);
    expect(s.zedCharge).toBeLessThan(1); // never armed the window
  });

  it('slows enemies but not players while active (asymmetric dt)', () => {
    // Two identical worlds; one is in zed-time, one is not. Same input tick.
    const mk = (zed: boolean): GameState => {
      const g = createGameState([]);
      g.players[0].pos = { x: 480, y: 270 };
      spawnEnemy(g, 'shambler', { x: 300, y: 270 }); // to the player's left → seeks +x
      if (zed) g.zedTime = ZED_DURATION;
      return g;
    };
    const normal = mk(false);
    const zed = mk(true);

    const input: PlayerInput = { ...emptyInput(), moveX: -1 }; // player strides left, full speed
    const ex0 = normal.enemies[0].pos.x;
    const px0 = normal.players[0].pos.x;
    stepSim(normal, input, SIM_DT);
    stepSim(zed, input, SIM_DT);

    const enemyStepNormal = normal.enemies[0].pos.x - ex0;
    const enemyStepZed = zed.enemies[0].pos.x - ex0;
    // enemy advanced toward the player in both, but LESS in zed-time
    expect(enemyStepNormal).toBeGreaterThan(0);
    expect(enemyStepZed).toBeGreaterThan(0);
    expect(enemyStepZed).toBeLessThan(enemyStepNormal);
    // and slowed by the timescale (allowing seek/normalize rounding)
    expect(enemyStepZed).toBeCloseTo(enemyStepNormal * ZED_TIMESCALE, 5);

    // the player moved the SAME distance in both worlds — full speed regardless
    const playerStepNormal = normal.players[0].pos.x - px0;
    const playerStepZed = zed.players[0].pos.x - px0;
    expect(playerStepZed).toBeCloseTo(playerStepNormal, 10);
    expect(playerStepNormal).toBeLessThan(0); // actually moved left
  });

  it('hostile projectiles slow but player bullets do not', () => {
    const s = createGameState([]);
    s.zedTime = ZED_DURATION;
    s.bullets = [
      { id: 1, pos: { x: 0, y: 0 }, vel: { x: 100, y: 0 }, ttl: 5, damage: 1, splashRadius: 0, splashDamage: 0, hostile: true, owner: -1 },
      { id: 2, pos: { x: 0, y: 300 }, vel: { x: 100, y: 0 }, ttl: 5, damage: 1, splashRadius: 0, splashDamage: 0, hostile: false, owner: 0 },
    ];
    stepSim(s, emptyInput(), SIM_DT);
    const hostile = s.bullets.find((b) => b.id === 1)!;
    const friendly = s.bullets.find((b) => b.id === 2)!;
    expect(hostile.pos.x).toBeCloseTo(100 * SIM_DT * ZED_TIMESCALE, 10); // slowed
    expect(friendly.pos.x).toBeCloseTo(100 * SIM_DT, 10); // full speed
  });

  it('zedTime counts down in real time and ends', () => {
    const s = createGameState([]);
    s.zedTime = ZED_DURATION;
    let ticks = 0;
    while (s.zedTime > 0 && ticks < 10000) {
      stepSim(s, emptyInput(), SIM_DT);
      ticks++;
    }
    expect(s.zedTime).toBe(0);
    // ~ZED_DURATION / SIM_DT ticks (one extra to reach exactly 0)
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(ZED_DURATION / SIM_DT));
    expect(ticks).toBeLessThanOrEqual(Math.ceil(ZED_DURATION / SIM_DT) + 1);
  });

  it('both fields round-trip through the snapshot', () => {
    const s = createGameState([]);
    s.zedTime = 2.3;
    s.zedCharge = 0.6;
    const snap = snapshot(s);
    expect(snap.zt).toBe(2.3);
    expect(snap.zc).toBe(0.6);
    const g = createGameState([]);
    applySnapshot(g, snap);
    expect(g.zedTime).toBe(2.3);
    expect(g.zedCharge).toBe(0.6);
  });

  it('is deterministic — same seed replays the same zed trajectory', () => {
    const run = (): number[] => {
      const rng = mulberry32(hashSeed('zed-seed'));
      const s = createGameState([]);
      spawnEnemy(s, 'runner', { x: 200, y: 270 });
      const trace: number[] = [];
      for (let t = 0; t < 120; t++) {
        const input = t === 5 ? abilityInput() : emptyInput();
        if (t === 5) s.zedCharge = 1; // arm it right before the trigger tick
        stepSim(s, input, SIM_DT, rng);
        trace.push(s.zedTime, s.enemies[0]?.pos.x ?? 0, s.enemies[0]?.pos.y ?? 0);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
