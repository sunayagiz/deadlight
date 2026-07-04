import { dailySeedString } from '../sim/rng';
import { todayYYYYMMDD } from '../game/scores';
import { createGuest, createHost, makeRoomCode, type GuestNet, type HostNet } from './net';

// `seed` present ⇒ a deterministic seeded run (daily challenge / shared seed).
// Absent ⇒ a normal solo run driven by Math.random.
export type GameConfig =
  | { role: 'solo'; seed?: string }
  | { role: 'host'; net: HostNet; players: number }
  | { role: 'guest'; net: GuestNet; you: number };

const CSS = `
#lobby{position:fixed;inset:0;background:#06070a;display:grid;place-items:center;font-family:monospace;color:#8fef9f;z-index:1000}
#lobby .box{width:min(440px,90vw);background:#0c0f14;border:1px solid #1c2a20;border-radius:10px;padding:28px;text-align:center;box-shadow:0 0 60px #000}
#lobby h1{margin:0 0 4px;font-size:34px;letter-spacing:6px;color:#cfe8d4}
#lobby .sub{color:#4d6b55;margin-bottom:22px;font-size:12px;letter-spacing:2px}
#lobby button{width:100%;padding:13px;margin:6px 0;background:#101a12;color:#8fef9f;border:1px solid #2b4a34;border-radius:7px;font-family:monospace;font-size:15px;cursor:pointer;letter-spacing:1px}
#lobby button:hover{background:#16261a;border-color:#3ea45a}
#lobby button.ghost{background:transparent;color:#5c7a63;border-color:#233}
#lobby input{width:100%;box-sizing:border-box;padding:12px;margin:8px 0;background:#06090b;border:1px solid #2b4a34;border-radius:7px;color:#cfe8d4;font-family:monospace;font-size:22px;letter-spacing:8px;text-align:center;text-transform:uppercase}
#lobby .code{font-size:44px;letter-spacing:12px;color:#7dffa0;margin:14px 0}
#lobby .msg{color:#6d8f74;font-size:13px;margin:10px 0;min-height:18px}
#lobby .players{color:#cfe8d4;font-size:15px;margin:8px 0}
`;

export function showLobby(): Promise<GameConfig> {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'lobby';
    document.body.appendChild(root);

    const done = (cfg: GameConfig) => {
      root.remove();
      style.remove();
      resolve(cfg);
    };

    const menu = () => {
      root.innerHTML = `<div class="box"><h1>DEADLIGHT</h1><div class="sub">CO-OP · UP TO 4</div>
        <button id="solo">▶ SOLO</button>
        <button id="daily">☠ DAILY CHALLENGE</button>
        <button id="host">⌂ HOST GAME</button>
        <button id="join">⇲ JOIN GAME</button>
        <div class="sub" style="margin:14px 0 0">SEED · ${dailySeedString(todayYYYYMMDD())}</div></div>`;
      root.querySelector('#solo')!.addEventListener('click', () => done({ role: 'solo' }));
      root.querySelector('#daily')!.addEventListener('click', () =>
        done({ role: 'solo', seed: dailySeedString(todayYYYYMMDD()) }),
      );
      root.querySelector('#host')!.addEventListener('click', hostFlow);
      root.querySelector('#join')!.addEventListener('click', joinFlow);
    };

    const hostFlow = async () => {
      const code = makeRoomCode();
      root.innerHTML = `<div class="box"><h1>HOST</h1><div class="sub">SHARE THIS CODE</div>
        <div class="code">${code}</div>
        <div class="players" id="pc">Players: 1 / 4</div>
        <div class="msg" id="msg">starting broker…</div>
        <button id="start" disabled>START MATCH</button>
        <button class="ghost" id="back">← back</button></div>`;
      root.querySelector('#back')!.addEventListener('click', menu);
      let count = 1;
      const pc = root.querySelector('#pc')!;
      const startBtn = root.querySelector('#start') as HTMLButtonElement;
      try {
        const net = await createHost(code, {
          onJoin: () => {
            count++;
            pc.textContent = `Players: ${count} / 4`;
          },
          onLeave: () => {
            count = Math.max(1, count - 1);
            pc.textContent = `Players: ${count} / 4`;
          },
        });
        root.querySelector('#msg')!.textContent = 'waiting for players…';
        startBtn.disabled = false;
        startBtn.addEventListener('click', () => {
          net.start(count);
          done({ role: 'host', net, players: count });
        });
      } catch (e) {
        root.querySelector('#msg')!.textContent = 'host failed — try again';
      }
    };

    const joinFlow = () => {
      root.innerHTML = `<div class="box"><h1>JOIN</h1><div class="sub">ENTER ROOM CODE</div>
        <input id="code" maxlength="4" placeholder="----" autofocus>
        <div class="msg" id="msg"></div>
        <button id="connect">CONNECT</button>
        <button class="ghost" id="back">← back</button></div>`;
      root.querySelector('#back')!.addEventListener('click', menu);
      const input = root.querySelector('#code') as HTMLInputElement;
      input.focus();
      const connect = async () => {
        const code = input.value.trim().toUpperCase();
        if (code.length < 4) return;
        root.querySelector('#msg')!.textContent = 'connecting…';
        try {
          const net = await createGuest(code, {
            onStart: () => done({ role: 'guest', net, you: net.you }),
          });
          root.querySelector('#msg')!.textContent = 'connected — waiting for host to start…';
        } catch {
          root.querySelector('#msg')!.textContent = 'could not connect — check the code';
        }
      };
      root.querySelector('#connect')!.addEventListener('click', connect);
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') connect();
      });
    };

    menu();
  });
}
