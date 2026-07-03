import { PLAYER_MAX_HP } from '../config';
import { effectiveMaxHp } from './perks';
import { WEAPONS } from './weapons';
import type { GameState, PlayerState, WeaponId } from './types';

export interface ShopItem {
  id: string;
  name: string;
  cost: number;
  kind: 'heal' | 'ammo' | 'weapon';
  weapon?: WeaponId; // for weapon buys
  amount?: number; // heal amount, or ammo granted for a weapon buy
}

/**
 * Between-wave catalog (design: co-op shared economy). Purchases are host-
 * authoritative — they flow in through PlayerInput.buy so guests buy too. Buying
 * a weapon you own instead tops up its ammo.
 */
export const SHOP: ShopItem[] = [
  { id: 'heal', name: 'Medkit  +60 HP', cost: 90, kind: 'heal', amount: 60 },
  { id: 'ammo', name: 'Ammo Resupply', cost: 70, kind: 'ammo' },
  { id: 'smg', name: 'SMG', cost: 140, kind: 'weapon', weapon: 'smg', amount: 0 },
  { id: 'shotgun', name: 'Shotgun', cost: 170, kind: 'weapon', weapon: 'shotgun', amount: 0 },
  { id: 'machinegun', name: 'Machine Gun', cost: 240, kind: 'weapon', weapon: 'machinegun', amount: 0 },
  { id: 'chainsaw', name: 'Chainsaw  +300', cost: 260, kind: 'weapon', weapon: 'chainsaw', amount: 300 },
  { id: 'minigun', name: 'Minigun  +400', cost: 360, kind: 'weapon', weapon: 'minigun', amount: 400 },
  { id: 'rpg', name: 'RPG  +6', cost: 420, kind: 'weapon', weapon: 'rpg', amount: 6 },
];

function grant(p: PlayerState, weapon: WeaponId, amount: number): void {
  p.ammo[weapon] = (p.ammo[weapon] ?? 0) + amount;
}

/** Refill every limited weapon the player owns to a healthy reserve. */
function resupply(p: PlayerState): void {
  for (const id of p.owned) {
    const def = WEAPONS[id];
    if (def.startAmmo !== undefined) p.ammo[id] = Math.max(p.ammo[id] ?? 0, def.startAmmo);
  }
}

/**
 * Attempt purchase `index` for player slot `pi`. Returns true on success.
 * Silently no-ops on bad index / not enough cash / already-owned weapon (ammo
 * top-up counts as success only when the weapon carries ammo).
 */
export function buy(state: GameState, pi: number, index: number): boolean {
  const item = SHOP[index];
  const p = state.players[pi];
  if (!item || !p || !p.alive || p.downed) return false;
  if (state.cash < item.cost) return false;

  if (item.kind === 'heal') {
    const max = effectiveMaxHp(state);
    if (p.hp >= max) return false; // no waste
    p.hp = Math.min(max, p.hp + (item.amount ?? PLAYER_MAX_HP));
  } else if (item.kind === 'ammo') {
    resupply(p);
  } else {
    const w = item.weapon!;
    const limited = WEAPONS[w].startAmmo !== undefined;
    if (!p.owned.includes(w)) {
      p.owned.push(w);
      if (limited) grant(p, w, item.amount ?? 0);
      p.weapon = w; // auto-equip the fresh buy
    } else if (limited) {
      grant(p, w, item.amount ?? 0); // duplicate limited weapon = more ammo
    } else {
      return false; // already own an infinite-ammo weapon, nothing to give
    }
  }
  state.cash -= item.cost;
  return true;
}
