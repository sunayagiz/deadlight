# Deadlight — Design Spec

**GitHub issue:** #1 (slices: #2–#8)
**Status:** Approved (2026-07-02)
**Authors:** Sunay + Claude
**Date:** 2026-07-02

## 1. Problem Statement

We want a browser-based, top-down co-op zombie survival game with a dark, oppressive
atmosphere and Hades-like moment-to-moment combat feel: fast, readable, responsive,
fought in tight indoor spaces. Up to four players fight
escalating waves of zombies and mini-bosses inside a building-scale map made of rooms
and corridors, collecting loot and switching between a varied arsenal of ranged and
melee weapons. Co-op supports up to 4 players over the internet (P2P).

No existing browser game gives us this combination (co-op + Hades feel + dark
indoor vibe), and we want a project the two of us can build and iterate on together.

## 2. Design Pillars

1. **Combat feel first** — snappy movement, instant weapon response, dash/dodge,
   hit-stop, screen shake, knockback. If combat doesn't feel good, nothing else matters.
2. **Dark and claustrophobic** — limited vision, dynamic lighting, closed doors that
   hide what's behind them until opened. Tension comes from not seeing.
3. **Tight spaces** — rooms and corridors, not open fields. Positioning and
   chokepoints matter.
4. **Co-op is core** — designed for 2–4 players from day one, playable solo.

## 3. Chosen Architecture

### Stack
- **Engine:** Phaser 3 (Arcade Physics) + TypeScript + Vite
- **Scaffold:** official Phaser + Vite + TS template as starting point
- **Maps:** Tiled editor → JSON tilemaps loaded by Phaser
- **Netcode:** WebRTC P2P, **host-authoritative** model
- **Signaling:** PeerJS (free cloud signaling) as first choice; evaluate Trystero
  (serverless signaling) during the netcode slice
- **Deploy:** static hosting (Cloudflare Pages) — no game server needed

### Netcode model (host-authoritative P2P)
- One player is the **host**: runs the full simulation (zombies, waves, loot, physics).
- **Guests** (up to 3) send inputs (movement vector, aim angle, fire/dash/interact)
  to the host and render state snapshots received from the host. Star topology:
  every guest connects to the host, guests don't talk to each other.
- Guests use client-side prediction for their own movement + interpolation for
  everything else, so it feels responsive despite latency.
- No anti-cheat — it's co-op with a friend; trust the host.

### Architecture rule that makes co-op possible
Simulation is **decoupled from rendering and input** from the very first slice:
- All game logic reads from an input abstraction (`PlayerInput` struct), never
  directly from keyboard/mouse events.
- Game state is a serializable plain-data structure; Phaser sprites are views of it.
- Fixed-timestep simulation update, render interpolates.

This is the single most important constraint: retrofitting netcode onto
Phaser-sprite-coupled logic is a rewrite. Every slice must respect it.

## 4. Gameplay Systems

### 4.1 Player
- Top-down, WASD movement, mouse aim (character faces cursor), left-click fire/swing.
- **Dash** (Hades-style): short i-frame burst on Space/Shift, with cooldown.
- Health + optional armor pickup. Downed state in co-op: teammate can revive within
  a timer; solo = death, wave restart (exact death rules tuned later).
- Two weapon slots (1 ranged + 1 melee) + special weapon slot (minigun/RPG when found).

### 4.2 Weapons (data-driven)
All weapons are rows in a data table (damage, fire rate, spread, pellets, range,
ammo type, reload time, knockback, pierce) — adding a weapon = adding data + sprite.

| Weapon      | Type    | Role |
|-------------|---------|------|
| Pistol      | ranged  | starter, infinite ammo, reliable |
| Shotgun     | ranged  | close-range burst, big knockback |
| SMG / AR    | ranged  | sustained mid-range fire |
| Minigun     | special | limited ammo, spin-up, shreds hordes |
| RPG         | special | AoE, rare ammo, self-damage risk |
| Baseball bat| melee   | fast swing, knockback, stagger |
| Katana      | melee   | wide arc, fast combo, pierce multiple |
| Chainsaw    | melee   | held = continuous damage, loud (attracts zombies), fuel-limited |

Melee swings are arc hitboxes in front of the player; chainsaw is a sustained
frontal hitbox while held.

### 4.3 Zombies & Bosses
- Base zombie types (v1): **Walker** (slow, numerous), **Runner** (fast, fragile),
  **Brute** (tanky, heavy hit, slow).
- **Mini-bosses** every N waves: larger, named, with 1–2 telegraphed special attacks
  (charge, ground slam, spawn adds). One mini-boss archetype per slice, reusable
  pattern system.
- AI: chase player via pathfinding on the tile grid (A* or flow field — decided in
  the zombies slice); zombies attack doors to break through.

### 4.4 Waves
- Wave director: each wave has a budget (points) spent on zombie types; budget and
  composition escalate. Budget scales with connected player count.
  Short buy/loot phase between waves.
- Spawns come from map-defined spawn zones (broken windows, dark corridors, sewer
  grates) — never inside the players' current cleared room.

### 4.5 Loot
- Drops from zombies + found in rooms (lockers, crates behind closed doors).
- Loot types: ammo, health, armor, weapons (rarity tiers), special weapon pickups
  (minigun/RPG), temporary buffs (v1.5+).
- Risk/reward: best loot is in rooms you must open — and you don't know what's
  behind the door.

### 4.6 Map, Rooms, Doors, Vision
- One building-scale handcrafted map (Tiled) for v1: rooms, corridors, a few
  larger halls for boss fights.
- **Doors:** closed by default, opened by interaction (E). Zombies can break doors.
- **Vision:** you cannot see through walls or closed doors. Implemented as
  raycast-based vision polygon (fog outside line of sight) + Phaser Light2D for
  the dark vibe (player flashlight cone, flickering room lights, muzzle flashes
  lighting the room).

### 4.7 Dark vibe (presentation)
- Near-black ambient, light sources as gameplay (flashlight cone, muzzle flash).
- Audio: distant groans, door creaks, heartbeat at low HP. Chainsaw/minigun loud.
- Blood decals persist during a wave. Minimal UI, diegetic where cheap to do.

## 5. Non-Goals (v1)

- No PvP, no more than 4 players, no anti-cheat.
- No mobile/touch support.
- No meta-progression / persistence between sessions (run-based only).
- No procedural map generation (one handcrafted map).
- No dedicated server; P2P only.
- No account system; join via shared room code/link.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WebRTC NAT failures (some networks can't connect P2P) | PeerJS supports TURN config; document known limitation; free TURN via Cloudflare Calls if needed |
| Host upload bandwidth/CPU with 3 guests (snapshots × 3) | Tune snapshot rate (10–20 Hz + interpolation); delta-compressed snapshots if needed; host = best-connection player |
| Netcode retrofit pain | Architecture rule in §3 enforced from slice 1; co-op slice scheduled early (not last) |
| Perf with 100+ zombies + lights in browser | Object pooling, spatial hash for collisions, cap concurrent zombies, cheap lights |
| Vision/fog + lighting complexity | Prototype in its own slice; fallback = simple radial darkness without raycast polygon |
| Scope creep (weapon/boss lists grow) | Data-driven weapons; slice plan below is the contract; new ideas go to backlog issue |
| Two-person team divergence | Short-lived branches, slice-per-branch, both review |

## 7. Slice Plan (each slice = own spec, plan, branch, GitHub issue)

1. **core-feel** — scaffold, fixed-timestep sim/render split, WASD + mouse aim,
   dash, pistol shooting, one test room. *Goal: movement+shooting feels great.*
2. **zombies-waves** — walker/runner/brute, pathfinding, wave director, deaths,
   player damage.
3. **map-vision** — Tiled map, rooms, doors (open/break), raycast vision + lighting.
4. **coop-netcode** — PeerJS room join, host-authoritative sync, prediction +
   interpolation, revive.
5. **arsenal-loot** — full weapon table, melee combat, ammo economy, loot drops
   and room loot.
6. **bosses** — mini-boss pattern system + first two mini-bosses.
7. **vibe-polish** — audio, decals, UI, game over / lobby flow, balance pass.

Order rationale: netcode at slice 4 (not 7) so slices 5–6 are built and tested
in co-op from the start.

## 8. Open Questions

- Working title "Deadlight" — keep or rename?
- Art source: free asset packs (e.g. Kenney, itch.io CC0 top-down packs) vs
  custom pixel art? (Affects vibe heavily; suggest packs first, restyle later.)
- Friend's role split — who owns which slices?
