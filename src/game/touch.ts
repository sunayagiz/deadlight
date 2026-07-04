import Phaser from 'phaser';
import type { PlayerInput } from '../sim/types';
import type { InputCollector } from './input';

/**
 * Pure helper: turn a raw thumb offset (dx,dy from the stick origin) into a unit
 * DIRECTION plus a 0..1 magnitude clamped at `radius`. Direction is undefined for a
 * zero offset, so callers get {0,0,0} (no NaN). Unit-tested in tests/game/touch.test.ts.
 */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number; mag: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0, mag: 0 };
  return { x: dx / len, y: dy / len, mag: Math.min(1, len / radius) };
}

// Screen-space layout (base 960×540; Scale.FIT maps pointer coords into this space).
const HALF_W = 480;
const DEPTH = 30; // above every HUD element (DEPTH_HUD = 20)
const STICK_RADIUS = 70; // left move stick travel
const AIM_RADIUS = 60; // right aim stick travel
const MOVE_DEADZONE = 0.12; // ignore tiny wobble
const SPRINT_AT = 0.9; // near-full push also sprints
const BTN_R = 27;

type BtnId = 'dash' | 'use' | 'ability' | 'ping' | 'build' | 'switch';
interface ButtonDef {
  id: BtnId;
  label: string;
  x: number;
  y: number;
  color: number;
}

// Compact 3×2 cluster in the bottom-right corner — thumb-reachable, out of the
// top-of-screen action sightline.
const BUTTONS: ButtonDef[] = [
  { id: 'ability', label: 'ZED', x: 788, y: 402, color: 0x2b6bff },
  { id: 'build', label: 'BLD', x: 858, y: 402, color: 0xffcf7a },
  { id: 'switch', label: 'WPN', x: 928, y: 402, color: 0x8affbf },
  { id: 'ping', label: 'PING', x: 788, y: 470, color: 0xff8a3a },
  { id: 'use', label: 'USE', x: 858, y: 470, color: 0x4ec6ff },
  { id: 'dash', label: 'DASH', x: 928, y: 470, color: 0xffe08a },
];

interface ButtonNode {
  def: ButtonDef;
  circle: Phaser.GameObjects.Arc;
  text: Phaser.GameObjects.Text;
}

/**
 * A10 — twin-stick virtual touch controls. A pure INPUT-layer adapter: it reads
 * multi-touch pointers and OVERLAYS the existing PlayerInput (left stick → move,
 * right stick → aim + auto-fire, buttons → discrete actions) so the deterministic
 * sim + co-op netcode need zero changes. Hidden on non-touch devices, so desktop
 * keyboard/mouse is completely unaffected.
 */
export class TouchControls {
  private enabled: boolean;
  // stick output (consumed by apply())
  private moveX = 0;
  private moveY = 0;
  private sprint = false;
  private aimActive = false;
  private aimDirX = 1; // last aim direction (persists so PING has a target when the stick is idle)
  private aimDirY = 0;
  // one-shot edge flags for the discrete buttons
  private dashPressed = false;
  private usePressed = false;
  private abilityPressed = false;
  private pingPressed = false;
  // multi-touch bookkeeping: which pointer id owns each stick
  private leftId: number | null = null;
  private rightId: number | null = null;
  private leftOrigin = { x: 0, y: 0 };
  private rightOrigin = { x: 0, y: 0 };
  // visuals
  private leftBase!: Phaser.GameObjects.Arc;
  private leftKnob!: Phaser.GameObjects.Arc;
  private rightBase!: Phaser.GameObjects.Arc;
  private rightKnob!: Phaser.GameObjects.Arc;
  private buttonNodes: ButtonNode[] = [];

  constructor(
    private scene: Phaser.Scene,
    private input: InputCollector,
  ) {
    // Enough simultaneous pointers for move + aim + a button tap at once.
    scene.input.addPointer(3);
    this.enabled = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.leftBase = scene.add.circle(0, 0, STICK_RADIUS, 0xffffff, 0.06).setStrokeStyle(2, 0x9fb4d8, 0.4).setScrollFactor(0).setDepth(DEPTH).setVisible(false);
    this.leftKnob = scene.add.circle(0, 0, 30, 0xcfe8ff, 0.22).setStrokeStyle(2, 0x9fb4d8, 0.7).setScrollFactor(0).setDepth(DEPTH).setVisible(false);
    this.rightBase = scene.add.circle(0, 0, AIM_RADIUS, 0xff8a7a, 0.06).setStrokeStyle(2, 0xff9090, 0.4).setScrollFactor(0).setDepth(DEPTH).setVisible(false);
    this.rightKnob = scene.add.circle(0, 0, 26, 0xffd0c8, 0.22).setStrokeStyle(2, 0xff9090, 0.7).setScrollFactor(0).setDepth(DEPTH).setVisible(false);

    for (const def of BUTTONS) {
      const circle = scene.add.circle(def.x, def.y, BTN_R, def.color, 0.18).setStrokeStyle(2, def.color, 0.7).setScrollFactor(0).setDepth(DEPTH);
      const text = scene.add
        .text(def.x, def.y, def.label, { fontFamily: 'monospace', fontSize: '11px', color: '#e8eef5', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 1);
      this.buttonNodes.push({ def, circle, text });
    }
    this.setVisible(this.enabled);

    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  /** True once touch is engaged (device heuristic or first touch) — drives visibility. */
  get active(): boolean {
    return this.enabled;
  }

  private setVisible(v: boolean): void {
    for (const b of this.buttonNodes) {
      b.circle.setVisible(v);
      b.text.setVisible(v);
    }
    if (!v) {
      this.leftBase.setVisible(false);
      this.leftKnob.setVisible(false);
      this.rightBase.setVisible(false);
      this.rightKnob.setVisible(false);
    }
  }

  private enable(): void {
    this.enabled = true;
    this.setVisible(true);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.enabled) {
      if (!p.wasTouch) return; // desktop mouse: stay hidden, never intercept
      this.enable();
    }
    // Buttons win over the sticks (any finger), so a tap in the aim zone still fires them.
    for (const b of this.buttonNodes) {
      const dx = p.x - b.def.x;
      const dy = p.y - b.def.y;
      if (dx * dx + dy * dy <= (BTN_R + 6) * (BTN_R + 6)) {
        this.pressButton(b);
        return;
      }
    }
    if (p.x < HALF_W && this.leftId === null) {
      this.leftId = p.id;
      this.leftOrigin = { x: p.x, y: p.y };
      this.moveX = 0;
      this.moveY = 0;
      this.sprint = false;
      this.leftBase.setPosition(p.x, p.y).setVisible(true);
      this.leftKnob.setPosition(p.x, p.y).setVisible(true);
    } else if (p.x >= HALF_W && this.rightId === null) {
      this.rightId = p.id;
      this.rightOrigin = { x: p.x, y: p.y };
      this.aimActive = true; // auto-fire begins; direction holds until the thumb slides
      this.rightBase.setPosition(p.x, p.y).setVisible(true);
      this.rightKnob.setPosition(p.x, p.y).setVisible(true);
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id === this.leftId) {
      const v = stickVector(p.x - this.leftOrigin.x, p.y - this.leftOrigin.y, STICK_RADIUS);
      if (v.mag < MOVE_DEADZONE) {
        this.moveX = 0;
        this.moveY = 0;
        this.sprint = false;
      } else {
        this.moveX = v.x * v.mag; // velocity-mapped: magnitude grows with push distance
        this.moveY = v.y * v.mag;
        this.sprint = v.mag >= SPRINT_AT;
      }
      this.leftKnob.setPosition(this.leftOrigin.x + v.x * v.mag * STICK_RADIUS, this.leftOrigin.y + v.y * v.mag * STICK_RADIUS);
    } else if (p.id === this.rightId) {
      const v = stickVector(p.x - this.rightOrigin.x, p.y - this.rightOrigin.y, AIM_RADIUS);
      if (v.mag > 0.001) {
        this.aimDirX = v.x;
        this.aimDirY = v.y;
      }
      this.rightKnob.setPosition(this.rightOrigin.x + v.x * v.mag * AIM_RADIUS, this.rightOrigin.y + v.y * v.mag * AIM_RADIUS);
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.leftId) {
      this.leftId = null;
      this.moveX = 0;
      this.moveY = 0;
      this.sprint = false;
      this.leftBase.setVisible(false);
      this.leftKnob.setVisible(false);
    } else if (p.id === this.rightId) {
      this.rightId = null;
      this.aimActive = false; // stop auto-firing
      this.rightBase.setVisible(false);
      this.rightKnob.setVisible(false);
    }
  }

  private pressButton(b: ButtonNode): void {
    switch (b.def.id) {
      case 'dash':
        this.dashPressed = true;
        break;
      case 'use':
        this.usePressed = true;
        break;
      case 'ability':
        this.abilityPressed = true;
        break;
      case 'ping':
        this.pingPressed = true;
        break;
      case 'build':
        this.input.requestBuildCycle(); // same path as the [B] key
        break;
      case 'switch':
        this.input.requestWeaponCycle(1); // same path as [E] / next weapon
        break;
    }
    // brief press flash, then settle back to the idle fill
    b.circle.setFillStyle(b.def.color, 0.5);
    this.scene.time.delayedCall(90, () => b.circle.setFillStyle(b.def.color, 0.18));
  }

  /**
   * Overlay the current touch state onto a freshly-sampled PlayerInput. No-op on
   * desktop. The right stick is a DIRECTION; we convert it to the world point the
   * sim expects, relative to the LOCAL player, so aimWorld → angle is exact:
   *   aimWorldX = playerPos.x + dir.x*300,  aimWorldY = playerPos.y + dir.y*300.
   */
  apply(input: PlayerInput, playerPos: { x: number; y: number }): void {
    if (!this.enabled) return;
    if (this.moveX !== 0 || this.moveY !== 0) {
      input.moveX = this.moveX;
      input.moveY = this.moveY;
      if (this.sprint) input.sprint = true;
    }
    const aimX = playerPos.x + this.aimDirX * 300;
    const aimY = playerPos.y + this.aimDirY * 300;
    if (this.aimActive) {
      input.aimWorldX = aimX;
      input.aimWorldY = aimY;
      input.fire = true; // auto-fire while the right stick is held
    }
    if (this.dashPressed) input.dash = true;
    if (this.usePressed) input.use = true;
    if (this.abilityPressed) input.ability = true;
    if (this.pingPressed) input.ping = { x: aimX, y: aimY }; // ping the current aim point
    this.dashPressed = false;
    this.usePressed = false;
    this.abilityPressed = false;
    this.pingPressed = false;
  }
}
