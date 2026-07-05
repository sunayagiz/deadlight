# Deadlight

A browser-based, top-down co-op zombie survival game emphasizing claustrophobic tension and highly responsive combat.

## Overview
Deadlight brings Hades-like combat mechanics into a dark, indoor zombie survival setting. Built for 2–4 players, it uses a host-authoritative P2P netcode model running entirely in the browser without dedicated servers.

## Features
* **Combat-First Mechanics:** Snappy movement, directional dashes with i-frames, hit-stop, and immediate weapon feedback.
* **True Line of Sight:** Raycast-based vision polygons and dynamic lighting. Threats behind closed doors remain strictly hidden.
* **Host-Authoritative Co-op:** WebRTC (PeerJS) integration supporting up to 4 players. 
* **Data-Driven Arsenal:** Weapons, stats, and wave budgets are table-driven for rapid iteration.

## Architecture & Tech Stack
* **Engine:** Phaser 3 (Arcade Physics)
* **Language/Build:** TypeScript, Vite
* **Netcode:** PeerJS (WebRTC), deployed via Cloudflare Pages
* **Map Tooling:** Tiled Editor (JSON tilemaps)

**Core Architectural Rule:**  
To support seamless P2P multiplayer, the game state simulation is strictly decoupled from the Phaser rendering layer. All logic operates on a serializable `PlayerInput` struct with a fixed-timestep update, while Phaser sprites solely handle view interpolation.

## Repository Structure
* `docs/` – Design specifications and slice planning.
* `src/` – Core game logic, state management, netcode, and rendering.
* `public/` – Static game assets (sprites, tilemaps, audio).
* `tests/` – Vitest unit and simulation tests.
* `tools/` – Development utilities and map parsers.

## Getting Started

### Prerequisites
* Node.js (v20+)

### Development Setup
```bash
git clone https://github.com/sunayagiz/deadlight.git
cd deadlight
npm install
npm run dev
```
The local development server will start at `http://localhost:5173`.

## Roadmap
Development is tracked in discrete, functional slices as outlined in [docs/design-spec.md](docs/design-spec.md):
1. Core Combat Feel
2. Zombie AI & Wave Director
3. Map Systems & Vision
4. Co-op Netcode (PeerJS)
5. Arsenal & Loot Systems
6. Mini-bosses
7. Polish & Audio

## License
MIT License - See LICENSE for details.
