# Slice 1 Spec — core-feel

**GitHub issue:** #2
**Parent spec:** `docs/design-spec.md` (§7 slice 1)
**Status:** Draft — awaiting approval

## Problem Statement

Nothing exists yet. We need the project scaffold and the core moment-to-moment
loop — move, aim, dash, shoot — feeling great in a single test room. Every later
slice builds on this foundation, and the netcode-critical architecture rule
(simulation decoupled from rendering/input) must be locked in here or it never
happens.

## Chosen Architecture

- **Scaffold:** Vite + TypeScript + Phaser 3, vitest for tests. No Phaser physics —
  the simulation is our own pure-TS code (`src/sim/`), Phaser only renders.
- **Sim/render split:** `src/sim/` has zero Phaser imports; state is plain
  serializable data (`GameState`). `src/game/` holds the Phaser scene, an input
  collector that produces a `PlayerInput` struct, and a fixed-timestep loop
  (60 Hz sim, render interpolates with an alpha factor).
- **Player:** WASD movement (normalized, 220 px/s), mouse aim (gun rotates to
  cursor), dash on Space (0.15 s burst at 640 px/s, i-frames while dashing,
  0.8 s cooldown), pistol on left mouse (4 shots/s, bullets die on walls/TTL).
- **Weapons are data-driven from day one:** a `WEAPONS` table with a single
  pistol row.
- **Test room:** hardcoded AABB wall list (bounds + two obstacles), rendered as
  flat dark rectangles. Feel constants live in `src/config.ts` for fast tuning.

## Non-Goals

- No zombies, damage, health, or waves (slice 2).
- No Tiled maps, doors, vision, or lighting (slice 3). Dark palette only.
- No netcode (slice 4) — but all state must remain serializable plain data.
- No sound, no art assets (flat shapes only), no camera follow (room = viewport).
- No weapons beyond the pistol (slice 5).

## Risks

- **Feel is subjective** — mitigate: all tuning constants in one config file;
  manual playtest checklist is part of the definition of done.
- **Sim/render split gets violated under time pressure** — mitigate: test files
  import `src/sim/` only; rule stated in CLAUDE.md; reviewer checks imports.
- **Fixed-timestep bugs (spiral of death, jitter)** — mitigate: accumulator is
  clamped and unit-tested; interpolation alpha tested.
