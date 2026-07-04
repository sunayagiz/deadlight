/**
 * Meta-progression loadouts — Brotato-style HORIZONTAL unlocks. Each loadout is a
 * run RULESET (starting weapons / perks / a small self-revive or max-HP tweak),
 * NOT a stat ladder: they open sideways playstyles, not strictly-stronger builds,
 * so unlocking can't power-creep the game.
 *
 * Render-layer data (imports only sim TYPES, never the sim runtime or localStorage).
 * The host reads the selected loadout at run start and applies it when building the
 * world — it shapes the starting player and is never part of the netcoded Snapshot.
 */

import { effectiveMaxHp, type PerkId } from '../sim/perks';
import type { GameState, PlayerState, WeaponId } from '../sim/types';
import { WEAPONS } from '../sim/weapons';

export interface Loadout {
  id: string;
  name: string;
  desc: string;
  cost: number; // currency to unlock; 0 = free/unlocked by default
  startWeapons: WeaponId[]; // owned[] at run start; startWeapons[0] is equipped
  startPerks?: Partial<Record<PerkId, number>>; // seeded into the shared perk levels
  maxHpBonus?: number; // flat max-HP added (applied via the vigor mechanism, 25/stack)
  selfReviveBonus?: number; // extra self-revive charges granted to the applied player
}

/**
 * The catalogue. `default` mirrors current behaviour (owned ['pistol','katana']).
 * The rest cost currency earned across runs and each lean into a different style.
 */
export const LOADOUTS: Loadout[] = [
  {
    id: 'default',
    name: 'SURVIVOR',
    desc: 'Pistol + Katana. The standard start.',
    cost: 0,
    startWeapons: ['pistol', 'katana'],
  },
  {
    id: 'brawler',
    name: 'BRAWLER',
    desc: 'Chainsaw + Katana, THORNS, +25 max HP. Get in their face.',
    cost: 150,
    startWeapons: ['chainsaw', 'katana'],
    startPerks: { thorns: 1 },
    maxHpBonus: 25,
  },
  {
    id: 'gunner',
    name: 'GUNNER',
    desc: 'SMG + Pistol, ADRENALINE (+fire rate). Spray and pray.',
    cost: 150,
    startWeapons: ['smg', 'pistol'],
    startPerks: { firerate: 1 },
  },
  {
    id: 'medic',
    name: 'MEDIC',
    desc: 'Pistol + Katana, REGEN + an extra self-revive. Stay standing.',
    cost: 200,
    startWeapons: ['pistol', 'katana'],
    startPerks: { regen: 1 },
    selfReviveBonus: 1,
  },
];

const BY_ID = new Map(LOADOUTS.map((l) => [l.id, l]));

/** Lookup a loadout by id; falls back to `default` for unknown/legacy ids. */
export function getLoadout(id: string): Loadout {
  return BY_ID.get(id) ?? LOADOUTS[0];
}

/**
 * Apply a loadout to one player at run start (host/solo side only). Mutates plain
 * sim data — starting arsenal + ammo, the shared perk seed, max-HP and self-revive.
 * This runs BEFORE any snapshot is taken, so it never touches the netcode.
 *
 * Co-op note: weapons / HP / self-revive apply to the HOST's own player; perks are
 * squad-shared in this game, so a host loadout's startPerks/maxHpBonus (folded into
 * the vigor mechanism) benefit the whole squad. Per-player loadouts can come later.
 */
export function applyLoadout(state: GameState, p: PlayerState, id: string): void {
  const l = getLoadout(id);
  // starting weapons + equip the first
  p.owned = [...l.startWeapons];
  p.weapon = l.startWeapons[0];
  // grant starting ammo for limited weapons (chainsaw etc.) — same path shop/loot use
  for (const w of l.startWeapons) {
    const def = WEAPONS[w];
    if (def.startAmmo !== undefined) p.ammo[w] = Math.max(p.ammo[w] ?? 0, def.startAmmo);
  }
  // seed the shared squad perks
  if (l.startPerks) {
    for (const [pid, lvl] of Object.entries(l.startPerks)) {
      state.perks[pid] = Math.max(state.perks[pid] ?? 0, lvl);
    }
  }
  // max-HP bonus via the vigor mechanism (25 HP / stack) so the sim's HP cap tracks it
  if (l.maxHpBonus && l.maxHpBonus > 0) {
    const stacks = Math.round(l.maxHpBonus / 25);
    state.perks.vigor = Math.max(state.perks.vigor ?? 0, stacks);
  }
  // start full at the (possibly raised) effective cap; grant any extra self-revives
  p.hp = effectiveMaxHp(state);
  if (l.selfReviveBonus) p.selfReviveCharges += l.selfReviveBonus;
}
