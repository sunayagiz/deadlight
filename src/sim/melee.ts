import { ZOMBIES } from './enemies';
import { WEAPONS, type WeaponDef } from './weapons';
import type { GameState, PlayerInput } from './types';

const HIT_FLASH = 0.08;
const SWING_TIME = 0.12; // seconds the swing arc is shown / active

/** Shortest signed angular distance from a to b, in [-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Damage every enemy inside the weapon's reach and swing arc, centered on aim. */
function hitArc(state: GameState, def: WeaponDef, damage: number): void {
  const p = state.player;
  for (const e of state.enemies) {
    const dx = e.pos.x - p.pos.x;
    const dy = e.pos.y - p.pos.y;
    const reach = (def.range ?? 0) + ZOMBIES[e.type].radius;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), p.aimAngle)) > (def.arc ?? 0)) continue;
    e.hp -= damage;
    e.hitFlash = HIT_FLASH;
  }
}

/**
 * Melee combat. Swing weapons (katana/bat) land one arc hit per cooldown;
 * held weapons (chainsaw) apply continuous dps and burn fuel. fireCooldown is
 * decremented in updateFiring, so this only reads/sets it.
 */
export function updateMelee(state: GameState, input: PlayerInput, dt: number): void {
  const p = state.player;
  p.meleeSwing = Math.max(0, p.meleeSwing - dt);

  const def = WEAPONS[p.weapon];
  if (def.kind !== 'melee' || !input.fire) return;

  const limited = def.startAmmo !== undefined;
  if (limited && (p.ammo[def.id] ?? 0) <= 0) return;

  if (def.hold) {
    hitArc(state, def, def.damage * dt); // dps
    p.meleeSwing = 0.05;
    if (limited) p.ammo[def.id] = (p.ammo[def.id] ?? 0) - dt;
  } else {
    if (p.fireCooldown > 0) return;
    hitArc(state, def, def.damage);
    p.fireCooldown = 1 / def.fireRate;
    p.meleeSwing = SWING_TIME;
  }
}
