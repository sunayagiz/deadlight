import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { showLobby } from './net/lobby';
import { setSession } from './net/session';

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

// Debug params (?zoo/?wave/?at/?wpn/?solo) skip the lobby and go straight to solo.
const qs = new URLSearchParams(window.location.search);
const debug = ['zoo', 'wave', 'at', 'wpn', 'solo'].some((k) => qs.has(k));

if (debug) {
  setSession({ role: 'solo' });
  launch();
} else {
  showLobby().then((cfg) => {
    setSession(cfg);
    launch();
  });
}
