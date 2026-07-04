import { PING_ENEMY_RADIUS, PING_LOOT_RADIUS, PING_MAX_PER_PLAYER, PING_TTL } from '../config';
import type { GameState, PingKind, PlayerInput } from './types';

/**
 * Host-authoritative kind selection for a ping: an enemy near the point wins
 * ('enemy'), else nearby loot ('loot'), else a plain go-here marker ('go').
 * Pure + deterministic — no Math.random, so co-op stays in sync.
 */
function classifyPing(state: GameState, x: number, y: number): PingKind {
  const er2 = PING_ENEMY_RADIUS * PING_ENEMY_RADIUS;
  for (const e of state.enemies) {
    if ((e.pos.x - x) ** 2 + (e.pos.y - y) ** 2 <= er2) return 'enemy';
  }
  const lr2 = PING_LOOT_RADIUS * PING_LOOT_RADIUS;
  for (const l of state.loot) {
    if ((l.pos.x - x) ** 2 + (l.pos.y - y) ** 2 <= lr2) return 'loot';
  }
  return 'go';
}

/**
 * Age out existing pings and turn this tick's ping inputs into PingStates.
 * A ping is a player ACTION carried on PlayerInput, so guests ping too; the
 * resulting objects live on GameState and travel over the wire like everything
 * else. Per-player concurrency is capped so spam can't flood the map.
 */
export function updatePings(state: GameState, inputs: PlayerInput[], dt: number): void {
  // decrement ttls, drop the expired
  for (const p of state.pings) p.ttl -= dt;
  if (state.pings.some((p) => p.ttl <= 0)) state.pings = state.pings.filter((p) => p.ttl > 0);

  state.players.forEach((pl, i) => {
    if (!pl.alive) return; // fully-dead spectators can't ping
    const req = inputs[i]?.ping;
    if (!req) return;
    const kind = classifyPing(state, req.x, req.y);
    // per-player cap: if at the limit, retire this player's OLDEST ping first
    let count = 0;
    for (const p of state.pings) if (p.owner === i) count++;
    if (count >= PING_MAX_PER_PLAYER) {
      const idx = state.pings.findIndex((p) => p.owner === i);
      if (idx >= 0) state.pings.splice(idx, 1);
    }
    state.pings.push({ id: state.nextPingId++, x: req.x, y: req.y, kind, owner: i, ttl: PING_TTL });
  });
}
