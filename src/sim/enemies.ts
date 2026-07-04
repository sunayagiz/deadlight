import {
  BOSS_HP_SCALE_FRAC,
  ENEMY_HP_EXP,
  ENEMY_HP_EXP_LATE,
  ENEMY_HP_EXP_LATE_WAVE,
  ENEMY_HP_EXP_WAVE,
  ENEMY_HP_LINEAR,
  ENEMY_SEPARATION_FORCE,
  ENEMY_SEPARATION_RADIUS,
  ENEMY_SPEED_PER_WAVE,
  ENEMY_SPEED_SCALE_MAX,
  MAX_ALIVE_BASE,
  MAX_ALIVE_CEIL,
  MAX_ALIVE_PER_PLAYER,
  MAX_ALIVE_PER_WAVE,
  SPITTER_ACID_DMG,
  SPITTER_ACID_SPEED,
  SPITTER_ACID_TTL,
  SPITTER_FIRE_CD,
  SPITTER_RANGE,
  SPITTER_STANDOFF,
  SPITTER_WINDUP,
  STALKER_BRACE_MULT,
  STALKER_FLANK,
  STALKER_LUNGE_CD,
  STALKER_LUNGE_RANGE,
  STALKER_LUNGE_SPEED,
  STALKER_LUNGE_TIME,
  STALKER_WINDUP,
} from '../config';
import { affixHpMult, affixRegenPerSec, affixSpeedMult } from './affix';
import { sampleFlow, type FlowField } from './flowfield';
import { mapSolids } from './map';
import { segmentClear } from './vision';
import { norm } from './vec';
import type { AffixId, EnemyState, EnemyType, GameState, PlayerState, SpawnZone, Wall } from './types';

/**
 * COD-style HP ramp: linear through wave ENEMY_HP_EXP_WAVE, then compounding
 * (×ENEMY_HP_EXP each wave after). Wave 1 = ×1 so early waves are unchanged.
 */
export function enemyHpScale(wave: number): number {
  const w = Math.max(1, wave);
  const linear = 1 + ENEMY_HP_LINEAR * (Math.min(w, ENEMY_HP_EXP_WAVE) - 1);
  if (w <= ENEMY_HP_EXP_WAVE) return linear;
  // waves 10..LATE compound at ×1.1 (the fun COD ramp); past LATE, soften to ×1.06
  // so it never becomes an unkillable bullet-sponge wall.
  const mid = Math.min(w, ENEMY_HP_EXP_LATE_WAVE) - ENEMY_HP_EXP_WAVE;
  const late = Math.max(0, w - ENEMY_HP_EXP_LATE_WAVE);
  return linear * ENEMY_HP_EXP ** mid * ENEMY_HP_EXP_LATE ** late;
}

/** Zombies speed up each wave (walkers → sprinters), capped so they stay kite-able. */
export function enemySpeedScale(wave: number): number {
  return Math.min(ENEMY_SPEED_SCALE_MAX, 1 + ENEMY_SPEED_PER_WAVE * (Math.max(1, wave) - 1));
}

/**
 * Max-on-screen cap: a relentless advancing stream that GROWS each wave (denser
 * late rounds) but never past a lag-safe ceiling.
 */
export function maxAlive(players: number, wave = 1): number {
  const cap = MAX_ALIVE_BASE + MAX_ALIVE_PER_PLAYER * Math.max(0, players - 1) + Math.floor(Math.max(0, wave - 1) * MAX_ALIVE_PER_WAVE);
  return Math.min(MAX_ALIVE_CEIL, cap);
}

export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  speed: number; // px/s
  radius: number;
  contactDamage: number; // damage-per-second while touching a player
  cost: number; // wave-budget cost (0 for bosses; they are spawned directly)
  boss?: boolean;
  bulletResist?: number; // 0..1 fraction of NON-melee damage ignored (armored → melee it)
}

/** Data-driven enemy table (design spec / slice-2 spec). New enemy = new row, not a new class. */
export const ZOMBIES: Record<EnemyType, EnemyDef> = {
  shambler: { type: 'shambler', name: 'Shambler', hp: 60, speed: 55, radius: 13, contactDamage: 18, cost: 1 },
  runner: { type: 'runner', name: 'Runner', hp: 30, speed: 130, radius: 10, contactDamage: 12, cost: 2 },
  brute: { type: 'brute', name: 'Brute', hp: 220, speed: 42, radius: 20, contactDamage: 35, cost: 5 },
  bloater: { type: 'bloater', name: 'Bloater', hp: 900, speed: 40, radius: 30, contactDamage: 40, cost: 0, boss: true },
  screamer: { type: 'screamer', name: 'Screamer', hp: 650, speed: 72, radius: 26, contactDamage: 25, cost: 0, boss: true },
  // Hellhound — fast, fragile, glowing; only in dog special rounds.
  hound: { type: 'hound', name: 'Hellhound', hp: 45, speed: 178, radius: 12, contactDamage: 22, cost: 2 },
  // Spitter — ranged: holds its distance and lobs acid at you.
  spitter: { type: 'spitter', name: 'Spitter', hp: 90, speed: 58, radius: 13, contactDamage: 12, cost: 3 },
  // Boomer — fast bloated rusher that explodes on death (mind your kills).
  boomer: { type: 'boomer', name: 'Boomer', hp: 70, speed: 118, radius: 16, contactDamage: 14, cost: 3 },
  // Stalker — lean lurker that periodically lunges across the gap.
  stalker: { type: 'stalker', name: 'Stalker', hp: 55, speed: 98, radius: 11, contactDamage: 20, cost: 3 },
  // Armored — riot-plated: bullets ping off (75% resisted), melee cuts it down.
  armored: { type: 'armored', name: 'Armored', hp: 110, speed: 62, radius: 15, contactDamage: 22, cost: 4, bulletResist: 0.75 },
};

export function isBoss(type: EnemyType): boolean {
  return ZOMBIES[type].boss === true;
}

export function spawnEnemy(state: GameState, type: EnemyType, zone: SpawnZone, affix?: AffixId): EnemyState {
  const def = ZOMBIES[type];
  // per-wave HP ramp; bosses (already huge) take a softer fraction of it
  const ramp = enemyHpScale(state.wave.index);
  const scale = def.boss ? 1 + (ramp - 1) * BOSS_HP_SCALE_FRAC : ramp;
  const e: EnemyState = {
    id: state.nextEnemyId++,
    type,
    pos: { x: zone.x, y: zone.y },
    vel: { x: 0, y: 0 },
    hp: Math.round(def.hp * scale),
    hitFlash: 0,
    ...(def.boss ? { boss: { attackCd: 1.5, telegraph: 0, pending: null } } : {}),
  };
  // Elite modifier: tag it and bake the HP multiplier in, remembering spawn HP so
  // vampiric regen can't over-heal past it. maxHp is serialized (part of EnemyState).
  if (affix) {
    e.affix = affix;
    e.hp = Math.round(e.hp * affixHpMult(e));
    e.maxHp = e.hp;
  }
  state.enemies.push(e);
  return e;
}

function hitWall(x: number, y: number, r: number, walls: Wall[]): Wall | undefined {
  return walls.find(
    (w) => x + r > w.x && x - r < w.x + w.w && y + r > w.y && y - r < w.y + w.h,
  );
}

/** Steer away from nearby enemies so a swarm doesn't collapse into one point. */
function separation(e: EnemyState, enemies: EnemyState[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const other of enemies) {
    if (other === e) continue;
    const dx = e.pos.x - other.pos.x;
    const dy = e.pos.y - other.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0 && d2 < ENEMY_SEPARATION_RADIUS * ENEMY_SEPARATION_RADIUS) {
      const d = Math.sqrt(d2);
      sx += dx / d;
      sy += dy / d;
    }
  }
  return { x: sx, y: sy };
}

export function updateEnemies(
  enemies: EnemyState[],
  players: PlayerState[],
  walls: Wall[],
  dt: number,
  flow?: FlowField,
  speedScale = 1, // per-wave speed ramp (defaults to 1 for tests/solo callers)
): void {
  const targets = players.filter((p) => p.alive && !p.downed);
  const pool = targets.length > 0 ? targets : players;
  const nearest = (e: EnemyState): PlayerState =>
    pool.reduce((a, b) =>
      (a.pos.x - e.pos.x) ** 2 + (a.pos.y - e.pos.y) ** 2 <= (b.pos.x - e.pos.x) ** 2 + (b.pos.y - e.pos.y) ** 2 ? a : b,
    );
  for (const e of enemies) {
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    const def = ZOMBIES[e.type];

    // Vampiric elites knit themselves back together (host-side), never past spawn HP.
    const rps = affixRegenPerSec(e);
    if (rps > 0 && e.hp > 0) e.hp = Math.min(e.maxHp ?? e.hp, e.hp + rps * dt);

    // Route via the flow field (handles rooms/doors, already multi-source); fall
    // back to straight seek toward the nearest player when off-grid/unreachable.
    const tp = nearest(e);
    const spd = def.speed * speedScale * affixSpeedMult(e); // per-wave ramp + elite speed (swift/tank)
    const tdx = tp.pos.x - e.pos.x;
    const tdy = tp.pos.y - e.pos.y;
    const tdist = Math.hypot(tdx, tdy) || 1;

    // Stalker mid-lunge: dash straight at the player, ignoring flow + separation.
    if (e.type === 'stalker' && (e.lunge ?? 0) > 0) {
      e.lunge = (e.lunge ?? 0) - dt;
      e.vel = { x: (tdx / tdist) * STALKER_LUNGE_SPEED, y: (tdy / tdist) * STALKER_LUNGE_SPEED };
    } else if (e.type === 'stalker' && (e.windup ?? 0) > 0) {
      // Wind-up: the stalker BRACES (near-stops, slight retreat) — a readable
      // tell — then the lunge dash fires when the timer runs out.
      e.windup = Math.max(0, (e.windup ?? 0) - dt);
      const brace = def.speed * STALKER_BRACE_MULT;
      e.vel = { x: -(tdx / tdist) * brace, y: -(tdy / tdist) * brace };
      if (e.windup === 0) {
        e.lunge = STALKER_LUNGE_TIME;
        e.cd = STALKER_LUNGE_CD;
      }
    } else {
      const seek =
        (flow && sampleFlow(flow, e.pos.x, e.pos.y)) ?? norm({ x: tdx, y: tdy });
      let skx = seek.x;
      let sky = seek.y;
      // Spitter keeps its distance: back off when the player gets inside standoff range.
      if (e.type === 'spitter' && tdist < SPITTER_STANDOFF) {
        skx = -skx;
        sky = -sky;
      }
      // Stalker pack tactic: lurk the player's DARK side. Bias the approach
      // laterally toward the flank/rear away from the flashlight aim, so it
      // slips in from where the beam isn't pointing. Cheap + deterministic;
      // still normalized below, so flow-field pathing and wall collision hold.
      if (e.type === 'stalker') {
        const ax = Math.cos(tp.aimAngle);
        const ay = Math.sin(tp.aimAngle);
        const ux = tdx / tdist;
        const uy = tdy / tdist;
        const adotu = ax * ux + ay * uy;
        let fx = adotu * ux - ax; // lateral push that rotates the approach toward the player's rear
        let fy = adotu * uy - ay;
        const fl = Math.hypot(fx, fy);
        if (fl > 1e-4) {
          skx += (fx / fl) * STALKER_FLANK;
          sky += (fy / fl) * STALKER_FLANK;
        }
      }
      const sep = separation(e, enemies);
      const desired = norm({
        x: skx * spd + sep.x * ENEMY_SEPARATION_FORCE,
        y: sky * spd + sep.y * ENEMY_SEPARATION_FORCE,
      });
      e.vel = { x: desired.x * spd, y: desired.y * spd };
      // Stalker charges a lunge; when the gap is right it enters a braced
      // wind-up (telegraph) that arms the dash rather than lunging outright.
      if (e.type === 'stalker') {
        e.cd = Math.max(0, (e.cd ?? STALKER_LUNGE_CD) - dt);
        if (e.cd === 0 && tdist < STALKER_LUNGE_RANGE) {
          e.windup = STALKER_WINDUP;
          const brace = def.speed * STALKER_BRACE_MULT;
          e.vel = { x: -(tdx / tdist) * brace, y: -(tdy / tdist) * brace }; // brace immediately
        }
      }
    }

    // Per-axis AABB wall collision (same model as the player).
    let nx = e.pos.x + e.vel.x * dt;
    const wx = hitWall(nx, e.pos.y, def.radius, walls);
    if (wx) nx = e.vel.x > 0 ? wx.x - def.radius : wx.x + wx.w + def.radius;
    e.pos.x = nx;

    let ny = e.pos.y + e.vel.y * dt;
    const wy = hitWall(e.pos.x, ny, def.radius, walls);
    if (wy) ny = e.vel.y > 0 ? wy.y - def.radius : wy.y + wy.h + def.radius;
    e.pos.y = ny;
  }
}

/** Spitters lob acid globs (hostile bullets) at a player in range with clear LOS. */
export function updateRangedEnemies(state: GameState, dt: number): void {
  const up = state.players.filter((p) => p.alive && !p.downed);
  if (up.length === 0) return;
  const solids = mapSolids(state);
  const nearestUp = (e: EnemyState) =>
    up.reduce((a, b) =>
      (a.pos.x - e.pos.x) ** 2 + (a.pos.y - e.pos.y) ** 2 <= (b.pos.x - e.pos.x) ** 2 + (b.pos.y - e.pos.y) ** 2 ? a : b,
    );
  const fire = (e: EnemyState, dx: number, dy: number): void => {
    const a = Math.atan2(dy, dx);
    state.bullets.push({
      id: state.nextBulletId++,
      pos: { x: e.pos.x, y: e.pos.y },
      vel: { x: Math.cos(a) * SPITTER_ACID_SPEED, y: Math.sin(a) * SPITTER_ACID_SPEED },
      ttl: SPITTER_ACID_TTL,
      damage: SPITTER_ACID_DMG,
      splashRadius: 0,
      splashDamage: 0,
      hostile: true,
      owner: -1,
    });
  };
  for (const e of state.enemies) {
    if (e.type !== 'spitter') continue;

    // Charging: the spitter has committed to a shot and is visibly winding up.
    // When the charge completes it fires — but only if the target is still in
    // range with clear LOS, so a player who broke away isn't hit blind.
    if ((e.windup ?? 0) > 0) {
      e.windup = Math.max(0, (e.windup ?? 0) - dt);
      if ((e.windup ?? 0) > 0) continue; // still charging this tick
      const tp = nearestUp(e);
      const dx = tp.pos.x - e.pos.x;
      const dy = tp.pos.y - e.pos.y;
      if (dx * dx + dy * dy <= SPITTER_RANGE * SPITTER_RANGE && segmentClear(e.pos, tp.pos, solids)) {
        fire(e, dx, dy);
      }
      e.cd = SPITTER_FIRE_CD;
      continue;
    }

    e.cd = Math.max(0, (e.cd ?? SPITTER_FIRE_CD) - dt);
    const tp = nearestUp(e);
    const dx = tp.pos.x - e.pos.x;
    const dy = tp.pos.y - e.pos.y;
    if (e.cd > 0 || dx * dx + dy * dy > SPITTER_RANGE * SPITTER_RANGE) continue;
    if (!segmentClear(e.pos, tp.pos, solids)) continue;
    // Begin the telegraphed charge instead of firing outright.
    e.windup = SPITTER_WINDUP;
  }
}
