import { BANISH_COST, PERK_CHOICES, PERK_MAX_LEVEL, PLAYER_MAX_HP, REROLL_BASE, REROLL_STEP } from '../config';
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

/** Perks that still have stacks left to gain AND are not banished from the run. */
function available(s: GameState): PerkId[] {
  const banned = new Set(s.banished);
  return ORDER.filter((id) => level(s, id) < PERK_MAX_LEVEL && !banned.has(id));
}

/** Roll a fresh draft of distinct, not-yet-maxed, non-banished perks (deterministic under a seeded rng). */
export function rollDraft(s: GameState, rng: Rng): PerkId[] {
  const pool = available(s);
  const picks: PerkId[] = [];
  while (picks.length < PERK_CHOICES && pool.length > 0) {
    const i = Math.floor(rng() * pool.length) % pool.length;
    picks.push(pool.splice(i, 1)[0]);
  }
  return picks;
}

/** Cash cost of the NEXT reroll for the current draft (rises with each reroll spent). */
export function rerollCost(s: GameState): number {
  return REROLL_BASE + REROLL_STEP * s.rerollCount;
}

/**
 * Host-authoritative reroll: spend the rising cost and roll a fresh set of draft
 * options with the threaded rng. No-op (returns false) if no draft is pending or
 * the squad can't afford it, so guests and the host stay in lockstep.
 */
export function rerollDraft(s: GameState, rng: Rng): boolean {
  if (!s.perkDraft) return false;
  const cost = rerollCost(s);
  if (s.cash < cost) return false;
  s.cash -= cost;
  s.rerollCount += 1;
  s.perkDraft = rollDraft(s, rng);
  return true;
}

/**
 * Host-authoritative banish: pay BANISH_COST to remove draft option `choice` from
 * the run's pool for good, then refill that slot with a fresh option so the draft
 * still shows PERK_CHOICES cards. No-op (false) if no draft / bad index / broke.
 */
export function banishPerk(s: GameState, choice: number, rng: Rng): boolean {
  if (!s.perkDraft) return false;
  const id = s.perkDraft[choice] as PerkId | undefined;
  if (!id) return false;
  if (s.cash < BANISH_COST) return false;
  s.cash -= BANISH_COST;
  if (!s.banished.includes(id)) s.banished.push(id);
  // refill just this slot: a fresh perk not already offered, not banished, not maxed
  const inDraft = new Set(s.perkDraft.filter((_, i) => i !== choice));
  const replacement = available(s).filter((p) => !inDraft.has(p));
  const next = s.perkDraft.slice();
  if (replacement.length > 0) {
    const i = Math.floor(rng() * replacement.length) % replacement.length;
    next[choice] = replacement[i];
  } else {
    next.splice(choice, 1); // pool exhausted — drop the slot rather than repeat
  }
  s.perkDraft = next;
  return true;
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
  s.rerollCount = 0; // reroll cost resets for the next draft
}

/** Heal the crediting player (bullet owner / melee wielder) via the leech perk. */
export function applyLifesteal(s: GameState, owner: PlayerState | undefined, damage: number): void {
  const frac = lifestealFrac(s);
  if (frac <= 0 || !owner || !owner.alive || owner.downed) return;
  owner.hp = Math.min(effectiveMaxHp(s), owner.hp + damage * frac);
}
