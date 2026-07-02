# Slice 3 Spec — map-vision (issue #4)

**GitHub issue:** #4
**Status:** In progress
**Depends on:** Slice 1 (core-feel), Slice 2 (zombies-waves)

## Problem Statement

The brief's core mood: tight indoor spaces, closed doors that hide what's behind
them, and darkness you cut with a flashlight — "kapı açılana kadar arkası
görünmesin". This slice turns the flat test room into a small building and adds
the vision system that makes not-seeing the source of tension.

## Scope

- **Building map** (handcrafted, data): a left hall and two right rooms, walls +
  corridors + a cover pillar, with **doors** that start closed.
- **Doors**: a closed door is solid (blocks movement, bullets, sight); it swings
  **open on proximity** and stays open. (Auto-open chosen over an interact key to
  keep the fast Hades-like flow; revisit if a deliberate open feels better.)
- **Line of sight**: Liang–Barsky `segmentClear` against walls + closed doors, so
  the renderer hides enemies/loot the player can't actually see.
- **Vision rendering**: a darkness overlay revealed only inside a **flashlight
  cone** (aim-directed) plus a small **ambient glow** around the player, via an
  inverted geometry mask. Enemies/loot behind walls are culled even inside the
  cone.

## Non-Goals (this slice)

- No Tiled import yet (map is code data; Tiled is a later refinement).
- No dynamic lights beyond the flashlight/ambient (muzzle/explosion lighting is
  polish). No smell/hearing/AI reaction to light.
- No camera follow — the map fits the 960×540 view; darkness does the hiding.

## Success Criteria

- Closed doors block movement/bullets/sight; open on approach; reveal the room.
- The player only sees a flashlight cone + ambient bubble; the rest is dark.
- Enemies/loot behind walls or closed doors are not visible.
- Sim stays Phaser-free; LOS + doors + solids are unit-tested; game boots
  (headless smoke test).

## Needs a human

The *feel* of the darkness — cone width/range, ambient size, darkness opacity,
door open radius (all in `config.ts`) — wants real eyes in a playtest.
