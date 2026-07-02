import type { GameState, PlayerInput, PlayerState, WeaponId, WeaponKind } from './types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: WeaponKind;
  damage: number;
  fireRate: number; // shots or swings per second (minigun scales this with spin)
  // gun / rpg
  bulletSpeed?: number; // px/s
  bulletTtl?: number; // seconds
  pellets?: number; // projectiles per trigger pull (shotgun)
  spread?: number; // radians of random spread
  spinUpTime?: number; // minigun: seconds of held fire to reach full rate
  splashRadius?: number; // rpg
  splashDamage?: number;
  // melee
  range?: number; // reach in px
  arc?: number; // half-angle of the swing in radians
  hold?: boolean; // chainsaw = continuous dps; others swing on cooldown
  // ammo
  startAmmo?: number; // undefined = infinite
}

/**
 * Data-driven arsenal (design spec §4.2). Behaviour is chosen by `kind`; every
 * other knob is data. New weapon = new row, not a new class.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Pistol', kind: 'gun', damage: 25, fireRate: 4, bulletSpeed: 900, bulletTtl: 0.8, pellets: 1, spread: 0 },
  smg: { id: 'smg', name: 'SMG', kind: 'gun', damage: 12, fireRate: 12, bulletSpeed: 950, bulletTtl: 0.7, spread: 0.05 },
  shotgun: { id: 'shotgun', name: 'Shotgun', kind: 'gun', damage: 14, fireRate: 1.3, bulletSpeed: 850, bulletTtl: 0.35, pellets: 8, spread: 0.35 },
  machinegun: { id: 'machinegun', name: 'Machine Gun', kind: 'gun', damage: 20, fireRate: 9, bulletSpeed: 1000, bulletTtl: 0.9, spread: 0.06 },
  minigun: { id: 'minigun', name: 'Minigun', kind: 'gun', damage: 18, fireRate: 20, bulletSpeed: 1050, bulletTtl: 0.9, spread: 0.1, spinUpTime: 1, startAmmo: 400 },
  rpg: { id: 'rpg', name: 'RPG', kind: 'rpg', damage: 80, fireRate: 0.7, bulletSpeed: 620, bulletTtl: 2.5, splashRadius: 110, splashDamage: 120, startAmmo: 8 },
  katana: { id: 'katana', name: 'Katana', kind: 'melee', damage: 70, fireRate: 2.2, range: 64, arc: 0.9 },
  bat: { id: 'bat', name: 'Baseball Bat', kind: 'melee', damage: 50, fireRate: 2.6, range: 58, arc: 1.0 },
  chainsaw: { id: 'chainsaw', name: 'Chainsaw', kind: 'melee', damage: 60, fireRate: 1, range: 52, arc: 0.6, hold: true, startAmmo: 300 },
};

export function updateAim(p: PlayerState, input: PlayerInput): void {
  p.aimAngle = Math.atan2(input.aimWorldY - p.pos.y, input.aimWorldX - p.pos.x);
}

/** Equip an owned weapon by id (no-op if not owned). */
export function equipWeapon(p: PlayerState, id: WeaponId): void {
  if (p.owned.includes(id)) p.weapon = id;
}

/** Step through the owned weapons; dir = +1 next, -1 previous. */
export function cycleWeapon(p: PlayerState, dir: number): void {
  const n = p.owned.length;
  if (n === 0) return;
  const i = p.owned.indexOf(p.weapon);
  p.weapon = p.owned[(((i + dir) % n) + n) % n];
}

export function hasAmmo(p: PlayerState, def: WeaponDef): boolean {
  if (def.startAmmo === undefined) return true;
  return (p.ammo[def.id] ?? 0) > 0;
}

/** Guns and the RPG spawn bullets here. Melee is resolved separately in melee.ts. */
export function updateFiring(
  state: GameState,
  p: PlayerState,
  input: PlayerInput,
  dt: number,
  rng: () => number = Math.random,
): void {
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  const def = WEAPONS[p.weapon];

  // Minigun spin-up while holding fire, decay otherwise (even after a weapon switch).
  const spinUp = def.spinUpTime ?? 0.001;
  const spinning = def.id === 'minigun' && input.fire;
  p.spin = spinning
    ? Math.min(1, p.spin + dt / spinUp)
    : Math.max(0, p.spin - dt / (spinUp * 0.5));

  if (def.kind === 'melee') return; // handled by updateMelee
  if (!input.fire || p.fireCooldown > 0 || !hasAmmo(p, def)) return;

  const rateScale = def.id === 'minigun' ? 0.2 + 0.8 * p.spin : 1;
  const pellets = def.pellets ?? 1;
  const spread = def.spread ?? 0;
  for (let i = 0; i < pellets; i++) {
    const jitter = spread ? (rng() - 0.5) * spread : 0;
    const a = p.aimAngle + jitter;
    state.bullets.push({
      id: state.nextBulletId++,
      pos: { x: p.pos.x, y: p.pos.y },
      vel: { x: Math.cos(a) * def.bulletSpeed!, y: Math.sin(a) * def.bulletSpeed! },
      ttl: def.bulletTtl!,
      damage: def.damage,
      splashRadius: def.splashRadius ?? 0,
      splashDamage: def.splashDamage ?? 0,
      hostile: false,
    });
  }
  if (def.startAmmo !== undefined) p.ammo[def.id] = (p.ammo[def.id] ?? 0) - 1;
  p.fireCooldown = 1 / (def.fireRate * rateScale);
}

/** Integrate bullet motion and age them. Removal + explosions happen in combat. */
export function updateBullets(state: GameState, dt: number): void {
  for (const b of state.bullets) {
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.ttl -= dt;
  }
}
