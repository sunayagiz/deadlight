import {
  BARRICADE_ATTACK_REACH,
  BARRICADE_HP,
  BARRICADE_SIZE,
  COST_BARRICADE,
  COST_TRAP,
  DEPLOY_PLACE_RANGE,
  MAX_BARRICADES,
  MAX_TRAPS,
  TRAP_DAMAGE,
  TRAP_PULSE_CD,
  TRAP_RADIUS,
} from '../config';
import { setNotice } from './cod';
import { ZOMBIES } from './enemies';
import { mapSolids } from './map';
import { isUp, type DeployableKind, type GameState, type PlayerInput, type PlayerState } from './types';

const HIT_FLASH = 0.08; // match combat.ts so a zapped enemy flashes like a shot one

/** Points cost for a deployable kind. */
export function deployCost(kind: DeployableKind): number {
  return kind === 'barricade' ? COST_BARRICADE : COST_TRAP;
}

/** Per-squad build cap for a deployable kind (anti-spam). */
export function deployMax(kind: DeployableKind): number {
  return kind === 'barricade' ? MAX_BARRICADES : MAX_TRAPS;
}

/** How many of this kind are currently placed. */
export function deployCount(state: GameState, kind: DeployableKind): number {
  return state.deployables.reduce((n, d) => (d.kind === kind ? n + 1 : n), 0);
}

/**
 * Is a world point clear FLOOR for a deployable of this kind (not inside/overlapping
 * a solid — wall, closed door, or an existing barricade)? A barricade must fit its
 * whole footprint on open floor; a trap only needs its centre clear.
 */
export function placementClear(state: GameState, x: number, y: number, kind: DeployableKind): boolean {
  const solids = mapSolids(state);
  if (kind === 'trap') {
    return !solids.some((w) => x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h);
  }
  const half = BARRICADE_SIZE / 2;
  const bx = x - half;
  const by = y - half;
  return !solids.some(
    (w) => bx < w.x + w.w && bx + BARRICADE_SIZE > w.x && by < w.y + w.h && by + BARRICADE_SIZE > w.y,
  );
}

/** Full placement predicate (affordable + under cap + in range + clear floor) — drives both the sim and the render preview. */
export function canPlaceDeployable(state: GameState, p: PlayerState, x: number, y: number, kind: DeployableKind): boolean {
  if (state.cash < deployCost(kind)) return false;
  if (deployCount(state, kind) >= deployMax(kind)) return false;
  const dx = x - p.pos.x;
  const dy = y - p.pos.y;
  if (dx * dx + dy * dy > DEPLOY_PLACE_RANGE * DEPLOY_PLACE_RANGE) return false;
  return placementClear(state, x, y, kind);
}

/** Resolve one player's build request this tick (host-authoritative). */
function tryPlace(state: GameState, p: PlayerState, owner: number, req: { x: number; y: number; kind: DeployableKind }): void {
  const { x, y, kind } = req;
  if (state.cash < deployCost(kind)) {
    setNotice(state, 'NOT ENOUGH POINTS');
    return;
  }
  if (deployCount(state, kind) >= deployMax(kind)) {
    setNotice(state, `MAX ${kind === 'barricade' ? 'BARRICADES' : 'TRAPS'}`);
    return;
  }
  const dx = x - p.pos.x;
  const dy = y - p.pos.y;
  if (dx * dx + dy * dy > DEPLOY_PLACE_RANGE * DEPLOY_PLACE_RANGE) {
    setNotice(state, 'TOO FAR');
    return;
  }
  if (!placementClear(state, x, y, kind)) {
    setNotice(state, 'BLOCKED');
    return;
  }
  state.deployables.push(
    kind === 'barricade'
      ? { id: state.nextDeployableId++, kind, x, y, hp: BARRICADE_HP, owner }
      : { id: state.nextDeployableId++, kind, x, y, cd: 0, owner },
  );
  state.cash -= deployCost(kind);
  setNotice(state, kind === 'barricade' ? 'BARRICADE RAISED' : 'TRAP ARMED');
}

/** Fold every standing player's `place` action into new deployables. */
export function placeDeployables(state: GameState, inputs: PlayerInput[]): void {
  state.players.forEach((p, i) => {
    const req = inputs[i]?.place;
    if (!isUp(p) || !req) return;
    tryPlace(state, p, i, req);
  });
}

/**
 * Electric-floor traps: each pulse zaps EVERY enemy inside its radius for TRAP_DAMAGE
 * (bosses take half), then goes on cooldown. Permanent — it never expires or runs out
 * of charges; the pulse cooldown is the only throttle. Not solid, so enemies walk over
 * it and get shocked. Runs before combat clears the dead, so trap kills earn cash/loot.
 */
export function updateTraps(state: GameState, dt: number): void {
  for (const d of state.deployables) {
    if (d.kind !== 'trap') continue;
    d.cd = Math.max(0, (d.cd ?? 0) - dt);
    if (d.cd > 0) continue; // still recharging
    let zapped = false;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.pos.x - d.x;
      const dy = e.pos.y - d.y;
      if (dx * dx + dy * dy <= TRAP_RADIUS * TRAP_RADIUS) {
        e.hp -= e.boss ? TRAP_DAMAGE * 0.5 : TRAP_DAMAGE;
        e.hitFlash = HIT_FLASH;
        zapped = true;
      }
    }
    if (zapped) d.cd = TRAP_PULSE_CD; // only spend the cooldown when it actually fired
  }
}

/**
 * Enemies chew through a barricade they're up against: each enemy adjacent to a
 * barricade deals contactDamage×dt to the nearest one in reach. A barricade at 0 hp
 * is removed (and immediately stops being a solid via mapSolids).
 */
export function updateBarricadeAttacks(state: GameState, dt: number): void {
  const bars = state.deployables.filter((d) => d.kind === 'barricade' && (d.hp ?? 0) > 0);
  if (bars.length > 0) {
    const half = BARRICADE_SIZE / 2;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const reach = ZOMBIES[e.type].radius + BARRICADE_ATTACK_REACH;
      let target: (typeof bars)[number] | undefined;
      let bd = reach * reach;
      for (const b of bars) {
        // squared distance from the enemy centre to the barricade AABB
        const cx = Math.max(b.x - half, Math.min(e.pos.x, b.x + half));
        const cy = Math.max(b.y - half, Math.min(e.pos.y, b.y + half));
        const dx = e.pos.x - cx;
        const dy = e.pos.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bd) {
          bd = d2;
          target = b;
        }
      }
      if (target) target.hp = (target.hp ?? 0) - ZOMBIES[e.type].contactDamage * dt;
    }
  }
  // sweep out destroyed barricades (traps and alive barricades are kept)
  if (state.deployables.some((d) => d.kind === 'barricade' && (d.hp ?? 0) <= 0)) {
    state.deployables = state.deployables.filter((d) => !(d.kind === 'barricade' && (d.hp ?? 0) <= 0));
  }
}
