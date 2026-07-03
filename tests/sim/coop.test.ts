import { describe, it, expect } from 'vitest';
import { BLEEDOUT_TIME, REVIVE_HP, REVIVE_TIME, SIM_DT } from '../../src/config';
import { updateCombat } from '../../src/sim/combat';
import { downPlayer, updateRevives } from '../../src/sim/coop';
import { spawnEnemy, updateEnemies } from '../../src/sim/enemies';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';

function coop(n: number) {
  return createGameState([], [], [], { x: 100, y: 100 }, { width: 2000, height: 2000 }, n);
}

describe('co-op', () => {
  it('creates the requested number of players', () => {
    expect(coop(4).players).toHaveLength(4);
    expect(coop(1).players).toHaveLength(1);
  });

  it('a lethal hit DOWNS a co-op player (not instant death), with a bleedout timer', () => {
    const s = coop(2);
    s.players[0].pos = { x: 100, y: 100 };
    s.players[0].hp = 1;
    s.players[1].pos = { x: 1500, y: 1500 }; // too far to revive
    spawnEnemy(s, 'brute', { x: 100, y: 100 });
    for (let i = 0; i < 10; i++) updateCombat(s, SIM_DT);
    expect(s.players[0].downed).toBe(true);
    expect(s.players[0].alive).toBe(true); // still bleeding out, not dead
    expect(s.players[0].bleedout).toBeGreaterThan(0);
    expect(s.players[0].bleedout).toBeLessThanOrEqual(BLEEDOUT_TIME);
  });

  it('a standing teammate nearby revives a downed player', () => {
    const s = coop(2);
    s.players[0].pos = { x: 100, y: 100 };
    s.players[1].pos = { x: 120, y: 100 }; // within revive radius
    downPlayer(s.players[0]);
    const input = [emptyInput(), emptyInput()]; // teammate not firing
    const ticks = Math.ceil(REVIVE_TIME / SIM_DT) + 2;
    for (let i = 0; i < ticks; i++) updateRevives(s, input, SIM_DT);
    expect(s.players[0].downed).toBe(false);
    expect(s.players[0].hp).toBe(REVIVE_HP);
  });

  it('a downed player left alone bleeds out and dies', () => {
    const s = coop(2);
    s.players[0].pos = { x: 100, y: 100 };
    s.players[1].pos = { x: 1500, y: 1500 }; // nobody nearby
    downPlayer(s.players[0]);
    const input = [emptyInput(), emptyInput()];
    const ticks = Math.ceil(BLEEDOUT_TIME / SIM_DT) + 2;
    for (let i = 0; i < ticks; i++) updateRevives(s, input, SIM_DT);
    expect(s.players[0].alive).toBe(false);
  });

  it('gameOver only once the whole squad is down/dead', () => {
    const s = coop(2);
    s.players.forEach((p) => (p.alive = false));
    stepSim(s, [emptyInput(), emptyInput()], SIM_DT);
    expect(s.gameOver).toBe(true);
  });

  it('enemies chase the nearest player', () => {
    const s = coop(2);
    s.players[0].pos = { x: 200, y: 1000 };
    s.players[1].pos = { x: 1800, y: 1000 };
    const e = spawnEnemy(s, 'runner', { x: 1700, y: 1000 }); // clearly closer to player 1
    updateEnemies(s.enemies, s.players, s.walls, SIM_DT); // no flow field -> nearest-seek
    expect(e.vel.x).toBeGreaterThan(0); // heads east toward player 1, not west toward player 0
  });
});
