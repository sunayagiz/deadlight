---
title: Slice 1 — core-feel
date: 2026-07-02
domain: creative
type: enhancement
priority: high
breaking: false
db-migration: false
rls-affecting: false
slice: 1
parent-spec: docs/specs/slice-1-core-feel.md
touched-files: [package.json, package-lock.json, tsconfig.json, index.html, src/**/*.ts, tests/**/*.ts]
trigger-tasks-touched: []
shared-modules-touched: []
---

# Slice 1: core-feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project scaffold plus the core loop — WASD movement, mouse aim, dash with i-frames, pistol shooting — feeling great in one test room.

**Architecture:** Pure-TS simulation in `src/sim/` (no Phaser imports, serializable state, 60 Hz fixed timestep) with Phaser 3 as a dumb renderer in `src/game/`. Input is sampled into a `PlayerInput` struct each frame; the sim only ever sees that struct. This split is the netcode contract from `docs/design-spec.md` §3 — do not violate it.

**Tech Stack:** Phaser 3, TypeScript (strict), Vite, vitest.

**GitHub issue:** #2 — all commits `refs #2`, final commit `closes #2`.

**Branch:** `feat/core-feel` (from `main`).

---

## File Structure

```
package.json            # scripts: dev, build, preview, typecheck, test
tsconfig.json           # strict TS, noEmit (Vite transpiles)
index.html              # Vite entry, #game container
src/
  main.ts               # Phaser.Game boot config
  config.ts             # ALL feel/tuning constants (speeds, cooldowns, sim rate)
  sim/                  # pure TS — NO Phaser imports anywhere in this dir
    types.ts            # Vec2, PlayerInput, PlayerState, BulletState, Wall, GameState, WeaponId
    vec.ts              # len, norm, lerp
    state.ts            # createGameState, createPlayer, emptyInput factories
    movement.ts         # updateDash, updateMovement, isInvulnerable, wall collision
    weapons.ts          # WeaponDef, WEAPONS table, updateAim, updateFiring, updateBullets
    step.ts             # stepSim — fixed order: dash → movement → aim → firing → bullets
    room.ts             # testRoomWalls() — hardcoded AABBs
  game/                 # Phaser-facing code
    loop.ts             # FixedLoop accumulator (pure, unit-tested)
    input.ts            # InputCollector: keyboard/mouse → PlayerInput
    GameScene.ts        # renders GameState, owns the frame loop
tests/sim/              # vitest — imports src/sim/ and src/game/loop.ts ONLY
  vec.test.ts
  loop.test.ts
  movement.test.ts
  dash.test.ts
  weapons.test.ts
```

Review rule: nothing under `src/sim/` or `tests/` may import `phaser`.

---

### Task 1: Scaffold (branch, deps, configs, boot)

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `src/main.ts`
- Commit also includes: `docs/specs/slice-1-core-feel.md`, this plan file

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/core-feel
```

- [ ] **Step 2: Init npm and install dependencies**

```bash
npm init -y
npm install phaser
npm install -D typescript vite vitest
```

- [ ] **Step 3: Set package.json scripts**

Edit `package.json` — replace the `scripts` block and add `"type": "module"` at top level:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

(Keep the dependency entries npm wrote; only scripts/type change.)

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Deadlight</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; display: grid; place-items: center; }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/main.ts (boot only — GameScene is added in Task 7)**

```ts
import Phaser from 'phaser';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#0a0a0f',
  scene: [],
});
```

- [ ] **Step 7: Verify dev server boots**

Run: `npm run dev` — open the printed URL (default `http://localhost:5173`).
Expected: empty near-black 960×540 canvas, no console errors. Stop the server.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit and push**

```bash
git add -A
git commit -m "chore(scaffold): phaser + vite + ts + vitest project setup

refs #2"
git push -u origin feat/core-feel
```

---

### Task 2: Sim types, config constants, vector math

**Files:**
- Create: `src/config.ts`, `src/sim/types.ts`, `src/sim/vec.ts`, `src/sim/state.ts`
- Test: `tests/sim/vec.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sim/vec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { len, norm, lerp } from '../../src/sim/vec';

describe('vec', () => {
  it('len computes euclidean length', () => {
    expect(len({ x: 3, y: 4 })).toBeCloseTo(5);
  });

  it('norm returns zero vector for zero input (no NaN)', () => {
    expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('norm pins both direction and magnitude', () => {
    expect(norm({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
  });

  it('norm handles negative components', () => {
    expect(norm({ x: -3, y: 4 })).toEqual({ x: -0.6, y: 0.8 });
  });

  it('lerp interpolates between two numbers', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/vec.test.ts`
Expected: FAIL — cannot resolve `../../src/sim/vec`.

- [ ] **Step 3: Create src/sim/types.ts**

```ts
export interface Vec2 {
  x: number;
  y: number;
}

/** Everything the simulation is allowed to know about a player's intent for one tick. */
export interface PlayerInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimWorldX: number; // cursor position in world coords
  aimWorldY: number;
  fire: boolean;
  dash: boolean;
}

export type WeaponId = 'pistol';

export interface PlayerState {
  pos: Vec2;
  vel: Vec2;
  aimAngle: number; // radians
  hp: number;
  weapon: WeaponId;
  fireCooldown: number; // seconds until next shot allowed
  dash: {
    timeLeft: number; // >0 means currently dashing (i-frames)
    cooldownLeft: number;
    dirX: number;
    dirY: number;
  };
}

export interface BulletState {
  id: number;
  pos: Vec2;
  vel: Vec2;
  ttl: number; // seconds
  damage: number;
}

/** Axis-aligned solid rectangle. */
export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Serializable plain data — this is what will go over the wire in the netcode slice. */
export interface GameState {
  time: number;
  player: PlayerState;
  bullets: BulletState[];
  nextBulletId: number;
  walls: Wall[];
}
```

- [ ] **Step 4: Create src/config.ts**

```ts
/** All feel/tuning constants. Tune here, nowhere else. */
export const SIM_DT = 1 / 60; // fixed simulation timestep (seconds)

export const PLAYER_SPEED = 220; // px/s
export const PLAYER_RADIUS = 14;
export const PLAYER_MAX_HP = 100;

export const DASH_SPEED = 640; // px/s
export const DASH_DURATION = 0.15; // s
export const DASH_COOLDOWN = 0.8; // s
```

- [ ] **Step 5: Create src/sim/vec.ts**

```ts
import type { Vec2 } from './types';

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function norm(v: Vec2): Vec2 {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

- [ ] **Step 6: Create src/sim/state.ts**

```ts
import { PLAYER_MAX_HP } from '../config';
import type { GameState, PlayerInput, PlayerState, Wall } from './types';

export function createPlayer(x: number, y: number): PlayerState {
  return {
    pos: { x, y },
    vel: { x: 0, y: 0 },
    aimAngle: 0,
    hp: PLAYER_MAX_HP,
    weapon: 'pistol',
    fireCooldown: 0,
    dash: { timeLeft: 0, cooldownLeft: 0, dirX: 1, dirY: 0 },
  };
}

export function createGameState(walls: Wall[]): GameState {
  return {
    time: 0,
    player: createPlayer(480, 270),
    bullets: [],
    nextBulletId: 1,
    walls: [...walls], // copy: each GameState must be an independent snapshot (netcode)
  };
}

export function emptyInput(): PlayerInput {
  return { moveX: 0, moveY: 0, aimWorldX: 0, aimWorldY: 0, fire: false, dash: false };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/sim/vec.test.ts`
Expected: 5 passed.

- [ ] **Step 8: Commit and push**

```bash
git add src/config.ts src/sim/types.ts src/sim/vec.ts src/sim/state.ts tests/sim/vec.test.ts
git commit -m "feat(sim): state types, config constants, vector math

refs #2"
git push
```

---

### Task 3: Fixed-timestep loop

**Files:**
- Create: `src/game/loop.ts`
- Test: `tests/sim/loop.test.ts`

`FixedLoop` is pure (no Phaser) even though it lives in `src/game/` — it is the bridge between frame time and sim ticks. Testing it here prevents the two classic bugs: the spiral of death (unbounded catch-up) and jittery rendering (no interpolation alpha).

- [ ] **Step 1: Write the failing test**

`tests/sim/loop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FixedLoop } from '../../src/game/loop';

const DT = 1 / 60;

describe('FixedLoop', () => {
  it('does not step when elapsed < dt, and returns fractional alpha', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    const alpha = loop.tick(DT * 0.5, () => steps++);
    expect(steps).toBe(0);
    expect(alpha).toBeCloseTo(0.5);
  });

  it('accumulates across ticks', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    loop.tick(DT * 0.5, () => steps++);
    const alpha = loop.tick(DT * 0.6, () => steps++);
    expect(steps).toBe(1);
    expect(alpha).toBeCloseTo(0.1);
  });

  it('steps multiple times for a long frame', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    loop.tick(DT * 3, () => steps++);
    expect(steps).toBe(3);
  });

  it('clamps catch-up to maxSteps (no spiral of death)', () => {
    const loop = new FixedLoop(DT, 5);
    let steps = 0;
    loop.tick(1.0, () => steps++); // one full second hitch
    expect(steps).toBe(5);
  });

  it('survives a NaN elapsed sample without poisoning the accumulator', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    loop.tick(Number.NaN, () => steps++);
    expect(steps).toBe(0);
    loop.tick(DT * 1.5, () => steps++);
    expect(steps).toBe(1); // still alive after the bad frame
  });

  it('treats negative elapsed as zero (alpha stays in [0, 1))', () => {
    const loop = new FixedLoop(DT);
    const alpha = loop.tick(-0.5, () => {});
    expect(alpha).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/loop.test.ts`
Expected: FAIL — cannot resolve `../../src/game/loop`.

- [ ] **Step 3: Create src/game/loop.ts**

```ts
/** Fixed-timestep accumulator. Feed it frame time; it calls step() 0..maxSteps times. */
export class FixedLoop {
  private acc = 0;

  constructor(
    private readonly dt: number,
    private readonly maxSteps = 5,
  ) {}

  /**
   * @param elapsed seconds since last tick (NaN/negative samples are treated as 0)
   * @returns interpolation alpha in [0, 1): how far we are into the next sim tick
   */
  tick(elapsed: number, step: () => void): number {
    if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0; // one bad frame must not poison the accumulator
    this.acc = Math.min(this.acc + elapsed, this.dt * this.maxSteps);
    while (this.acc >= this.dt) {
      step();
      this.acc -= this.dt;
    }
    return this.acc / this.dt;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sim/loop.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit and push**

```bash
git add src/game/loop.ts tests/sim/loop.test.ts
git commit -m "feat(game): fixed-timestep loop with clamped catch-up

refs #2"
git push
```

---

### Task 4: Movement + wall collision

**Files:**
- Create: `src/sim/movement.ts`
- Test: `tests/sim/movement.test.ts`

Collision model: player is treated as an AABB of half-extent `PLAYER_RADIUS`, resolved per axis (move X, clamp against walls; then move Y, clamp). Per-axis resolution gives free wall-sliding, which is essential for tight-corridor feel.

- [ ] **Step 1: Write the failing test**

`tests/sim/movement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PLAYER_RADIUS, PLAYER_SPEED, SIM_DT } from '../../src/config';
import { updateMovement } from '../../src/sim/movement';
import { createPlayer, emptyInput } from '../../src/sim/state';
import type { Wall } from '../../src/sim/types';

describe('updateMovement', () => {
  it('moves at PLAYER_SPEED', () => {
    const p = createPlayer(100, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1 }, [], SIM_DT);
    expect(p.pos.x).toBeCloseTo(100 + PLAYER_SPEED * SIM_DT);
    expect(p.pos.y).toBe(100);
  });

  it('normalizes diagonal input (no speed boost)', () => {
    const p = createPlayer(100, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1, moveY: 1 }, [], SIM_DT);
    const moved = Math.hypot(p.pos.x - 100, p.pos.y - 100);
    expect(moved).toBeCloseTo(PLAYER_SPEED * SIM_DT);
  });

  it('stops at a wall on the X axis', () => {
    const wall: Wall = { x: 120, y: 0, w: 32, h: 200 };
    const p = createPlayer(120 - PLAYER_RADIUS - 1, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1 }, [wall], SIM_DT);
    expect(p.pos.x).toBeCloseTo(120 - PLAYER_RADIUS);
  });

  it('slides along a wall when moving diagonally into it', () => {
    const wall: Wall = { x: 120, y: 0, w: 32, h: 200 };
    const p = createPlayer(120 - PLAYER_RADIUS - 1, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1, moveY: 1 }, [wall], SIM_DT);
    expect(p.pos.x).toBeCloseTo(120 - PLAYER_RADIUS); // blocked on X
    expect(p.pos.y).toBeGreaterThan(100); // still moving on Y
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/movement.test.ts`
Expected: FAIL — cannot resolve `../../src/sim/movement`.

- [ ] **Step 3: Create src/sim/movement.ts**

```ts
import { DASH_SPEED, PLAYER_RADIUS, PLAYER_SPEED } from '../config';
import { norm } from './vec';
import type { PlayerInput, PlayerState, Wall } from './types';

function hitWall(x: number, y: number, walls: Wall[]): Wall | undefined {
  return walls.find(
    (w) =>
      x + PLAYER_RADIUS > w.x &&
      x - PLAYER_RADIUS < w.x + w.w &&
      y + PLAYER_RADIUS > w.y &&
      y - PLAYER_RADIUS < w.y + w.h,
  );
}

export function updateMovement(
  p: PlayerState,
  input: PlayerInput,
  walls: Wall[],
  dt: number,
): void {
  if (p.dash.timeLeft > 0) {
    p.vel = { x: p.dash.dirX * DASH_SPEED, y: p.dash.dirY * DASH_SPEED };
  } else {
    const dir = norm({ x: input.moveX, y: input.moveY });
    p.vel = { x: dir.x * PLAYER_SPEED, y: dir.y * PLAYER_SPEED };
  }

  // Per-axis integration: blocked axis clamps to the wall face, free axis keeps moving (wall slide).
  let nx = p.pos.x + p.vel.x * dt;
  const wx = hitWall(nx, p.pos.y, walls);
  if (wx) nx = p.vel.x > 0 ? wx.x - PLAYER_RADIUS : wx.x + wx.w + PLAYER_RADIUS;
  p.pos.x = nx;

  let ny = p.pos.y + p.vel.y * dt;
  const wy = hitWall(p.pos.x, ny, walls);
  if (wy) ny = p.vel.y > 0 ? wy.y - PLAYER_RADIUS : wy.y + wy.h + PLAYER_RADIUS;
  p.pos.y = ny;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sim/movement.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit and push**

```bash
git add src/sim/movement.ts tests/sim/movement.test.ts
git commit -m "feat(sim): wasd movement with per-axis wall collision and sliding

refs #2"
git push
```

---

### Task 5: Dash with i-frames

**Files:**
- Modify: `src/sim/movement.ts` (add `updateDash`, `isInvulnerable`)
- Test: `tests/sim/dash.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sim/dash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DASH_COOLDOWN, DASH_DURATION, PLAYER_SPEED, SIM_DT } from '../../src/config';
import { isInvulnerable, updateDash, updateMovement } from '../../src/sim/movement';
import { createPlayer, emptyInput } from '../../src/sim/state';
import type { PlayerInput, PlayerState } from '../../src/sim/types';

function step(p: PlayerState, input: PlayerInput): void {
  updateDash(p, input, SIM_DT);
  updateMovement(p, input, [], SIM_DT);
}

describe('dash', () => {
  it('dash moves faster than running and grants i-frames', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    expect(p.pos.x - 100).toBeGreaterThan(PLAYER_SPEED * SIM_DT);
    expect(isInvulnerable(p)).toBe(true);
  });

  it('dash ends after DASH_DURATION and i-frames end with it', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    const ticks = Math.ceil(DASH_DURATION / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) step(p, { ...emptyInput(), moveX: 1 });
    expect(isInvulnerable(p)).toBe(false);
  });

  it('cannot dash again during cooldown', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    // ride out the dash itself, then ask for another dash mid-cooldown
    const ticks = Math.ceil(DASH_DURATION / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) step(p, { ...emptyInput(), moveX: 1 });
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    expect(isInvulnerable(p)).toBe(false);
    expect(p.dash.cooldownLeft).toBeGreaterThan(0);
  });

  it('dash is available again after DASH_COOLDOWN', () => {
    const p = createPlayer(100, 100);
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    const ticks = Math.ceil(DASH_COOLDOWN / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) step(p, { ...emptyInput(), moveX: 1 });
    step(p, { ...emptyInput(), moveX: 1, dash: true });
    expect(isInvulnerable(p)).toBe(true);
  });

  it('dash with no movement input goes toward aim direction', () => {
    const p = createPlayer(100, 100);
    p.aimAngle = 0; // aiming right
    step(p, { ...emptyInput(), dash: true });
    expect(p.pos.x).toBeGreaterThan(100);
    expect(p.pos.y).toBeCloseTo(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/dash.test.ts`
Expected: FAIL — `updateDash` / `isInvulnerable` not exported.

- [ ] **Step 3: Add dash to src/sim/movement.ts**

Add to imports: `DASH_COOLDOWN, DASH_DURATION` from `../config`.
Append these functions:

```ts
export function updateDash(p: PlayerState, input: PlayerInput, dt: number): void {
  p.dash.timeLeft = Math.max(0, p.dash.timeLeft - dt);
  p.dash.cooldownLeft = Math.max(0, p.dash.cooldownLeft - dt);

  if (input.dash && p.dash.timeLeft === 0 && p.dash.cooldownLeft === 0) {
    const dir = norm({ x: input.moveX, y: input.moveY });
    if (dir.x === 0 && dir.y === 0) {
      p.dash.dirX = Math.cos(p.aimAngle);
      p.dash.dirY = Math.sin(p.aimAngle);
    } else {
      p.dash.dirX = dir.x;
      p.dash.dirY = dir.y;
    }
    p.dash.timeLeft = DASH_DURATION;
    p.dash.cooldownLeft = DASH_COOLDOWN;
  }
}

/** i-frames: the player cannot take damage while dashing. Used by combat in slice 2. */
export function isInvulnerable(p: PlayerState): boolean {
  return p.dash.timeLeft > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sim/dash.test.ts`
Expected: 5 passed. Also run `npx vitest run` — all suites still green.

- [ ] **Step 5: Commit and push**

```bash
git add src/sim/movement.ts tests/sim/dash.test.ts
git commit -m "feat(sim): dash with i-frames, duration and cooldown

refs #2"
git push
```

---

### Task 6: Aim, pistol firing, bullets, stepSim

**Files:**
- Create: `src/sim/weapons.ts`, `src/sim/step.ts`
- Test: `tests/sim/weapons.test.ts`

The `WEAPONS` table is the data-driven weapon contract from the design spec — slice 5 adds rows, not classes.

- [ ] **Step 1: Write the failing test**

`tests/sim/weapons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../../src/config';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import { WEAPONS } from '../../src/sim/weapons';
import type { Wall } from '../../src/sim/types';

describe('weapons', () => {
  it('aims at the cursor', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    stepSim(s, { ...emptyInput(), aimWorldX: 100, aimWorldY: 200 }, SIM_DT); // straight down
    expect(s.player.aimAngle).toBeCloseTo(Math.PI / 2);
  });

  it('fires at the weapon fire rate while trigger is held', () => {
    const s = createGameState([]);
    const input = { ...emptyInput(), fire: true, aimWorldX: 999, aimWorldY: 0 };
    const ticks = Math.round(1 / SIM_DT); // one second
    for (let i = 0; i < ticks; i++) stepSim(s, input, SIM_DT);
    const expected = WEAPONS.pistol.fireRate;
    // bullets fired in 1s ≈ fireRate (some may have expired via ttl — count ids instead)
    expect(s.nextBulletId - 1).toBeGreaterThanOrEqual(expected);
    expect(s.nextBulletId - 1).toBeLessThanOrEqual(expected + 1);
  });

  it('bullets travel in the aim direction', () => {
    const s = createGameState([]);
    s.player.pos = { x: 100, y: 100 };
    stepSim(s, { ...emptyInput(), fire: true, aimWorldX: 200, aimWorldY: 100 }, SIM_DT);
    expect(s.bullets).toHaveLength(1);
    expect(s.bullets[0].pos.x).toBeGreaterThan(100);
    expect(s.bullets[0].pos.y).toBeCloseTo(100);
  });

  it('bullets die when hitting a wall', () => {
    const wall: Wall = { x: 200, y: 0, w: 32, h: 400 };
    const s = createGameState([wall]);
    s.player.pos = { x: 100, y: 100 };
    const input = { ...emptyInput(), fire: true, aimWorldX: 300, aimWorldY: 100 };
    for (let i = 0; i < 30; i++) stepSim(s, input, SIM_DT);
    for (const b of s.bullets) {
      expect(b.pos.x).toBeLessThan(200); // none ever inside/past the wall
    }
  });

  it('bullets expire after ttl', () => {
    const s = createGameState([]);
    stepSim(s, { ...emptyInput(), fire: true, aimWorldX: 999, aimWorldY: 0 }, SIM_DT);
    const ticks = Math.ceil(WEAPONS.pistol.bulletTtl / SIM_DT) + 1;
    for (let i = 0; i < ticks; i++) stepSim(s, emptyInput(), SIM_DT);
    expect(s.bullets).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/weapons.test.ts`
Expected: FAIL — cannot resolve `../../src/sim/step` / `../../src/sim/weapons`.

- [ ] **Step 3: Create src/sim/weapons.ts**

```ts
import type { GameState, PlayerInput, PlayerState, Vec2, Wall, WeaponId } from './types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  fireRate: number; // shots per second
  bulletSpeed: number; // px/s
  bulletTtl: number; // seconds
}

/** Data-driven weapon table (design spec §4.2). New weapon = new row, not a new class. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    damage: 25,
    fireRate: 4,
    bulletSpeed: 900,
    bulletTtl: 0.8,
  },
};

export function updateAim(p: PlayerState, input: PlayerInput): void {
  p.aimAngle = Math.atan2(input.aimWorldY - p.pos.y, input.aimWorldX - p.pos.x);
}

export function updateFiring(state: GameState, input: PlayerInput, dt: number): void {
  const p = state.player;
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  if (!input.fire || p.fireCooldown > 0) return;

  const w = WEAPONS[p.weapon];
  state.bullets.push({
    id: state.nextBulletId++,
    pos: { x: p.pos.x, y: p.pos.y },
    vel: { x: Math.cos(p.aimAngle) * w.bulletSpeed, y: Math.sin(p.aimAngle) * w.bulletSpeed },
    ttl: w.bulletTtl,
    damage: w.damage,
  });
  p.fireCooldown = 1 / w.fireRate;
}

function insideWall(pos: Vec2, walls: Wall[]): boolean {
  return walls.some(
    (w) => pos.x > w.x && pos.x < w.x + w.w && pos.y > w.y && pos.y < w.y + w.h,
  );
}

export function updateBullets(state: GameState, dt: number): void {
  for (const b of state.bullets) {
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.ttl -= dt;
  }
  state.bullets = state.bullets.filter((b) => b.ttl > 0 && !insideWall(b.pos, state.walls));
}
```

- [ ] **Step 4: Create src/sim/step.ts**

```ts
import { updateDash, updateMovement } from './movement';
import { updateAim, updateBullets, updateFiring } from './weapons';
import type { GameState, PlayerInput } from './types';

/** One fixed simulation tick. System order is part of the contract — do not reorder casually. */
export function stepSim(state: GameState, input: PlayerInput, dt: number): void {
  state.time += dt;
  updateDash(state.player, input, dt);
  updateMovement(state.player, input, state.walls, dt);
  updateAim(state.player, input);
  updateFiring(state, input, dt);
  updateBullets(state, dt);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all suites pass (vec, loop, movement, dash, weapons).

- [ ] **Step 6: Commit and push**

```bash
git add src/sim/weapons.ts src/sim/step.ts tests/sim/weapons.test.ts
git commit -m "feat(sim): data-driven pistol, aim, bullets and stepSim tick

refs #2"
git push
```

---

### Task 7: Test room, input collector, Phaser render scene

**Files:**
- Create: `src/sim/room.ts`, `src/game/input.ts`, `src/game/GameScene.ts`
- Modify: `src/main.ts` (register GameScene)

No unit tests here — this is the Phaser view layer; verification is a manual playtest (Step 6). Sim logic stays out of these files.

- [ ] **Step 1: Create src/sim/room.ts**

```ts
import type { Wall } from './types';

/** Hardcoded 960×540 test room. Replaced by Tiled maps in the map-vision slice. */
export function testRoomWalls(): Wall[] {
  return [
    { x: 0, y: 0, w: 960, h: 24 }, // top
    { x: 0, y: 516, w: 960, h: 24 }, // bottom
    { x: 0, y: 0, w: 24, h: 540 }, // left
    { x: 936, y: 0, w: 24, h: 540 }, // right
    { x: 420, y: 220, w: 120, h: 32 }, // center obstacle
    { x: 200, y: 360, w: 32, h: 120 }, // lower-left pillar
  ];
}
```

- [ ] **Step 2: Create src/game/input.ts**

```ts
import Phaser from 'phaser';
import type { PlayerInput } from '../sim/types';

interface Keys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
}

/** The only place that touches raw keyboard/mouse. Everything downstream sees PlayerInput. */
export class InputCollector {
  private keys: Keys;

  constructor(private scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,SPACE') as Keys;
  }

  sample(): PlayerInput {
    const pointer = this.scene.input.activePointer;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return {
      moveX: (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0),
      moveY: (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0),
      aimWorldX: world.x,
      aimWorldY: world.y,
      fire: pointer.isDown,
      dash: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
    };
  }
}
```

- [ ] **Step 3: Create src/game/GameScene.ts**

```ts
import Phaser from 'phaser';
import { PLAYER_RADIUS, SIM_DT } from '../config';
import { testRoomWalls } from '../sim/room';
import { createGameState } from '../sim/state';
import { stepSim } from '../sim/step';
import { lerp } from '../sim/vec';
import type { GameState } from '../sim/types';
import { InputCollector } from './input';
import { FixedLoop } from './loop';

const COLORS = {
  wall: 0x1e1e28,
  player: 0xcfd2d6,
  gun: 0x8a8f98,
  bullet: 0xffe08a,
  dash: 0x5a6070,
};

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private loop = new FixedLoop(SIM_DT);
  private inputCollector!: InputCollector;
  private playerShape!: Phaser.GameObjects.Arc;
  private gunShape!: Phaser.GameObjects.Rectangle;
  private bulletShapes = new Map<number, Phaser.GameObjects.Arc>();
  private prevPlayerPos = { x: 0, y: 0 };

  constructor() {
    super('game');
  }

  create(): void {
    this.state = createGameState(testRoomWalls());
    for (const w of this.state.walls) {
      this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, COLORS.wall);
    }
    this.playerShape = this.add.circle(0, 0, PLAYER_RADIUS, COLORS.player);
    this.gunShape = this.add.rectangle(0, 0, 22, 6, COLORS.gun).setOrigin(0, 0.5);
    this.inputCollector = new InputCollector(this);
  }

  update(_time: number, deltaMs: number): void {
    const input = this.inputCollector.sample();
    this.prevPlayerPos = { x: this.state.player.pos.x, y: this.state.player.pos.y };
    const bulletsBefore = this.state.nextBulletId;

    const alpha = this.loop.tick(deltaMs / 1000, () => stepSim(this.state, input, SIM_DT));

    if (this.state.nextBulletId > bulletsBefore) {
      this.cameras.main.shake(40, 0.0008); // muzzle kick
    }
    this.renderState(alpha);
  }

  private renderState(alpha: number): void {
    const p = this.state.player;
    const x = lerp(this.prevPlayerPos.x, p.pos.x, alpha);
    const y = lerp(this.prevPlayerPos.y, p.pos.y, alpha);
    this.playerShape.setPosition(x, y);
    this.playerShape.setFillStyle(p.dash.timeLeft > 0 ? COLORS.dash : COLORS.player);
    this.gunShape.setPosition(x, y).setRotation(p.aimAngle);

    const seen = new Set<number>();
    for (const b of this.state.bullets) {
      seen.add(b.id);
      let shape = this.bulletShapes.get(b.id);
      if (!shape) {
        shape = this.add.circle(b.pos.x, b.pos.y, 3, COLORS.bullet);
        this.bulletShapes.set(b.id, shape);
      }
      shape.setPosition(b.pos.x, b.pos.y);
    }
    for (const [id, shape] of this.bulletShapes) {
      if (!seen.has(id)) {
        shape.destroy();
        this.bulletShapes.delete(id);
      }
    }
  }
}
```

- [ ] **Step 4: Update src/main.ts to register the scene**

Replace the file contents:

```ts
import Phaser from 'phaser';
import { GameScene } from './game/GameScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#0a0a0f',
  scene: [GameScene],
});
```

- [ ] **Step 5: Typecheck and full test run**

Run: `npm run typecheck` — expected: exit 0.
Run: `npm test` — expected: all suites pass.

- [ ] **Step 6: Manual playtest (definition of done for this task)**

Run: `npm run dev`, open the URL, browser console open. Checklist:

- [ ] WASD moves the circle; diagonal is not faster
- [ ] Player slides along walls, cannot pass through walls or obstacles
- [ ] Gun rectangle always points at the cursor
- [ ] Hold left mouse: ~4 shots/s, slight screen kick per shot
- [ ] Bullets vanish on walls and after ~0.8 s in the open
- [ ] Space: short fast burst in the movement direction (aim direction when standing still); player tints grey while dashing; spamming Space does nothing during cooldown
- [ ] No console errors

- [ ] **Step 7: Commit and push**

```bash
git add src/sim/room.ts src/game/input.ts src/game/GameScene.ts src/main.ts
git commit -m "feat(game): test room, input collector and render scene

refs #2"
git push
```

---

### Task 8: Feel pass, docs, PR

**Files:**
- Modify: `src/game/GameScene.ts` (muzzle flash), `src/config.ts` (only if playtest demands tuning)

- [ ] **Step 1: Add muzzle flash to GameScene**

In `update()`, replace the `if (this.state.nextBulletId > bulletsBefore) { ... }` block with:

```ts
    if (this.state.nextBulletId > bulletsBefore) {
      this.cameras.main.shake(40, 0.0008); // muzzle kick
      const p = this.state.player;
      const fx = p.pos.x + Math.cos(p.aimAngle) * 26;
      const fy = p.pos.y + Math.sin(p.aimAngle) * 26;
      const flash = this.add.circle(fx, fy, 7, 0xfff2c0, 0.9);
      this.time.delayedCall(40, () => flash.destroy());
    }
```

- [ ] **Step 2: Playtest the feel and tune constants**

Run: `npm run dev`. Play for a few minutes. If movement/dash/fire feels off, adjust
values in `src/config.ts` only (speeds, durations, cooldowns) and note final values
in the commit message. Re-run `npm test` after tuning — dash/movement tests read the
same constants, so they stay green.

- [ ] **Step 3: Final gates**

Run: `npm run typecheck` — exit 0.
Run: `npm test` — all pass.
Run: `npm run build` — exit 0.
Grep gate (sim purity): `grep -ril "phaser" src/sim tests` — expected: no output.

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "feat(game): muzzle flash and feel tuning pass

closes #2"
git push
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "Slice 1: core-feel" --body "Scaffold + core loop: WASD movement, mouse aim, dash with i-frames, pistol, test room.

Spec: docs/specs/slice-1-core-feel.md
Plan: docs/superpowers/plans/2026-07-02-slice-1-core-feel.md

Closes #2"
```

Then run the two-stage review required by the project workflow before merging:
spec compliance review, code quality review, and a manual playtest with the
browser console open.

---

## Self-Review

Verified against `docs/specs/slice-1-core-feel.md`:

- [x] **Spec coverage:** scaffold (T1), sim/render split + serializable state (T2/T6 — state is plain data, sim has no Phaser imports, grep gate in T8), fixed timestep + interpolation (T3, alpha used in T7 render), WASD 220 px/s normalized (T4), wall collision + slide (T4), dash 0.15 s / 640 px/s / i-frames / 0.8 s cooldown (T5), mouse aim + pistol 4/s + bullet TTL/wall death (T6), data-driven WEAPONS table (T6), test room AABBs + dark flat rendering (T7), feel constants centralized in config.ts (T2), playtest checklist (T7/T8).
- [x] **Non-goals respected:** no zombies, no HP damage path, no sound, no camera follow, single weapon row only.
- [x] **Placeholder scan:** every code step contains complete code; no TBD/TODO items.
- [x] **Type consistency:** `PlayerInput` fields (moveX/moveY/aimWorldX/aimWorldY/fire/dash) match across input.ts, tests, and sim; `dash` sub-state shape identical in types.ts/state.ts/movement.ts; `nextBulletId` used consistently in state.ts/weapons.ts/GameScene.ts; `lerp` defined in T2, used in T7.
- [x] **Commit hygiene:** every task commits + pushes; `refs #2` on all commits, `closes #2` on the final one; branch `feat/core-feel`.

Known accepted simplifications (deliberate, not gaps): render interpolation uses
frame-start snapshot of player position only (bullets are fast enough not to need
it); dash input sampled per frame may span multiple sim ticks (cooldown guard makes
this harmless).

