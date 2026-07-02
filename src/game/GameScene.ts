import Phaser from 'phaser';
import { PLAYER_MAX_HP, PLAYER_RADIUS, SIM_DT } from '../config';
import { ZOMBIES } from '../sim/enemies';
import { testRoomSpawnZones, testRoomWalls } from '../sim/room';
import { createGameState } from '../sim/state';
import { stepSim } from '../sim/step';
import { lerp } from '../sim/vec';
import { WEAPONS, cycleWeapon, equipWeapon } from '../sim/weapons';
import type { EnemyType, GameState } from '../sim/types';
import { InputCollector } from './input';
import { FixedLoop } from './loop';

const COLORS = {
  wall: 0x1e1e28,
  player: 0xcfd2d6,
  gun: 0x8a8f98,
  bullet: 0xffe08a,
  rocket: 0xff8a4a,
  dash: 0x5a6070,
  flash: 0xfff2c0,
  boom: 0xffb347,
  hitFlash: 0xffffff,
  hpBack: 0x3a0d0d,
  hpFill: 0xc23b3b,
  melee: 0xe8eaed,
  lootWeapon: 0xf2c14e,
  lootAmmo: 0x4ec3f2,
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
  private meleeArc!: Phaser.GameObjects.Arc;
  private bulletShapes = new Map<number, Phaser.GameObjects.Arc>();
  private enemyShapes = new Map<number, Phaser.GameObjects.Arc>();
  private lootShapes = new Map<number, Phaser.GameObjects.Arc>();
  private explosiveBullets = new Map<number, { x: number; y: number }>(); // track splash rounds for boom fx
  private prevPlayerPos = { x: 0, y: 0 };
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private weaponHud!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;

  constructor() {
    super('game');
  }

  create(): void {
    this.state = createGameState(testRoomWalls(), testRoomSpawnZones());
    for (const w of this.state.walls) {
      this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, COLORS.wall);
    }
    this.meleeArc = this.add.circle(0, 0, 60, COLORS.melee, 0.25).setVisible(false);
    this.playerShape = this.add.circle(0, 0, PLAYER_RADIUS, COLORS.player);
    this.gunShape = this.add.rectangle(0, 0, 22, 6, COLORS.gun).setOrigin(0, 0.5);
    this.inputCollector = new InputCollector(this);

    // Weapon switching: number keys equip by slot, Q/E and the wheel cycle.
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const p = this.state.player;
      if (ev.key >= '1' && ev.key <= '9') {
        const idx = Number(ev.key) - 1;
        if (idx < p.owned.length) equipWeapon(p, p.owned[idx]);
      } else if (ev.key === 'q' || ev.key === 'Q') cycleWeapon(p, -1);
      else if (ev.key === 'e' || ev.key === 'E') cycleWeapon(p, 1);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cycleWeapon(this.state.player, dy > 0 ? 1 : -1);
    });

    // HUD: HP bar + wave/kill readout + current weapon, pinned to the screen.
    this.add.rectangle(16, 16, 200, 14, COLORS.hpBack).setOrigin(0, 0).setScrollFactor(0);
    this.hpFill = this.add.rectangle(16, 16, 200, 14, COLORS.hpFill).setOrigin(0, 0).setScrollFactor(0);
    this.hud = this.add
      .text(16, 36, '', { fontFamily: 'monospace', fontSize: '14px', color: '#cfd2d6' })
      .setScrollFactor(0);
    this.weaponHud = this.add
      .text(16, 512, '', { fontFamily: 'monospace', fontSize: '14px', color: '#f2c14e' })
      .setScrollFactor(0);
  }

  update(_time: number, deltaMs: number): void {
    const input = this.inputCollector.sample();
    this.prevPlayerPos = { x: this.state.player.pos.x, y: this.state.player.pos.y };
    const bulletsBefore = this.state.nextBulletId;

    const alpha = this.loop.tick(deltaMs / 1000, () => stepSim(this.state, input, SIM_DT));

    if (this.state.nextBulletId > bulletsBefore && WEAPONS[this.state.player.weapon].kind !== 'melee') {
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

    // Melee swing wedge.
    const def = WEAPONS[p.weapon];
    if (def.kind === 'melee' && p.meleeSwing > 0) {
      const halfArcDeg = ((def.arc ?? 0) * 180) / Math.PI;
      const aimDeg = (p.aimAngle * 180) / Math.PI;
      this.meleeArc
        .setPosition(x, y)
        .setRadius(def.range ?? 40)
        .setStartAngle(aimDeg - halfArcDeg)
        .setEndAngle(aimDeg + halfArcDeg)
        .setVisible(true);
    } else {
      this.meleeArc.setVisible(false);
    }

    this.trackExplosions();

    this.syncShapes(
      this.bulletShapes,
      this.state.bullets.map((b) => ({
        id: b.id,
        x: b.pos.x,
        y: b.pos.y,
        r: b.splashRadius > 0 ? 5 : 3,
        color: b.splashRadius > 0 ? COLORS.rocket : COLORS.bullet,
      })),
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
    this.syncShapes(
      this.lootShapes,
      this.state.loot.map((l) => ({
        id: l.id,
        x: l.pos.x,
        y: l.pos.y,
        r: 6,
        color: l.kind === 'weapon' ? COLORS.lootWeapon : COLORS.lootAmmo,
      })),
    );

    this.hpFill.width = 200 * Math.max(0, p.hp / PLAYER_MAX_HP);
    const w = this.state.wave;
    const status = w.phase === 'intermission' ? `next in ${Math.ceil(w.timer)}s` : `${this.state.enemies.length} left`;
    this.hud.setText(`WAVE ${w.index}  ·  ${status}  ·  kills ${w.killsThisWave}`);

    const ammo = def.startAmmo === undefined ? '∞' : String(Math.ceil(p.ammo[def.id] ?? 0));
    const slots = p.owned.map((id, i) => `${i + 1}:${WEAPONS[id].name}${id === p.weapon ? '*' : ''}`).join('  ');
    this.weaponHud.setText(`${def.name}  [${ammo}]     ${slots}`);

    if (this.state.gameOver && !this.overlay) {
      this.overlay = this.add
        .text(480, 270, 'YOU DIED', { fontFamily: 'monospace', fontSize: '48px', color: '#c23b3b' })
        .setOrigin(0.5)
        .setScrollFactor(0);
    }
  }

  /** Splash rounds that vanished since last frame get a one-shot blast flash at their last position. */
  private trackExplosions(): void {
    const present = new Set<number>();
    for (const b of this.state.bullets) {
      if (b.splashRadius > 0) {
        present.add(b.id);
        this.explosiveBullets.set(b.id, { x: b.pos.x, y: b.pos.y });
      }
    }
    for (const [id, pos] of this.explosiveBullets) {
      if (!present.has(id)) {
        const boom = this.add.circle(pos.x, pos.y, 90, COLORS.boom, 0.5);
        this.tweens.add({ targets: boom, alpha: 0, scale: 1.2, duration: 220, onComplete: () => boom.destroy() });
        this.cameras.main.shake(120, 0.006);
        this.explosiveBullets.delete(id);
      }
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
      shape.setPosition(it.x, it.y).setRadius(it.r).setFillStyle(it.color);
    }
    for (const [id, shape] of pool) {
      if (!seen.has(id)) {
        shape.destroy();
        pool.delete(id);
      }
    }
  }
}
