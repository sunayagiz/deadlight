import { LAGCOMP_HISTORY, SIM_DT } from '../config';
import type { EnemyState, GameState, Vec2 } from './types';

/**
 * B10 — host-side lag compensation ("favor the shooter") for GUEST shots.
 *
 * The host runs the authoritative sim; a guest fires against a snapshot that is
 * already a few ticks stale, so by the time its input reaches the host the
 * enemies have crept past where the guest saw them ("I hit but it missed"). To
 * fix that WITHOUT touching solo/host play, the host records a short rolling
 * history of enemy positions each tick and, for a guest bullet only, rewinds the
 * overlap test to the tick the guest was viewing.
 *
 * Everything here is deterministic (no rng, no wall-clock) and host-only: the
 * history lives on GameState.lagHistory and is never serialized, so it never
 * bloats the snapshot and guests never carry it.
 */

/** The current sim tick (round guards float drift on time / SIM_DT). */
export function currentTick(state: GameState): number {
  return Math.round(state.time / SIM_DT);
}

/**
 * Record this tick's post-move enemy positions into the rolling buffer. Called
 * once per tick on the host AFTER all enemy movement and BEFORE combat resolves,
 * so a rewind reproduces exactly the positions combat would have used that tick.
 */
export function recordEnemyHistory(state: GameState): void {
  const h = state.lagHistory ?? (state.lagHistory = { frames: [] });
  h.frames.push({
    tick: currentTick(state),
    pos: state.enemies.map((e) => ({ id: e.id, x: e.pos.x, y: e.pos.y })),
  });
  // Keep only the last LAGCOMP_HISTORY ticks — the rewind is hard-bounded to this.
  while (h.frames.length > LAGCOMP_HISTORY) h.frames.shift();
}

/** Clamp a raw tick delta to a safe, bounded rewind (0..LAGCOMP_HISTORY). */
export function clampLag(lag: number): number {
  if (!Number.isFinite(lag) || lag <= 0) return 0;
  return Math.min(LAGCOMP_HISTORY, Math.round(lag));
}

/**
 * Ticks to rewind a bullet fired by an input that was viewing snapshot tick
 * `viewTick`. A host/solo local input carries viewTick 0 → returns 0 (no rewind,
 * the unchanged path). A guest input carries a positive, older tick → the delta
 * to the host's current tick, clamped.
 */
export function bulletLagFor(state: GameState, viewTick: number): number {
  if (!viewTick || viewTick <= 0) return 0; // live / host / solo view — no compensation
  return clampLag(currentTick(state) - viewTick);
}

/**
 * The position to use for `e` in a bullet overlap test, rewound `lag` ticks.
 * lag <= 0, no history, or no record for this enemy → the enemy's CURRENT pos
 * (identical to the pre-B10 behaviour). Falling back to current pos means a
 * missing/aged frame simply disables compensation for that shot rather than
 * misfiring.
 */
export function rewoundEnemyPos(state: GameState, e: EnemyState, lag: number): Vec2 {
  if (lag <= 0 || !state.lagHistory) return e.pos;
  const target = currentTick(state) - lag;
  const frame = state.lagHistory.frames.find((f) => f.tick === target);
  if (!frame) return e.pos;
  const rec = frame.pos.find((p) => p.id === e.id);
  return rec ? { x: rec.x, y: rec.y } : e.pos;
}
