import { LOOT_DROP_CHANCE, LOOT_RADIUS, LOOT_TTL, PLAYER_RADIUS } from '../config';
import { effectiveMaxHp } from './perks';
import { WEAPONS } from './weapons';
import type { GameState, LootState, PlayerState, Vec2 } from './types';

interface LootTemplate {
  kind: 'ammo' | 'health';
  amount: number; // health: HP restored; ammo: unused (generic resupply)
}

/**
 * What killed zombies drop — ammo boxes and health packs ONLY (no weapons; those
 * come from the shop / wall-buys / Mystery Box). Weighted toward ammo.
 */
const LOOT_TABLE: LootTemplate[] = [
  { kind: 'ammo', amount: 0 },
  { kind: 'ammo', amount: 0 },
  { kind: 'ammo', amount: 0 },
  { kind: 'health', amount: 30 },
  { kind: 'health', amount: 55 },
];

/** Maybe drop a loot item at a killed enemy's position. Consumes two rng draws. */
export function dropLoot(state: GameState, pos: Vec2, rng: () => number): void {
  if (rng() >= LOOT_DROP_CHANCE) return;
  const t = LOOT_TABLE[Math.floor(rng() * LOOT_TABLE.length) % LOOT_TABLE.length];
  state.loot.push({
    id: state.nextLootId++,
    pos: { x: pos.x, y: pos.y },
    kind: t.kind,
    amount: t.amount,
    ttl: LOOT_TTL,
  });
}

/** An ammo box tops up every limited weapon the picker owns (never wasted, never reduced). */
function resupply(p: PlayerState): void {
  for (const id of p.owned) {
    const def = WEAPONS[id];
    if (def.startAmmo === undefined) continue;
    const current = p.ammo[id] ?? 0;
    p.ammo[id] = Math.max(current, Math.min(def.startAmmo * 2, current + Math.round(def.startAmmo * 0.5)));
  }
}

function applyPickup(state: GameState, p: PlayerState, l: LootState): void {
  if (l.kind === 'health') {
    p.hp = Math.min(effectiveMaxHp(state), p.hp + l.amount);
  } else {
    resupply(p);
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
      applyPickup(state, taker, l);
      continue; // consumed
    }
    kept.push(l);
  }
  state.loot = kept;
}
