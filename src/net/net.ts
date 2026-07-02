import { Peer, type DataConnection } from 'peerjs';
import { MAX_PLAYERS } from '../config';
import { emptyInput } from '../sim/state';
import type { PlayerInput } from '../sim/types';
import type { NetMsg, Snapshot } from './protocol';

// Namespace room ids on the public PeerJS broker so they don't collide.
const PREFIX = 'deadlight-og-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// STUN helps ICE find a route across different networks (needed for real
// cross-machine play, and to negotiate loopback candidates reliably).
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

export function makeRoomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export interface HostNet {
  role: 'host';
  code: string;
  inputs: PlayerInput[]; // inputs[0] = host (scene sets it); inputs[1..] = guests' latest
  connected: boolean[]; // slot occupancy (index 0 = host, always true)
  broadcast(snap: Snapshot): void;
  start(players: number): void;
  destroy(): void;
}

export interface GuestNet {
  role: 'guest';
  you: number; // assigned player slot (1..MAX_PLAYERS-1)
  latest: Snapshot | null;
  sendInput(i: PlayerInput): void;
  destroy(): void;
}

/** Host a room. Resolves once the broker has our id (room code is live). */
export function createHost(
  code: string,
  opts: { onJoin?: (slot: number) => void; onLeave?: (slot: number) => void } = {},
): Promise<HostNet> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, PEER_OPTS);
    const inputs = Array.from({ length: MAX_PLAYERS }, () => emptyInput());
    const connected = Array.from({ length: MAX_PLAYERS }, (_, i) => i === 0);
    const slots: (DataConnection | null)[] = Array.from({ length: MAX_PLAYERS }, () => null);

    peer.on('error', reject);
    peer.on('open', () => {
      resolve({
        role: 'host',
        code,
        inputs,
        connected,
        broadcast(snap) {
          const msg: NetMsg = { t: 'snap', s: snap };
          for (const c of slots) if (c && c.open) c.send(msg);
        },
        start(players) {
          const msg: NetMsg = { t: 'start', players };
          for (const c of slots) if (c && c.open) c.send(msg);
        },
        destroy() {
          peer.destroy();
        },
      });
    });

    peer.on('connection', (conn) => {
      const slot = slots.findIndex((s, i) => i > 0 && s === null);
      if (slot < 0) {
        conn.on('open', () => conn.close()); // room full
        return;
      }
      slots[slot] = conn;
      connected[slot] = true;
      conn.on('open', () => conn.send({ t: 'welcome', you: slot } satisfies NetMsg));
      conn.on('data', (d) => {
        const m = d as NetMsg;
        if (m.t === 'input') inputs[slot] = m.i;
      });
      conn.on('close', () => {
        slots[slot] = null;
        connected[slot] = false;
        opts.onLeave?.(slot);
      });
      opts.onJoin?.(slot);
    });
  });
}

/** Join a room by code. Resolves once connected + assigned a slot. */
export function createGuest(
  code: string,
  opts: { onStart?: (players: number) => void } = {},
): Promise<GuestNet> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_OPTS);
    let resolved = false;
    peer.on('error', reject);
    peer.on('open', () => {
      // JSON serialization: the default BinaryPack silently drops the large
      // per-tick snapshots; JSON handles the plain nested state reliably.
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      const guest: GuestNet = {
        role: 'guest',
        you: 1,
        latest: null,
        sendInput(i) {
          if (conn.open) conn.send({ t: 'input', i } satisfies NetMsg);
        },
        destroy() {
          peer.destroy();
        },
      };
      conn.on('open', () => {
        if (!resolved) {
          resolved = true;
          resolve(guest);
        }
      });
      conn.on('data', (d) => {
        const m = d as NetMsg;
        if (m.t === 'welcome') guest.you = m.you;
        else if (m.t === 'start') opts.onStart?.(m.players);
        else if (m.t === 'snap') guest.latest = m.s;
      });
      conn.on('error', reject);
    });
  });
}
