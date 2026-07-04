import {
  BANISH_COST,
  LEVELS_FOR,
  PERK_CHOICES,
  PERK_MAX_LEVEL,
  PLAYER_MAX_HP,
  RARITY_SHIFT_MAX,
  RARITY_SHIFT_PER_WAVE,
  RARITY_WEIGHTS,
  REROLL_BASE,
  REROLL_STEP,
} from '../config';
import type { DraftOption, GameState, PlayerState, Rarity } from './types';
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

/**
 * How a perk's stacks turn into its derived value (B6, data-driven):
 *  - `linear`     → value = coeff × level. Unbounded on purpose; only used by
 *    ADDITIVE/BOUNDED perks (damage, fire rate, speed, vigor HP, regen) where
 *    every stack pulling its full weight is the whole point.
 *  - `hyperbolic` → value = cap × (1 − 1/(1 + coeff × level)). Monotonic, 0 at
 *    level 0, and it APPROACHES `cap` without ever reaching it. Used by the
 *    percentage/chance perks (lifesteal, thorns, greed) so high stacks diminish
 *    toward a ceiling instead of running away and trivialising the game.
 */
export type StackMode = 'linear' | 'hyperbolic';

export interface PerkDef {
  id: PerkId;
  name: string;
  desc: string; // effect blurb, shown in the draft
  stack: StackMode;
  coeff: number; // linear: per-level slope; hyperbolic: the `a` shaping the curve's early feel
  cap?: number; // hyperbolic only: the asymptote the value approaches but never reaches
}

/**
 * Squad-shared, stackable roguelite perks. Every knob is data; the sim reads the
 * derived multipliers below via `stacked()`, which honours each perk's `stack`
 * rule. A draft offers PERK_CHOICES of these each interval, each with a rarity.
 */
export const PERKS: Record<PerkId, PerkDef> = {
  // ── additive / bounded → linear (a stack always pulls its full weight) ──
  damage: { id: 'damage', name: 'HOLLOW-POINTS', desc: '+18% weapon damage per stack', stack: 'linear', coeff: 0.18 },
  firerate: { id: 'firerate', name: 'ADRENALINE', desc: '+14% fire rate per stack', stack: 'linear', coeff: 0.14 },
  speed: { id: 'speed', name: 'LIGHT FEET', desc: '+8% move speed per stack', stack: 'linear', coeff: 0.08 },
  vigor: { id: 'vigor', name: 'VIGOR', desc: '+25 max HP per stack (and heal it)', stack: 'linear', coeff: 25 },
  regen: { id: 'regen', name: 'REGEN', desc: '+1.5 HP / sec per stack', stack: 'linear', coeff: 1.5 },
  // ── percentage / chance → hyperbolic (diminishes toward a cap; no runaway) ──
  lifesteal: { id: 'lifesteal', name: 'LEECH', desc: 'heal a share of damage dealt (→ 35%)', stack: 'hyperbolic', coeff: 0.25, cap: 0.35 },
  thorns: { id: 'thorns', name: 'THORNS', desc: 'attackers take recoil damage (→ 60/hit)', stack: 'hyperbolic', coeff: 0.3, cap: 60 },
  greed: { id: 'greed', name: 'GREED', desc: 'more cash from kills (→ +150%)', stack: 'hyperbolic', coeff: 0.5, cap: 1.5 },
};

const ORDER: PerkId[] = ['damage', 'firerate', 'speed', 'vigor', 'regen', 'lifesteal', 'thorns', 'greed'];

const level = (s: GameState, id: PerkId): number => s.perks[id] ?? 0;

/**
 * Data-driven stacking: turn a perk's stack count into its raw derived value per
 * the perk's `stack` rule. Linear is unbounded coeff×level; hyperbolic approaches
 * (but never hits) `cap`, is 0 at level 0, and rises monotonically with level.
 */
export function stacked(def: PerkDef, lvl: number): number {
  if (lvl <= 0) return 0;
  if (def.stack === 'hyperbolic') return (def.cap ?? 1) * (1 - 1 / (1 + def.coeff * lvl));
  return def.coeff * lvl;
}

const stackFor = (s: GameState, id: PerkId): number => stacked(PERKS[id], level(s, id));

// ── derived multipliers the sim consumes (all read the data-driven curve) ────
export const damageMult = (s: GameState): number => 1 + stackFor(s, 'damage');
export const fireRateMult = (s: GameState): number => 1 + stackFor(s, 'firerate');
export const speedMult = (s: GameState): number => 1 + stackFor(s, 'speed');
export const bonusMaxHp = (s: GameState): number => stackFor(s, 'vigor');
export const regenPerSec = (s: GameState): number => stackFor(s, 'regen');
export const lifestealFrac = (s: GameState): number => stackFor(s, 'lifesteal');
export const thornsDamage = (s: GameState): number => stackFor(s, 'thorns');
export const greedMult = (s: GameState): number => 1 + stackFor(s, 'greed');

/** The player's effective max HP with the vigor perk folded in. */
export const effectiveMaxHp = (s: GameState): number => PLAYER_MAX_HP + bonusMaxHp(s);

/** Perks that still have stacks left to gain AND are not banished from the run. */
function available(s: GameState): PerkId[] {
  const banned = new Set(s.banished);
  return ORDER.filter((id) => level(s, id) < PERK_MAX_LEVEL && !banned.has(id));
}

/**
 * Roll a draft option's rarity via the threaded rng (deterministic; one rng draw).
 * Weighted heavily toward common, drifting slightly toward the shinier tiers as
 * the wave index climbs so late runs still dangle the occasional legendary.
 */
export function rollRarity(rng: Rng, waveIndex: number): Rarity {
  const shift = Math.min(RARITY_SHIFT_MAX, RARITY_SHIFT_PER_WAVE * Math.max(0, waveIndex - 1));
  const common = Math.max(0, RARITY_WEIGHTS.common - shift);
  const rare = RARITY_WEIGHTS.rare + shift * 0.7;
  const legendary = RARITY_WEIGHTS.legendary + shift * 0.3;
  const total = common + rare + legendary;
  const r = rng() * total;
  if (r < common) return 'common';
  if (r < common + rare) return 'rare';
  return 'legendary';
}

/** Roll a fresh draft of distinct, not-yet-maxed, non-banished perks — each with a rolled rarity (deterministic under a seeded rng). */
export function rollDraft(s: GameState, rng: Rng): DraftOption[] {
  const pool = available(s);
  const picks: DraftOption[] = [];
  while (picks.length < PERK_CHOICES && pool.length > 0) {
    const i = Math.floor(rng() * pool.length) % pool.length;
    const id = pool.splice(i, 1)[0];
    const rarity = rollRarity(rng, s.wave.index);
    picks.push({ id, rarity });
  }
  return picks;
}

/** Cash cost of the NEXT reroll for the current draft (rises with each reroll spent). */
export function rerollCost(s: GameState): number {
  return REROLL_BASE + REROLL_STEP * s.rerollCount;
}

/**
 * Host-authoritative reroll: spend the rising cost and roll a fresh set of draft
 * options (ids AND rarities) with the threaded rng. No-op (returns false) if no
 * draft is pending or the squad can't afford it, so guests and the host stay in
 * lockstep.
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
 * the run's pool for good, then refill that slot with a fresh option (with its own
 * rolled rarity) so the draft still shows PERK_CHOICES cards. No-op (false) if no
 * draft / bad index / broke.
 */
export function banishPerk(s: GameState, choice: number, rng: Rng): boolean {
  if (!s.perkDraft) return false;
  const opt = s.perkDraft[choice] as DraftOption | undefined;
  if (!opt) return false;
  if (s.cash < BANISH_COST) return false;
  s.cash -= BANISH_COST;
  if (!s.banished.includes(opt.id)) s.banished.push(opt.id);
  // refill just this slot: a fresh perk not already offered, not banished, not maxed
  const inDraft = new Set(s.perkDraft.filter((_, i) => i !== choice).map((o) => o.id));
  const replacement = available(s).filter((p) => !inDraft.has(p));
  const next = s.perkDraft.slice();
  if (replacement.length > 0) {
    const i = Math.floor(rng() * replacement.length) % replacement.length;
    const id = replacement[i];
    next[choice] = { id, rarity: rollRarity(rng, s.wave.index) };
  } else {
    next.splice(choice, 1); // pool exhausted — drop the slot rather than repeat
  }
  s.perkDraft = next;
  return true;
}

/**
 * Apply the chosen draft option to the whole squad, then clear the draft. The
 * rarity decides how many levels the pick grants (LEVELS_FOR), clamped at the cap.
 */
export function choosePerk(s: GameState, choice: number): void {
  if (!s.perkDraft) return;
  const opt = s.perkDraft[choice] as DraftOption | undefined;
  if (!opt) return;
  const id = opt.id as PerkId;
  const before = level(s, id);
  const grant = LEVELS_FOR[opt.rarity];
  s.perks[id] = Math.min(PERK_MAX_LEVEL, before + grant);
  // vigor also grants its HP immediately to every standing player
  if (id === 'vigor') {
    const gained = PERKS.vigor.coeff * (s.perks[id] - before);
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
