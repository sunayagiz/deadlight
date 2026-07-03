import Phaser from 'phaser';
import type { PlayerInput } from '../sim/types';

interface Keys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
  SHIFT: Phaser.Input.Keyboard.Key;
  F: Phaser.Input.Keyboard.Key; // interact / buy
}

/** The only place that touches raw keyboard/mouse. Everything downstream sees PlayerInput. */
export class InputCollector {
  private keys: Keys;
  private pendingSlot = -1; // weapon slot requested since the last sample
  private pendingCycle = 0;
  private pendingBuy = -1; // shop purchase requested by the HUD since the last sample
  private pendingPerk = -1; // perk-draft pick requested by the HUD since the last sample

  constructor(private scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,SPACE,SHIFT,F') as Keys;
    // Weapon switching is captured here as edge events, then folded into the
    // per-tick PlayerInput so it travels over the network like everything else.
    scene.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (ev.key >= '1' && ev.key <= '9') this.pendingSlot = Number(ev.key) - 1;
      else if (ev.key === 'q' || ev.key === 'Q') this.pendingCycle = -1;
      else if (ev.key === 'e' || ev.key === 'E') this.pendingCycle = 1;
    });
    scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.pendingCycle = dy > 0 ? 1 : -1;
    });
  }

  /** HUD hooks: queue a shop purchase / perk pick to fold into the next input tick. */
  requestBuy(index: number): void {
    this.pendingBuy = index;
  }
  requestPerk(index: number): void {
    this.pendingPerk = index;
  }

  sample(): PlayerInput {
    const pointer = this.scene.input.activePointer;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const slot = this.pendingSlot;
    const cycle = this.pendingCycle;
    const buy = this.pendingBuy;
    const perk = this.pendingPerk;
    this.pendingSlot = -1;
    this.pendingCycle = 0;
    this.pendingBuy = -1;
    this.pendingPerk = -1;
    return {
      moveX: (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0),
      moveY: (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0),
      aimWorldX: world.x,
      aimWorldY: world.y,
      fire: pointer.isDown,
      dash: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
      sprint: this.keys.SHIFT.isDown,
      weaponSlot: slot,
      weaponCycle: cycle,
      buy,
      perk,
      use: Phaser.Input.Keyboard.JustDown(this.keys.F),
    };
  }
}
