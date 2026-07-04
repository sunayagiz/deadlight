import Phaser from 'phaser';
import type { DeployableKind, PlayerInput } from '../sim/types';

interface Keys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
  SHIFT: Phaser.Input.Keyboard.Key;
  F: Phaser.Input.Keyboard.Key; // interact / buy
  X: Phaser.Input.Keyboard.Key; // A9: trigger Zed-Time (when the meter is full)
}

// A7 build-bar cycle: B steps barricade → trap → off.
const BUILD_KINDS: DeployableKind[] = ['barricade', 'trap'];

/** The only place that touches raw keyboard/mouse. Everything downstream sees PlayerInput. */
export class InputCollector {
  private keys: Keys;
  private pendingSlot = -1; // weapon slot requested since the last sample
  private pendingCycle = 0;
  private pendingBuy = -1; // shop purchase requested by the HUD since the last sample
  private pendingPerk = -1; // perk-draft pick requested by the HUD since the last sample
  private pendingReroll = false; // draft reroll requested by the HUD since the last sample
  private pendingBanish = -1; // draft option to banish requested by the HUD since the last sample
  private pendingPing = false; // co-op ping requested (Z / middle-mouse) since the last sample
  private buildIndex = -1; // A7 build mode: -1 = off, else index into BUILD_KINDS
  private pendingPlace: { x: number; y: number; kind: DeployableKind } | null = null; // build click since the last sample

  constructor(private scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,SPACE,SHIFT,F,X') as Keys;
    // Weapon switching is captured here as edge events, then folded into the
    // per-tick PlayerInput so it travels over the network like everything else.
    scene.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (ev.key >= '1' && ev.key <= '9') this.pendingSlot = Number(ev.key) - 1;
      else if (ev.key === 'q' || ev.key === 'Q') this.pendingCycle = -1;
      else if (ev.key === 'e' || ev.key === 'E') this.pendingCycle = 1;
      else if (ev.key === 'z' || ev.key === 'Z') this.pendingPing = true; // ping at the cursor
      else if (ev.key === 'b' || ev.key === 'B') this.buildIndex = this.buildIndex >= BUILD_KINDS.length - 1 ? -1 : this.buildIndex + 1; // cycle the build bar
    });
    scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.pendingCycle = dy > 0 ? 1 : -1;
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button === 1) this.pendingPing = true; // middle-mouse also pings (Apex muscle memory)
      else if (p.button === 0 && this.buildIndex >= 0) {
        // left-click in build mode places at the aim world point (never fires the weapon)
        const world = this.scene.cameras.main.getWorldPoint(p.x, p.y);
        this.pendingPlace = { x: world.x, y: world.y, kind: BUILD_KINDS[this.buildIndex] };
      }
    });
  }

  /** A7 — the deployable currently selected in the build bar, or null when not building (drives the preview + fire suppression). */
  buildKind(): DeployableKind | null {
    return this.buildIndex >= 0 ? BUILD_KINDS[this.buildIndex] : null;
  }

  /** HUD hooks: queue a shop purchase / perk pick to fold into the next input tick. */
  requestBuy(index: number): void {
    this.pendingBuy = index;
  }
  requestPerk(index: number): void {
    this.pendingPerk = index;
  }
  requestReroll(): void {
    this.pendingReroll = true;
  }
  requestBanish(index: number): void {
    this.pendingBanish = index;
  }
  /** A10 (touch): cycle the build bar — identical to pressing [B]. */
  requestBuildCycle(): void {
    this.buildIndex = this.buildIndex >= BUILD_KINDS.length - 1 ? -1 : this.buildIndex + 1;
  }
  /** A10 (touch): request a weapon cycle (+1 next / -1 prev) — same path as [Q]/[E]. */
  requestWeaponCycle(dir: number): void {
    this.pendingCycle = dir;
  }

  sample(): PlayerInput {
    const pointer = this.scene.input.activePointer;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const slot = this.pendingSlot;
    const cycle = this.pendingCycle;
    const buy = this.pendingBuy;
    const perk = this.pendingPerk;
    const reroll = this.pendingReroll;
    const banish = this.pendingBanish;
    const ping = this.pendingPing ? { x: world.x, y: world.y } : null; // ping the current aim point
    const place = this.pendingPlace;
    const building = this.buildIndex >= 0;
    this.pendingSlot = -1;
    this.pendingCycle = 0;
    this.pendingBuy = -1;
    this.pendingPerk = -1;
    this.pendingReroll = false;
    this.pendingBanish = -1;
    this.pendingPing = false;
    this.pendingPlace = null;
    return {
      moveX: (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0),
      moveY: (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0),
      aimWorldX: world.x,
      aimWorldY: world.y,
      fire: building ? false : pointer.isDown, // building steals the left click for placement
      dash: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
      sprint: this.keys.SHIFT.isDown,
      weaponSlot: slot,
      weaponCycle: cycle,
      buy,
      perk,
      reroll,
      banish,
      use: Phaser.Input.Keyboard.JustDown(this.keys.F),
      ability: Phaser.Input.Keyboard.JustDown(this.keys.X), // A9: pop Zed-Time (edge-triggered)
      ping,
      place,
    };
  }
}
