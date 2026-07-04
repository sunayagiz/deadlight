import { AFFIX_CHANCE_BASE, AFFIX_CHANCE_MAX, AFFIX_CHANCE_PER_WAVE, AFFIX_MIN_WAVE } from '../config';
import type { AffixId, EnemyState } from './types';

/**
 * An elite modifier: multiplies base stats and optionally adds an on-death effect.
 * Data-driven like the enemy table — a new elite is a new row here, not a new class.
 */
export interface AffixDef {
  id: AffixId;
  name: string;
  tint: number; // 0xRRGGBB elite glow (sprite tint + aura ring)
  hpMult: number; // scales spawn HP
  speedMult?: number; // scales move speed (absent = ×1)
  bulletResist?: number; // 0..1 extra fraction of NON-melee damage ignored (stacks with armor)
  onDeath?: 'blast'; // 'blast' = detonate on death like a boomer (reuses BOOMER_BLAST_*)
  regenPerSec?: number; // host-side HP regen per second, capped at spawn HP
}

/** The affix table. Values tuned so each reads as a distinct threat at a glance. */
export const AFFIXES: Record<AffixId, AffixDef> = {
  swift: { id: 'swift', name: 'Swift', tint: 0xffe23a, hpMult: 1.3, speedMult: 1.45 },
  tank: { id: 'tank', name: 'Tank', tint: 0x6fa8ff, hpMult: 2.2, speedMult: 0.9 },
  shielded: { id: 'shielded', name: 'Shielded', tint: 0x9f7aff, hpMult: 1.4, bulletResist: 0.6 },
  volatile: { id: 'volatile', name: 'Volatile', tint: 0xff7a3a, hpMult: 1.4, onDeath: 'blast' },
  vampiric: { id: 'vampiric', name: 'Vampiric', tint: 0x8affa0, hpMult: 1.8, regenPerSec: 6 },
};

const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];

/**
 * Roll an affix for an enemy spawning on the given wave. Returns undefined for a
 * normal enemy. Deterministic: uses only the passed rng, and consumes NO rng
 * values below AFFIX_MIN_WAVE (keeps early-wave spawn sequences unchanged).
 */
export function rollAffix(wave: number, rng: () => number): AffixId | undefined {
  if (wave < AFFIX_MIN_WAVE) return undefined;
  const chance = Math.min(
    AFFIX_CHANCE_MAX,
    AFFIX_CHANCE_BASE + AFFIX_CHANCE_PER_WAVE * (wave - AFFIX_MIN_WAVE),
  );
  if (rng() >= chance) return undefined;
  return AFFIX_IDS[Math.floor(rng() * AFFIX_IDS.length)] ?? AFFIX_IDS[AFFIX_IDS.length - 1];
}

/** The affix definition for an enemy, or undefined if it has none. */
export function affixDef(e: EnemyState): AffixDef | undefined {
  return e.affix ? AFFIXES[e.affix] : undefined;
}

export function affixHpMult(e: EnemyState): number {
  return affixDef(e)?.hpMult ?? 1;
}

export function affixSpeedMult(e: EnemyState): number {
  return affixDef(e)?.speedMult ?? 1;
}

/** Extra bullet-resist fraction (0..1) from the affix, stacking with type armor. */
export function affixBulletResist(e: EnemyState): number {
  return affixDef(e)?.bulletResist ?? 0;
}

export function affixRegenPerSec(e: EnemyState): number {
  return affixDef(e)?.regenPerSec ?? 0;
}

/** Does this enemy detonate on death (volatile)? */
export function affixExplodesOnDeath(e: EnemyState): boolean {
  return affixDef(e)?.onDeath === 'blast';
}
