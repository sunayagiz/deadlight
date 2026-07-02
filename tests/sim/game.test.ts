import { describe, it, expect } from 'vitest';
import { PLAYER_MAX_HP, SIM_DT } from '../../src/config';
import { createGameState, emptyInput } from '../../src/sim/state';
import { stepSim } from '../../src/sim/step';
import { testRoomSpawnZones, testRoomWalls } from '../../src/sim/room';

function run(state: ReturnType<typeof createGameState>, seconds: number, input = emptyInput()): void {
  const rng = seq([0, 0.34, 0.67]);
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) stepSim(state, input, SIM_DT, rng);
}

function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('game loop integration', () => {
  it('spawns a hunting wave after the first intermission and a still player takes damage', () => {
    const s = createGameState(testRoomWalls(), testRoomSpawnZones());
    expect(s.enemies).toHaveLength(0); // intermission first
    run(s, 18); // past intermission + spawns + even a slow shambler's travel time
    expect(s.enemies.length).toBeGreaterThan(0);
    expect(s.player.hp).toBeLessThan(PLAYER_MAX_HP); // enemies reached and hurt the player
  });

  it('freezes the world once the player dies', () => {
    const s = createGameState(testRoomWalls(), testRoomSpawnZones());
    s.player.hp = 1;
    run(s, 12);
    expect(s.gameOver).toBe(true);
    const enemiesAtDeath = s.enemies.length;
    const timeAtDeath = s.time;
    run(s, 2); // time still advances but nothing else changes
    expect(s.enemies.length).toBe(enemiesAtDeath);
    expect(s.time).toBeGreaterThan(timeAtDeath);
  });
});
