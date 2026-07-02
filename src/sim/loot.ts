import { LOOT_DROP_CHANCE, LOOT_RADIUS, LOOT_TTL, PLAYER_RADIUS } from '../config';
import { WEAPONS } from './weapons';
import type { GameState, LootState, PlayerState, Vec2, WeaponId } from './types';

interface LootTemplate {
  kind: 'weapon' | 'ammo';
  weapon: WeaponId;
  amount: number; // weapon drops: starting ammo for limited weapons; ammo drops: refill size
}

/** What killed enemies can drop. Weapons carry an initial ammo load for limited kinds. */
const LOOT_TABLE: LootTemplate[] = [
  { kind: 'weapon', weapon: 'smg', amount: 0 },
  { kind: 'weapon', weapon: 'shotgun', amount: 0 },
  { kind: 'weapon', weapon: 'machinegun', amount: 0 },
  { kind: 'weapon', weapon: 'bat', amount: 0 },
  { kind: 'weapon', weapon: 'chainsaw', amount: 150 },
  { kind: 'weapon', weapon: 'minigun', amount: 200 },
  { kind: 'weapon', weapon: 'rpg', amount: 4 },
  { kind: 'ammo', weapon: 'minigun', amount: 150 },
  { kind: 'ammo', weapon: 'rpg', amount: 3 },
  { kind: 'ammo', weapon: 'chainsaw', amount: 120 },
];

/** Maybe drop a loot item at a killed enemy's position. Consumes two rng draws. */
export function dropLoot(state: GameState, pos: Vec2, rng: () => number): void {
  if (rng() >= LOOT_DROP_CHANCE) return;
  const t = LOOT_TABLE[Math.floor(rng() * LOOT_TABLE.length) % LOOT_TABLE.length];
  state.loot.push({
    id: state.nextLootId++,
    pos: { x: pos.x, y: pos.y },
    kind: t.kind,
    weapon: t.weapon,
    amount: t.amount,
    ttl: LOOT_TTL,
  });
}

function grantAmmo(p: PlayerState, weapon: WeaponId, amount: number): void {
  p.ammo[weapon] = (p.ammo[weapon] ?? 0) + amount;
}

function applyPickup(p: PlayerState, l: LootState): void {
  const limited = WEAPONS[l.weapon].startAmmo !== undefined;
  if (l.kind === 'ammo') {
    grantAmmo(p, l.weapon, l.amount);
    return;
  }
  // weapon pickup
  if (!p.owned.includes(l.weapon)) {
    p.owned.push(l.weapon);
    if (limited) grantAmmo(p, l.weapon, l.amount);
    p.weapon = l.weapon; // auto-equip a freshly found weapon
  } else if (limited) {
    grantAmmo(p, l.weapon, l.amount || 0); // duplicate of a limited weapon = more ammo
  }
}

export function updateLoot(state: GameState, dt: number): void {
  const rr = PLAYER_RADIUS + LOOT_RADIUS;
  const kept: LootState[] = [];
  for (const l of state.loot) {
    l.ttl -= dt;
    if (l.ttl <= 0) continue;
    // the first standing player to walk over it grabs it
    const taker = state.players.find(
      (p) => p.alive && !p.downed && (p.pos.x - l.pos.x) ** 2 + (p.pos.y - l.pos.y) ** 2 <= rr * rr,
    );
    if (!state.gameOver && taker) {
      applyPickup(taker, l);
      continue; // consumed
    }
    kept.push(l);
  }
  state.loot = kept;
}
