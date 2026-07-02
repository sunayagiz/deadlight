import type { GameConfig } from './lobby';

// Set by main.ts (from the lobby result) before the Phaser game boots, read by GameScene.
let current: GameConfig = { role: 'solo' };
export const setSession = (c: GameConfig): void => {
  current = c;
};
export const getSession = (): GameConfig => current;
