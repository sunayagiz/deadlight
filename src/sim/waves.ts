import {
  BOSS_WAVE_INTERVAL,
  BRUTE_MIN_WAVE,
  DOG_ROUND_EVERY,
  DOG_ROUND_FIRST,
  EXTRACTION_WAVE,
  GUARANTEED_AMMO_EVERY,
  FLASHLIGHT_HALF_ANGLE,
  FLASHLIGHT_RANGE,
  PERK_INTERVAL,
  POWERUP_TTL,
  SPAWN_JITTER,
  SPAWN_MIN_DIST,
  SPAWN_RETRY,
  SPAWN_SIGHT_DIST,
  WAVE_BUDGET_BASE,
  WAVE_BUDGET_GROWTH,
  WAVE_INTERMISSION,
  WAVE_SPAWN_INTERVAL,
} from '../config';
import { rollAffix } from './affix';
import { setNotice } from './cod';
import { directorCapMult, directorIntervalMult } from './director';
import { ZOMBIES, maxAlive, spawnEnemy } from './enemies';
import { sampleFlow, type FlowField } from './flowfield';
import { mapSolids } from './map';
import { rollDraft } from './perks';
import { segmentClear } from './vision';
import type { EnemyType, GameState, SpawnZone } from './types';

/** Hellhound special round: from DOG_ROUND_FIRST, every DOG_ROUND_EVERY-th wave (never on a boss/final wave). */
export function isDogRound(index: number): boolean {
  return (
    index >= DOG_ROUND_FIRST &&
    index % DOG_ROUND_EVERY === 0 &&
    !isBossWave(index) &&
    index < EXTRACTION_WAVE
  );
}

/** A pack of hounds sized to the wave and squad. */
export function buildDogPack(index: number, squad = 1): EnemyType[] {
  const n = Math.round((6 + index * 0.8) * (0.7 + 0.3 * squad));
  return Array.from({ length: n }, () => 'hound' as EnemyType);
}

/** The last wave is the escape: an endless horde while the squad reaches the exit. */
export function isFinalWave(index: number): boolean {
  return index >= EXTRACTION_WAVE;
}

export function isBossWave(index: number): boolean {
  return index % BOSS_WAVE_INTERVAL === 0;
}

/** Alternate the two bosses: 1st boss wave = bloater, 2nd = screamer, ... */
export function bossForWave(index: number): EnemyType {
  return (index / BOSS_WAVE_INTERVAL) % 2 === 1 ? 'bloater' : 'screamer';
}

/** Deterministic when a seeded rng is passed; defaults to Math.random for the live game. */
export type Rng = () => number;

export function waveBudget(index: number): number {
  return WAVE_BUDGET_BASE + WAVE_BUDGET_GROWTH * (index - 1);
}

function affordable(index: number, budget: number): EnemyType[] {
  const pool: EnemyType[] = ['shambler', 'runner'];
  if (index >= BRUTE_MIN_WAVE) pool.push('brute');
  if (index >= 4) pool.push('boomer'); // explodes on death
  if (index >= 4) pool.push('armored'); // melee-only threat — regular reason to swing
  if (index >= 5) pool.push('spitter'); // ranged acid
  if (index >= 6) pool.push('stalker'); // lunging lurker
  return pool.filter((t) => ZOMBIES[t].cost <= budget);
}

/**
 * Enemy-mix weighting: later waves lean toward faster/tankier types (shamblers
 * fade, runners + brutes rise). This is the "harder but fair" lever — late-game
 * threat from a nastier MIX, not just bullet-sponge HP.
 */
function weightFor(type: EnemyType, index: number): number {
  switch (type) {
    case 'shambler':
      return Math.max(0.4, 3 - index * 0.12);
    case 'runner':
      return 1 + index * 0.12;
    case 'brute':
      return 0.3 + index * 0.06;
    case 'boomer':
      return 0.3 + index * 0.05;
    case 'spitter':
      return 0.25 + index * 0.05;
    case 'stalker':
      return 0.25 + index * 0.05;
    case 'armored':
      return 0.4 + index * 0.06; // steady presence so melee stays relevant
    default:
      return 1;
  }
}

/** Spend the wave's budget on weighted affordable enemy rows to build a spawn queue. */
export function buildWaveQueue(index: number, rng: Rng, squad = 1): EnemyType[] {
  let budget = Math.round(waveBudget(index) * (0.6 + 0.4 * squad)); // +40% per extra player
  const queue: EnemyType[] = [];
  for (;;) {
    const opts = affordable(index, budget);
    if (opts.length === 0) break;
    const weights = opts.map((t) => weightFor(t, index));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    let type = opts[0];
    for (let i = 0; i < opts.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        type = opts[i];
        break;
      }
    }
    queue.push(type);
    budget -= ZOMBIES[type].cost;
  }
  return queue;
}

/** Shortest signed angular distance from a to b. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * L4D-style spawn validity: the zone's room must be unlocked (minWave), it
 * must not be right on top of a player, and it must not sit inside the
 * player's flashlight view (in cone + close + clear line of sight).
 */
export function zoneValid(state: GameState, z: SpawnZone, flow?: FlowField): boolean {
  if ((z.minWave ?? 0) > state.wave.index) return false;
  // Only spawn where zombies can actually REACH a player: a zone sealed behind a
  // still-closed (unbought) door has no flow-field value, so it's rejected. This
  // keeps the horde in the rooms you've opened — never trapped in a locked room.
  if (flow && !sampleFlow(flow, z.x, z.y)) return false;
  const solids = mapSolids(state);
  // rejected if it's too close to, or inside the lit view of, ANY standing player
  for (const p of state.players) {
    if (!p.alive || p.downed) continue;
    const dx = z.x - p.pos.x;
    const dy = z.y - p.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < SPAWN_MIN_DIST) return false;
    const inCone =
      dist < FLASHLIGHT_RANGE * SPAWN_SIGHT_DIST &&
      Math.abs(angleDiff(Math.atan2(dy, dx), p.aimAngle)) < FLASHLIGHT_HALF_ANGLE * 1.25;
    if (inCone && segmentClear(p.pos, { x: z.x, y: z.y }, solids)) return false;
  }
  return true;
}

/**
 * A valid zone, round-robined across all currently-valid zones so the horde
 * enters from many points instead of stacking on one. Null when every zone is
 * watched/locked (caller retries).
 */
function pickZone(state: GameState, flow?: FlowField): SpawnZone | null {
  const valid = state.spawnZones.filter((z) => zoneValid(state, z, flow));
  if (valid.length === 0) return state.spawnZones.length === 0 ? { x: 24, y: 24 } : null;
  const idx = state.wave.spawnCursor % valid.length;
  state.wave.spawnCursor = (state.wave.spawnCursor + 1) % 1_000_000;
  return valid[idx];
}

/** Least-bad zone for a boss entrance: reachable, unlocked, farthest from the squad's centroid. */
function pickBossZone(state: GameState, flow?: FlowField): SpawnZone {
  const up = state.players.filter((p) => p.alive);
  const cx = up.reduce((s, p) => s + p.pos.x, 0) / (up.length || 1);
  const cy = up.reduce((s, p) => s + p.pos.y, 0) / (up.length || 1);
  const eligible = state.spawnZones.filter(
    (z) => (z.minWave ?? 0) <= state.wave.index && (!flow || sampleFlow(flow, z.x, z.y)),
  );
  const pool = eligible.length > 0 ? eligible : [{ x: cx || 24, y: cy || 24 }];
  return pool.reduce((a, b) => (Math.hypot(a.x - cx, a.y - cy) >= Math.hypot(b.x - cx, b.y - cy) ? a : b));
}

function startWave(state: GameState, rng: Rng, flow?: FlowField): void {
  const wave = state.wave;
  wave.phase = 'active';
  // budget scales with how many players are still in the fight
  const squad = Math.max(1, state.players.filter((p) => p.alive).length);
  state.dogRound = isDogRound(wave.index);
  if (state.dogRound) {
    wave.spawnQueue = buildDogPack(wave.index, squad); // a fast glowing hound pack
    setNotice(state, 'HELLHOUNDS');
  } else {
    wave.spawnQueue = buildWaveQueue(wave.index, rng, squad);
    if (isBossWave(wave.index)) {
      spawnEnemy(state, bossForWave(wave.index), pickBossZone(state, flow)); // boss enters alongside the wave
    }
  }
  wave.spawnCooldown = 0; // first enemy spawns on the next tick
  wave.killsThisWave = 0;
}

export function updateWaves(state: GameState, dt: number, rng: Rng = Math.random, flow?: FlowField): void {
  if (state.gameOver) return;
  const wave = state.wave;

  if (wave.phase === 'intermission') {
    if (state.perkDraft) return; // a pending draft freezes the clock until someone picks
    wave.timer = Math.max(0, wave.timer - dt);
    if (wave.timer <= 0) startWave(state, rng, flow);
    return;
  }

  // active phase: drain the spawn queue on an interval; if every zone is
  // watched or locked, HOLD the spawn and retry — budget is never skipped.
  // COD max-on-screen cap: once the horde is at capacity, HOLD until kills free
  // a slot, so a big wave becomes a relentless advancing stream, not a lag-bomb.
  const squad = Math.max(1, state.players.filter((p) => p.alive).length);
  // AI Director wraps (never rewrites) the spawn gate: at peak it shrinks the
  // effective concurrent cap and lengthens the interval so the squad isn't buried
  // past a fair point; on the way down it opens a brief calmer window. The wave's
  // budget/queue is untouched — this only reshapes WHEN enemies arrive.
  const cap = Math.max(1, Math.floor(maxAlive(squad, wave.index) * directorCapMult(state)));
  const atCap = state.enemies.length >= cap;
  wave.spawnCooldown -= dt;
  if (wave.spawnQueue.length > 0 && wave.spawnCooldown <= 0 && !atCap) {
    const zone = pickZone(state, flow);
    if (zone) {
      const type = wave.spawnQueue.shift()!;
      // jitter the exact point so a burst from one zone still fans out
      const jz = {
        x: zone.x + (rng() - 0.5) * 2 * SPAWN_JITTER,
        y: zone.y + (rng() - 0.5) * 2 * SPAWN_JITTER,
        minWave: zone.minWave,
      };
      // Elite roll (RoR2-style) for normal-wave enemies; hellhounds stay unmodified.
      // Bosses never come through this queue, so they're skipped for free.
      const affix = type === 'hound' ? undefined : rollAffix(wave.index, rng);
      spawnEnemy(state, type, jz, affix);
      wave.spawnCooldown = WAVE_SPAWN_INTERVAL * directorIntervalMult(state);
    } else {
      wave.spawnCooldown = SPAWN_RETRY;
    }
  }

  // The final wave never clears — it just keeps topping up the horde until the
  // squad extracts (or dies). The escape objective decides the end (extraction.ts).
  if (isFinalWave(wave.index)) {
    if (wave.spawnQueue.length === 0) {
      const squad = Math.max(1, state.players.filter((p) => p.alive).length);
      wave.spawnQueue = buildWaveQueue(wave.index, rng, squad);
    }
    return;
  }

  // wave is cleared once nothing is left to spawn and nothing is left alive
  if (wave.spawnQueue.length === 0 && state.enemies.length === 0) {
    // Max Ammo guarantee: every hellhound round, plus every Nth wave otherwise
    // (endless ammo sustain so a long run never dies to an empty reserve).
    const dropAmmo = state.dogRound || wave.index % GUARANTEED_AMMO_EVERY === 0;
    if (dropAmmo) {
      const at = state.players.find((p) => p.alive) ?? state.players[0];
      state.powerups.push({ id: state.nextPowerUpId++, kind: 'maxammo', x: at.pos.x, y: at.pos.y, ttl: POWERUP_TTL });
    }
    state.dogRound = false;
    wave.index += 1;
    wave.phase = 'intermission';
    wave.timer = WAVE_INTERMISSION;
    // roguelite draft after every Nth wave cleared (not on the run into the finale)
    if (wave.index - 1 >= 1 && (wave.index - 1) % PERK_INTERVAL === 0 && !isFinalWave(wave.index)) {
      state.rerollCount = 0; // fresh draft → reroll cost starts at REROLL_BASE
      state.perkDraft = rollDraft(state, rng);
    }
  }
}
