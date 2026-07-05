import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { todayYYYYMMDD } from './game/scores';
import { showLobby } from './net/lobby';
import { setSession } from './net/session';
import { dailySeedString } from './sim/rng';
import type { GameMode } from './sim/types';

function launch(): void {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 960,
    height: 540,
    backgroundColor: '#0a0a0f',
    scale: {
      mode: Phaser.Scale.FIT, // fill the window, keep 16:9
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [GameScene],
  });
}

// Debug params skip the lobby and go straight to solo.
//   ?daily            → today's seeded daily challenge
//   ?seed=<str>       → replay a specific seed (e.g. share/verify a run)
//   ?mode=extraction|defend → A8 objective mode (default endless)
//   ?ext              → jump straight to the open extraction exit (any mode)
//   ?zoo/?wave/?at/?wpn/?solo → normal (unseeded) solo playtest
const qs = new URLSearchParams(window.location.search);
const debug = ['zoo', 'wave', 'at', 'wpn', 'solo', 'daily', 'seed', 'mode', 'ext'].some((k) => qs.has(k));

if (debug) {
  const seedParam = qs.get('seed');
  const seed = seedParam ?? (qs.has('daily') ? dailySeedString(todayYYYYMMDD()) : undefined);
  const modeParam = qs.get('mode');
  const mode: GameMode | undefined =
    modeParam === 'extraction' || modeParam === 'defend' ? modeParam : undefined;
  setSession({ role: 'solo', seed, mode });
  launch();
} else {
  showLobby().then((cfg) => {
    setSession(cfg);
    launch();
  });
}
