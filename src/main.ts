import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { todayYYYYMMDD } from './game/scores';
import { showLobby } from './net/lobby';
import { setSession } from './net/session';
import { dailySeedString } from './sim/rng';

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
//   ?zoo/?wave/?at/?wpn/?solo → normal (unseeded) solo playtest
const qs = new URLSearchParams(window.location.search);
const debug = ['zoo', 'wave', 'at', 'wpn', 'solo', 'daily', 'seed'].some((k) => qs.has(k));

if (debug) {
  const seedParam = qs.get('seed');
  const seed = seedParam ?? (qs.has('daily') ? dailySeedString(todayYYYYMMDD()) : undefined);
  setSession({ role: 'solo', seed });
  launch();
} else {
  showLobby().then((cfg) => {
    setSession(cfg);
    launch();
  });
}
