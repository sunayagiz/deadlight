import { PERK_CHOICES, PERK_MAX_LEVEL, PLAYER_MAX_HP } from '../config';
import type { GameState, PlayerState } from './types';
import type { Rng } from './waves';

export type PerkId =
  | 'damage'
  | 'firerate'
  | 'speed'
  | 'vigor'
  | 'regen'
  | 'lifesteal'
  | 'thorns'
  | 'greed';

export interface PerkDef {
  id: PerkId;
  name: string;
  desc: string; // per-stack effect, shown in the draft
}

/**
 * Squad-shared, stackable roguelite perks. Every knob is data; the sim reads the
 * derived multipliers below. A draft offers PERK_CHOICES of these each interval.
 */
export const PERKS: Record<PerkId, PerkDef> = {
  damage: { id: 'damage', name: 'HOLLOW-POINTS', desc: '+18% weapon damage' },
  firerate: { id: 'firerate', name: 'ADRENALINE', desc: '+14% fire rate' },
  speed: { id: 'speed', name: 'LIGHT FEET', desc: '+8% move speed' },
  vigor: { id: 'vigor', name: 'VIGOR', desc: '+25 max HP (and heal it)' },
  regen: { id: 'regen', name: 'REGEN', desc: '+1.5 HP / sec' },
  lifesteal: { id: 'lifesteal', name: 'LEECH', desc: 'heal 5% of damage dealt' },
  thorns: { id: 'thorns', name: 'THORNS', desc: 'attackers take 9 dmg/hit' },
  greed: { id: 'greed', name: 'GREED', desc: '+40% cash from kills' },
};

const ORDER: PerkId[] = ['damage', 'firerate', 'speed', 'vigor', 'regen', 'lifesteal', 'thorns', 'greed'];

const level = (s: GameState, id: PerkId): number => s.perks[id] ?? 0;

// ── derived multipliers the sim consumes ─────────────────────────────────────
export const damageMult = (s: GameState): number => 1 + 0.18 * level(s, 'damage');
export const fireRateMult = (s: GameState): number => 1 + 0.14 * level(s, 'firerate');
export const speedMult = (s: GameState): number => 1 + 0.08 * level(s, 'speed');
export const bonusMaxHp = (s: GameState): number => 25 * level(s, 'vigor');
export const regenPerSec = (s: GameState): number => 1.5 * level(s, 'regen');
export const lifestealFrac = (s: GameState): number => 0.05 * level(s, 'lifesteal');
export const thornsDamage = (s: GameState): number => 9 * level(s, 'thorns');
export const greedMult = (s: GameState): number => 1 + 0.4 * level(s, 'greed');

/** The player's effective max HP with the vigor perk folded in. */
export const effectiveMaxHp = (s: GameState): number => PLAYER_MAX_HP + bonusMaxHp(s);

/** Perks that still have stacks left to gain. */
function available(s: GameState): PerkId[] {
  return ORDER.filter((id) => level(s, id) < PERK_MAX_LEVEL);
}

/** Roll a fresh draft of distinct, not-yet-maxed perks (deterministic under a seeded rng). */
export function rollDraft(s: GameState, rng: Rng): PerkId[] {
  const pool = available(s);
  const picks: PerkId[] = [];
  while (picks.length < PERK_CHOICES && pool.length > 0) {
    const i = Math.floor(rng() * pool.length) % pool.length;
    picks.push(pool.splice(i, 1)[0]);
  }
  return picks;
}

/** Apply the chosen draft option to the whole squad, then clear the draft. */
export function choosePerk(s: GameState, choice: number): void {
  if (!s.perkDraft) return;
  const id = s.perkDraft[choice] as PerkId | undefined;
  if (!id) return;
  const before = level(s, id);
  s.perks[id] = Math.min(PERK_MAX_LEVEL, before + 1);
  // vigor also grants its HP immediately to every standing player
  if (id === 'vigor') {
    const gained = 25 * (s.perks[id] - before);
    for (const p of s.players) if (p.alive && !p.downed) p.hp += gained;
  }
  s.perkDraft = null;
}

/** Heal the crediting player (bullet owner / melee wielder) via the leech perk. */
export function applyLifesteal(s: GameState, owner: PlayerState | undefined, damage: number): void {
  const frac = lifestealFrac(s);
  if (frac <= 0 || !owner || !owner.alive || owner.downed) return;
  owner.hp = Math.min(effectiveMaxHp(s), owner.hp + damage * frac);
}
