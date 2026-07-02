# Slice 2 Spec — zombies-waves

**GitHub issue:** #3
**Status:** In progress
**Depends on:** Slice 1 (core-feel)

## Problem Statement

Slice 1 gives us a player who moves, dashes and shoots in an empty room.
Slice 2 makes it a game: enemies that hunt the player, a combat loop where
bullets kill and contact hurts, and a wave director that keeps escalating
pressure. Still one handcrafted test room, still single-player-testable
(co-op comes in slice 4), still pure sim — no Phaser in `src/sim`.

## Scope

- **Enemy types** (data-driven `ZOMBIES` table, like `WEAPONS`): `shambler`
  (slow, tanky), `runner` (fast, fragile), `brute` (very tanky, hits hard).
  New enemy = new row.
- **Enemy AI:** seek the nearest player; boids-style separation so they don't
  stack into one dot; per-axis AABB wall collision (reuse the movement model).
  No A* pathfinding in v1 — seek + wall-slide is enough for open-ish rooms;
  real navmesh is deferred to the map slice if needed.
- **Combat:**
  - Bullets damage enemies on overlap; enemy dies at hp ≤ 0; bullet is consumed.
  - Enemies deal **contact damage as DPS** while overlapping the player.
  - Dash i-frames (slice 1) make the player immune to contact damage.
  - Player death at hp ≤ 0 sets `gameState.gameOver`.
- **Wave director:** each wave has a point **budget** (`base + growth·index`)
  spent on random enemy rows to build a spawn queue. Enemies spawn from
  map-defined **spawn zones** at a fixed interval, never on top of the player.
  Wave ends when the queue is empty and all enemies are dead → short
  **intermission** → next wave (bigger budget).

## Non-Goals (this slice)

- No loot/economy (slice 5), no bosses (slice 6), no doors/vision (slice 3).
- No netcode. No sound. No A* pathfinding.
- No player respawn UI beyond a game-over flag (polish slice).

## Success Criteria

- Enemies spawn in escalating waves, hunt the player, and can be killed.
- Player takes damage on contact, is immune while dashing, and dies at 0 hp.
- All sim logic unit-tested; `src/sim` stays Phaser-free (grep gate).
- Game boots and renders enemies + a wave/HP HUD (headless boot smoke test).

## Data (initial tuning — lives in config.ts / ZOMBIES table)

| type | hp | speed px/s | radius | contact dps | budget cost |
|------|----|-----------|--------|-------------|-------------|
| shambler | 60 | 55 | 13 | 18 | 1 |
| runner | 30 | 130 | 10 | 12 | 2 |
| brute | 220 | 42 | 20 | 35 | 5 |

Wave budget: `4 + 3·(index-1)`. Intermission 6 s. Spawn interval 0.45 s.
Brutes only appear from wave 3+.
