import Phaser from 'phaser';
import type { PlayerInput } from '../sim/types';

interface Keys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
  SHIFT: Phaser.Input.Keyboard.Key;
}

/** The only place that touches raw keyboard/mouse. Everything downstream sees PlayerInput. */
export class InputCollector {
  private keys: Keys;

  constructor(private scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,SPACE,SHIFT') as Keys;
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
      sprint: this.keys.SHIFT.isDown,
    };
  }
}
