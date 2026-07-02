# Deadlight — Project Instructions

Browser-based top-down co-op zombie survival game. Read `docs/design-spec.md`
before working on anything — it is the contract for scope and architecture.

## Stack
- Phaser 3 (Arcade Physics) + TypeScript + Vite
- Maps: Tiled → JSON tilemaps
- Netcode: WebRTC P2P via PeerJS, host-authoritative, star topology, up to 4 players
- Deploy: static hosting (Cloudflare Pages)

## Architecture rules (non-negotiable)
- **Simulation is decoupled from rendering and input.** Game logic reads a
  `PlayerInput` struct, never keyboard/mouse events directly. Game state is
  serializable plain data; Phaser sprites are views of it. Fixed-timestep
  simulation; render interpolates. This exists so co-op netcode works — do not
  couple logic to Phaser objects.
- **Weapons are data-driven.** New weapon = new row in the weapon data table +
  assets. No per-weapon class hierarchies.

## Workflow
- Work happens in slices (see spec §7). Each slice: own spec, plan, branch
  (`<type>/<slice-name>`), and GitHub issue.
- CLAUDE.md and docs/ are committed to this repo (decision: 2026-07-02).
- Commits: `type(scope): subject`, footer `refs #<issue>` (final commit of a
  branch: `closes #<issue>`).

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest
(Available after the `core-feel` slice scaffold lands.)
