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
  flash: 0xfff2c0,
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
      const p = this.state.player;
      const fx = p.pos.x + Math.cos(p.aimAngle) * 26;
      const fy = p.pos.y + Math.sin(p.aimAngle) * 26;
      const flash = this.add.circle(fx, fy, 7, COLORS.flash, 0.9);
      this.time.delayedCall(40, () => flash.destroy());
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
