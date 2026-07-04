import { describe, it, expect } from 'vitest';
import {
  BLEEDOUT_TIME,
  DOWNED_CRAWL_SPEED,
  PLAYER_SPEED,
  REVIVE_HP,
  REVIVE_TIME,
  SELF_REVIVE_TIME,
  SIM_DT,
} from '../../src/config';
import { downPlayer, updateRevives } from '../../src/sim/coop';
import { spawnEnemy, updateEnemies } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';

function solo() {
  return createGameState([], [], [], { x: 500, y: 500 }, { width: 4000, height: 4000 }, 1);
}
function coop(n: number) {
  return createGameState([], [], [], { x: 100, y: 100 }, { width: 4000, height: 4000 }, n);
}

describe('downed crawl', () => {
  it('a downed (but alive) player crawls slowly when given move input', () => {
    const s = solo();
    downPlayer(s.player); // on the ground, still alive
    const input = emptyInput();
    input.moveX = 1; // crawl east
    const x0 = s.player.pos.x;
    stepSim(s, input, SIM_DT);
    const moved = s.player.pos.x - x0;
    expect(moved).toBeGreaterThan(0); // it MOVES (not frozen)
    // ...but at the crawl speed, far below a standing player's walk
    expect(moved).toBeCloseTo(DOWNED_CRAWL_SPEED * SIM_DT, 4);
    expect(moved).toBeLessThan(PLAYER_SPEED * SIM_DT * 0.5);
  });

  it('a downed player cannot fire (stays defenseless while crawling)', () => {
    const s = solo();
    s.player.weapon = 'pistol';
    downPlayer(s.player);
    const input = emptyInput();
    input.moveX = 1;
    input.fire = true; // trying to shoot while down
    for (let i = 0; i < 10; i++) stepSim(s, input, SIM_DT);
    expect(s.bullets).toHaveLength(0); // no shots come out while downed
  });

  it('a downed player is still not "up": enemies keep ignoring them', () => {
    const s = coop(2);
    s.players[0].pos = { x: 200, y: 1000 }; // this one goes down
    s.players[1].pos = { x: 1800, y: 1000 }; // standing, far east
    downPlayer(s.players[0]);
    const e = spawnEnemy(s, 'runner', { x: 1000, y: 1000 }); // between them
    updateEnemies(s.enemies, s.players, s.walls, SIM_DT); // nearest-standing seek
    expect(e.vel.x).toBeGreaterThan(0); // heads east to the STANDING player, ignores the downed one
  });
});

describe('solo self-revive (Quick Revive)', () => {
  it('a solo lethal hit downs the player instead of instant death', () => {
    const s = solo();
    s.player.hp = 1;
    expect(s.player.selfReviveCharges).toBeGreaterThan(0);
    spawnEnemy(s, 'brute', { x: 500, y: 500 }); // on top of the player
    for (let i = 0; i < 10; i++) stepSim(s, emptyInput(), SIM_DT);
    expect(s.player.downed).toBe(true);
    expect(s.player.alive).toBe(true);
    expect(s.gameOver).toBe(false);
  });

  it('the self-revive meter fills over time and stands the player up, spending a charge', () => {
    const s = solo();
    downPlayer(s.player);
    const charges0 = s.player.selfReviveCharges;
    // not quite enough time yet
    for (let i = 0; i < Math.floor(SELF_REVIVE_TIME / SIM_DT) - 5; i++) updateRevives(s, [emptyInput()], SIM_DT);
    expect(s.player.downed).toBe(true);
    expect(s.player.reviveProgress).toBeGreaterThan(0);
    expect(s.player.reviveProgress).toBeLessThan(1);
    // finish it off
    for (let i = 0; i < 10; i++) updateRevives(s, [emptyInput()], SIM_DT);
    expect(s.player.downed).toBe(false);
    expect(s.player.hp).toBe(REVIVE_HP);
    expect(s.player.selfReviveCharges).toBe(charges0 - 1);
  });

  it('with no charges left a downed solo player bleeds out to dead and the run ends', () => {
    const s = solo();
    downPlayer(s.player);
    s.player.selfReviveCharges = 0;
    const ticks = Math.ceil(BLEEDOUT_TIME / SIM_DT) + 2;
    for (let i = 0; i < ticks; i++) stepSim(s, emptyInput(), SIM_DT);
    expect(s.player.alive).toBe(false);
    expect(s.gameOver).toBe(true);
  });

  it('a downed solo player does NOT self-revive with zero charges (bleedout ticks down)', () => {
    const s = solo();
    downPlayer(s.player);
    s.player.selfReviveCharges = 0;
    const b0 = s.player.bleedout;
    for (let i = 0; i < 30; i++) updateRevives(s, [emptyInput()], SIM_DT);
    expect(s.player.downed).toBe(true);
    expect(s.player.reviveProgress).toBe(0); // meter never fills without a charge
    expect(s.player.bleedout).toBeLessThan(b0); // it's bleeding out instead
  });
});

describe('co-op revive still works (no regression)', () => {
  it('a standing teammate revives a downed player without consuming self-revive charges', () => {
    const s = coop(2);
    s.players[0].pos = { x: 100, y: 100 };
    s.players[1].pos = { x: 120, y: 100 }; // within revive radius
    downPlayer(s.players[0]);
    const charges0 = s.players[0].selfReviveCharges;
    const input = [emptyInput(), emptyInput()]; // teammate not firing
    const ticks = Math.ceil(REVIVE_TIME / SIM_DT) + 2;
    for (let i = 0; i < ticks; i++) updateRevives(s, input, SIM_DT);
    expect(s.players[0].downed).toBe(false);
    expect(s.players[0].hp).toBe(REVIVE_HP);
    expect(s.players[0].selfReviveCharges).toBe(charges0); // teammate revive is free — no charge spent
  });

  it('a solo-in-a-squad downed player (dead teammate) does NOT self-revive — must be picked up', () => {
    const s = coop(2);
    s.players[0].pos = { x: 100, y: 100 };
    s.players[1].alive = false; // the only teammate is dead → nobody can revive
    downPlayer(s.players[0]);
    const input = [emptyInput(), emptyInput()];
    for (let i = 0; i < Math.ceil(SELF_REVIVE_TIME / SIM_DT) + 10; i++) updateRevives(s, input, SIM_DT);
    expect(s.players[0].reviveProgress).toBe(0); // no self-revive in a squad, even solo-in-squad
    expect(s.players[0].downed).toBe(true);
  });
});
