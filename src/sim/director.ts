import {
  DIRECTOR_DAMAGE_FULL,
  DIRECTOR_DECAY,
  DIRECTOR_PEAK,
  DIRECTOR_PEAK_CAP_MULT,
  DIRECTOR_PEAK_INTERVAL_MULT,
  DIRECTOR_PRESSURE_FULL,
  DIRECTOR_PRESSURE_RADIUS,
  DIRECTOR_RELAX,
  DIRECTOR_RELAX_INTERVAL_MULT,
  DIRECTOR_RELAX_TIME,
  DIRECTOR_RISE,
  DIRECTOR_STARVED_DROP_MULT,
  DIRECTOR_STARVED_HP_FRAC,
} from '../config';
import { effectiveMaxHp } from './perks';
import { WEAPONS } from './weapons';
import { isUp, type GameState } from './types';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Aggregate HP of the standing squad (downed/dead don't count — losing a player IS stress). */
function standingHp(state: GameState): number {
  let sum = 0;
  for (const p of state.players) if (isUp(p)) sum += Math.max(0, p.hp);
  return sum;
}

/**
 * Instantaneous stress in [0,1]: nearby-enemy pressure + damage-taken-this-tick.
 * Pressure = enemies within DIRECTOR_PRESSURE_RADIUS of ANY standing player,
 * normalized by DIRECTOR_PRESSURE_FULL. Damage = squad HP lost since last tick
 * (director.hpRef), normalized by DIRECTOR_DAMAGE_FULL. Summed, then clamped.
 */
function stressNow(state: GameState, hpNow: number): number {
  const r2 = DIRECTOR_PRESSURE_RADIUS * DIRECTOR_PRESSURE_RADIUS;
  let near = 0;
  for (const e of state.enemies) {
    for (const p of state.players) {
      if (!isUp(p)) continue;
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      if (dx * dx + dy * dy <= r2) {
        near += 1;
        break; // count each enemy at most once
      }
    }
  }
  const pressure = clamp01(near / DIRECTOR_PRESSURE_FULL);
  const hpLost = Math.max(0, state.director.hpRef - hpNow); // heals/regen never register as stress
  const damage = clamp01(hpLost / DIRECTOR_DAMAGE_FULL);
  return clamp01(pressure + damage);
}

/**
 * One tick of the AI Director. Moves `intensity` toward the current stress
 * (fast on the way up via DIRECTOR_RISE, slow on the way down via DIRECTOR_DECAY),
 * and arms a post-peak "relax" window once intensity crests DIRECTOR_PEAK and
 * later falls back below DIRECTOR_RELAX. Pure/dt-driven — no wall-clock, no rng.
 * Called from stepSim AFTER combat/loot (so damage + pickups are reflected) and
 * BEFORE updateWaves (which reads the exposed throttle multipliers).
 */
export function updateDirector(state: GameState, dt: number): void {
  const d = state.director;
  const hpNow = standingHp(state);
  const target = stressNow(state, hpNow);

  const rate = target > state.intensity ? DIRECTOR_RISE : DIRECTOR_DECAY;
  // exponential approach toward the stress target; stays in [0,target] ⊆ [0,1]
  state.intensity = clamp01(state.intensity + (target - state.intensity) * rate * dt);

  // Peak → relax pacing: mark a genuine peak, then open a calm window when it eases.
  if (state.intensity >= DIRECTOR_PEAK) d.peaked = true;
  if (d.peaked && state.intensity < DIRECTOR_RELAX) {
    d.relaxT = DIRECTOR_RELAX_TIME;
    d.peaked = false;
  }
  d.relaxT = Math.max(0, d.relaxT - dt);

  d.hpRef = hpNow; // baseline for next tick's damage measurement
}

/** Multiplier on the concurrent max-alive cap: throttled while at peak, else 1. */
export function directorCapMult(state: GameState): number {
  return state.intensity >= DIRECTOR_PEAK ? DIRECTOR_PEAK_CAP_MULT : 1;
}

/** Multiplier on the spawn interval: longest at peak, eased during the relax window, else 1. */
export function directorIntervalMult(state: GameState): number {
  if (state.intensity >= DIRECTOR_PEAK) return DIRECTOR_PEAK_INTERVAL_MULT;
  if (state.director.relaxT > 0) return DIRECTOR_RELAX_INTERVAL_MULT;
  return 1;
}

/** True when the squad is genuinely starved: any standing player low on HP or dry on their equipped limited weapon. */
export function isStarved(state: GameState): boolean {
  const maxHp = effectiveMaxHp(state);
  for (const p of state.players) {
    if (!isUp(p)) continue;
    if (p.hp < maxHp * DIRECTOR_STARVED_HP_FRAC) return true;
    const def = WEAPONS[p.weapon];
    if (def.startAmmo !== undefined && (p.ammo[p.weapon] ?? 0) <= 0) return true;
  }
  return false;
}

/** Multiplier on supply drop chances (power-ups / loot): raised while starved, else 1 (capped, deterministic). */
export function directorDropMult(state: GameState): number {
  return isStarved(state) ? DIRECTOR_STARVED_DROP_MULT : 1;
}
