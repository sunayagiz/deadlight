import { describe, it, expect } from 'vitest';
import { LAGCOMP_HISTORY, SIM_DT } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { ZOMBIES, spawnEnemy } from '../../src/sim/enemies';
import {
  bulletLagFor,
  clampLag,
  currentTick,
  recordEnemyHistory,
  rewoundEnemyPos,
} from '../../src/sim/lagcomp';
import { createGameState } from '../../src/sim/state';
import { snapshot, applySnapshot } from '../../src/net/protocol';
import type { BulletState, GameState } from '../../src/sim/types';

function bullet(x: number, y: number, damage: number, lag: number): BulletState {
  return { id: 1, pos: { x, y }, vel: { x: 0, y: 0 }, ttl: 1, damage, splashRadius: 0, splashDamage: 0, hostile: false, owner: 0, lag };
}

/**
 * Build a state whose enemy walked +40px/tick in x from (100,100), recording the
 * post-move position each tick, so the ring buffer holds the enemy's full trail.
 * Ends at `ticks-1` as the current tick.
 */
function walkingEnemy(ticks: number): { s: GameState; startX: number; endX: number } {
  const s = createGameState([]);
  const e = spawnEnemy(s, 'shambler', { x: 100, y: 100 });
  for (let t = 0; t < ticks; t++) {
    s.time = t * SIM_DT;
    e.pos = { x: 100 + t * 40, y: 100 };
    recordEnemyHistory(s);
  }
  return { s, startX: 100, endX: 100 + (ticks - 1) * 40 };
}

describe('lag compensation (B10)', () => {
  it('a guest bullet (lag=k) hits the enemy where it was k ticks ago, even though it moved away', () => {
    const { s, startX, endX } = walkingEnemy(5); // current tick = 4, enemy now at endX
    const e = s.enemies[0];
    expect(e.pos.x).toBe(endX); // 260
    // A bullet at the START position would MISS the enemy's CURRENT position…
    const lag = 4; // rewind to tick 0 (currentTick 4 - 4)
    s.bullets = [bullet(startX, 100, 25, lag)];
    updateCombat(s, SIM_DT);
    expect(e.hp).toBe(ZOMBIES.shambler.hp - 25); // …but with rewind it lands
    expect(s.bullets).toHaveLength(0); // consumed
  });

  it('lag=0 uses the CURRENT position exactly as before (regression)', () => {
    // Same trail; a lag=0 bullet is the unchanged host/solo path.
    const a = walkingEnemy(5);
    // At the OLD position, lag=0 MISSES (current pos is far away) → bullet survives.
    a.s.bullets = [bullet(a.startX, 100, 25, 0)];
    updateCombat(a.s, SIM_DT);
    expect(a.s.enemies[0].hp).toBe(ZOMBIES.shambler.hp); // untouched
    expect(a.s.bullets).toHaveLength(1); // survived (a clean miss)

    // At the CURRENT position, lag=0 HITS — identical to pre-B10 behaviour.
    const b = walkingEnemy(5);
    b.s.bullets = [bullet(b.endX, 100, 25, 0)];
    updateCombat(b.s, SIM_DT);
    expect(b.s.enemies[0].hp).toBe(ZOMBIES.shambler.hp - 25);
    expect(b.s.bullets).toHaveLength(0);
  });

  it('rewind is clamped to the history length', () => {
    expect(clampLag(1000)).toBe(LAGCOMP_HISTORY);
    expect(clampLag(LAGCOMP_HISTORY + 5)).toBe(LAGCOMP_HISTORY);
    expect(clampLag(3)).toBe(3);
    expect(clampLag(0)).toBe(0);
    expect(clampLag(-4)).toBe(0);
    expect(clampLag(NaN)).toBe(0);

    // bulletLagFor derives from the shooter's stale view tick, clamped:
    const s = createGameState([]);
    s.time = 100 * SIM_DT; // current tick 100
    expect(bulletLagFor(s, 0)).toBe(0); // host/solo/live view → no rewind
    expect(bulletLagFor(s, 97)).toBe(3); // 3 ticks behind
    expect(bulletLagFor(s, 1)).toBe(LAGCOMP_HISTORY); // way behind → clamped, never unbounded
  });

  it('the ring buffer never grows past LAGCOMP_HISTORY frames', () => {
    const { s } = walkingEnemy(LAGCOMP_HISTORY + 20);
    expect(s.lagHistory!.frames.length).toBe(LAGCOMP_HISTORY);
  });

  it('falls back to the current position when there is no history for the enemy/tick', () => {
    const s = createGameState([]);
    const e = spawnEnemy(s, 'shambler', { x: 200, y: 200 });
    // No frame for the requested tick → current pos.
    expect(rewoundEnemyPos(s, e, 5)).toEqual(e.pos);
    // lag <= 0 → current pos (the unchanged path).
    s.time = 10 * SIM_DT;
    recordEnemyHistory(s);
    expect(rewoundEnemyPos(s, e, 0)).toBe(e.pos);
    // A tick that exists but with no record for a different enemy id → current pos.
    const other = spawnEnemy(s, 'runner', { x: 400, y: 400 });
    expect(rewoundEnemyPos(s, other, currentTick(s))).toEqual(other.pos);
  });

  it('the new bullet lag field round-trips through the snapshot (and history is NOT sent)', () => {
    const s = createGameState([]);
    s.bullets = [bullet(50, 50, 10, 7)];
    // Populate host-only history to prove it does not ride the wire.
    recordEnemyHistory(s);
    const snap = snapshot(s);
    expect('lagHistory' in (snap as object)).toBe(false); // never serialized
    const wire = JSON.parse(JSON.stringify(snap)); // exactly what crosses the P2P link
    const guest = createGameState([]);
    applySnapshot(guest, wire);
    expect(guest.bullets[0].lag).toBe(7); // survived the round trip
    expect(guest.lagHistory).toEqual({ frames: [] }); // guest never receives history
  });
});
