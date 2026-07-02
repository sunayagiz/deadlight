import Phaser from 'phaser';
import { PLAYER_MAX_HP, PLAYER_RADIUS, SIM_DT } from '../config';
import { ZOMBIES } from '../sim/enemies';
import { testRoomSpawnZones, testRoomWalls } from '../sim/room';
import { createGameState } from '../sim/state';
import { stepSim } from '../sim/step';
import { lerp } from '../sim/vec';
import type { EnemyType, GameState } from '../sim/types';
import { InputCollector } from './input';
import { FixedLoop } from './loop';

const COLORS = {
  wall: 0x1e1e28,
  player: 0xcfd2d6,
  gun: 0x8a8f98,
  bullet: 0xffe08a,
  dash: 0x5a6070,
  flash: 0xfff2c0,
  hitFlash: 0xffffff,
  hpBack: 0x3a0d0d,
  hpFill: 0xc23b3b,
};

const ENEMY_COLORS: Record<EnemyType, number> = {
  shambler: 0x6b8f5a, // sickly green
  runner: 0xb0894a, // wiry tan
  brute: 0x8a3f6b, // bruised purple
};

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private loop = new FixedLoop(SIM_DT);
  private inputCollector!: InputCollector;
  private playerShape!: Phaser.GameObjects.Arc;
  private gunShape!: Phaser.GameObjects.Rectangle;
  private bulletShapes = new Map<number, Phaser.GameObjects.Arc>();
  private enemyShapes = new Map<number, Phaser.GameObjects.Arc>();
  private prevPlayerPos = { x: 0, y: 0 };
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;

  constructor() {
    super('game');
  }

  create(): void {
    this.state = createGameState(testRoomWalls(), testRoomSpawnZones());
    for (const w of this.state.walls) {
      this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, COLORS.wall);
    }
    this.playerShape = this.add.circle(0, 0, PLAYER_RADIUS, COLORS.player);
    this.gunShape = this.add.rectangle(0, 0, 22, 6, COLORS.gun).setOrigin(0, 0.5);
    this.inputCollector = new InputCollector(this);

    // HUD: HP bar + wave/kill readout, pinned to the screen.
    this.add.rectangle(16, 16, 200, 14, COLORS.hpBack).setOrigin(0, 0).setScrollFactor(0);
    this.hpFill = this.add.rectangle(16, 16, 200, 14, COLORS.hpFill).setOrigin(0, 0).setScrollFactor(0);
    this.hud = this.add
      .text(16, 36, '', { fontFamily: 'monospace', fontSize: '14px', color: '#cfd2d6' })
      .setScrollFactor(0);
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

    this.syncShapes(
      this.bulletShapes,
      this.state.bullets.map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, r: 3, color: COLORS.bullet })),
    );
    this.syncShapes(
      this.enemyShapes,
      this.state.enemies.map((e) => ({
        id: e.id,
        x: e.pos.x,
        y: e.pos.y,
        r: ZOMBIES[e.type].radius,
        color: e.hitFlash > 0 ? COLORS.hitFlash : ENEMY_COLORS[e.type],
      })),
    );

    this.hpFill.width = 200 * Math.max(0, p.hp / PLAYER_MAX_HP);
    const w = this.state.wave;
    const status = w.phase === 'intermission' ? `next in ${Math.ceil(w.timer)}s` : `${this.state.enemies.length} left`;
    this.hud.setText(`WAVE ${w.index}  ·  ${status}  ·  kills ${w.killsThisWave}`);

    if (this.state.gameOver && !this.overlay) {
      this.overlay = this.add
        .text(480, 270, 'YOU DIED', { fontFamily: 'monospace', fontSize: '48px', color: '#c23b3b' })
        .setOrigin(0.5)
        .setScrollFactor(0);
    }
  }

  /** Diffing renderer: create/move/destroy view shapes to match sim entities by id. */
  private syncShapes(
    pool: Map<number, Phaser.GameObjects.Arc>,
    items: { id: number; x: number; y: number; r: number; color: number }[],
  ): void {
    const seen = new Set<number>();
    for (const it of items) {
      seen.add(it.id);
      let shape = pool.get(it.id);
      if (!shape) {
        shape = this.add.circle(it.x, it.y, it.r, it.color);
        pool.set(it.id, shape);
      }
      shape.setPosition(it.x, it.y).setFillStyle(it.color);
    }
    for (const [id, shape] of pool) {
      if (!seen.has(id)) {
        shape.destroy();
        pool.delete(id);
      }
    }
  }
}
