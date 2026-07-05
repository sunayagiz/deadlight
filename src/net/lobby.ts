import { dailySeedString } from '../sim/rng';
import { todayYYYYMMDD } from '../game/scores';
import { LOADOUTS, getLoadout } from '../game/loadouts';
import { getProfile, getSelectedLoadout, isUnlocked, selectLoadout, spend, unlock } from '../game/profile';
import { COLORBLIND_LABEL, cycleColorblind, getSettings, setSettings } from '../game/settings';
import { resetTips } from '../game/tips';
import type { GameMode } from '../sim/types';
import { createGuest, createHost, makeRoomCode, type GuestNet, type HostNet } from './net';

// `seed` present ⇒ a deterministic seeded run (daily challenge / shared seed).
// Absent ⇒ a normal solo run driven by Math.random.
// `loadout` = the meta-progression starting-loadout id the host/solo player picked
// (render/session-layer only; applied by the host at run start, never netcoded).
// `mode` = A8 objective (endless/extraction/defend); the host's mode defines the
// match, carried into the initial serialized state (guests read it from the snapshot).
export type GameConfig =
  | { role: 'solo'; seed?: string; loadout?: string; mode?: GameMode }
  | { role: 'host'; net: HostNet; players: number; loadout?: string; mode?: GameMode }
  | { role: 'guest'; net: GuestNet; you: number };

// A8 — the three selectable objectives, cycled from the menu.
const MODES: GameMode[] = ['endless', 'extraction', 'defend'];
const MODE_LABEL: Record<GameMode, string> = { endless: 'SURVIVE', extraction: 'EXTRACT', defend: 'DEFEND' };

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
#lobby .curr{color:#e8d27d;font-size:13px;letter-spacing:2px;margin:0 0 14px}
#lobby .lo{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;margin:7px 0;background:#0a1410;border:1px solid #223;border-radius:7px;text-align:left}
#lobby .lo.sel{border-color:#3ea45a;background:#101f16;box-shadow:0 0 0 1px #2b4a34 inset}
#lobby .lo .lname{color:#cfe8d4;font-size:14px;letter-spacing:1px}
#lobby .lo .ldesc{color:#5c7a63;font-size:11px;margin-top:3px;line-height:1.4}
#lobby .lo .lact{flex:0 0 auto}
#lobby .lo button{width:auto;min-width:92px;margin:0;padding:9px 12px;font-size:12px}
#lobby .lo .tag{color:#4d6b55;font-size:11px;letter-spacing:2px;white-space:nowrap}
#lobby .lo .tag.on{color:#7dffa0}
#lobby .lo .tag.lock{color:#c26b3b}
#lobby .set{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;margin:7px 0;background:#0a1410;border:1px solid #223;border-radius:7px;text-align:left}
#lobby .set.col{flex-direction:column;align-items:stretch;gap:9px}
#lobby .set .sname{color:#cfe8d4;font-size:13px;letter-spacing:1px}
#lobby .set button{width:auto;min-width:132px;margin:0;padding:8px 12px;font-size:12px}
#lobby .set .srow{display:flex;justify-content:space-between;align-items:center;gap:10px}
#lobby .set .sval{color:#7dffa0;font-size:12px;min-width:44px;text-align:right}
#lobby .set input[type=range]{width:100%;margin:0;padding:0;accent-color:#3ea45a;cursor:pointer}
#lobby .ctl{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 4px;border-bottom:1px solid #16211a;text-align:left}
#lobby .ctl .key{color:#7dffa0;font-size:12px;letter-spacing:1px;flex:0 0 auto;font-weight:bold}
#lobby .ctl .cd{color:#8aa892;font-size:12px;text-align:right}
#lobby .howtxt{color:#8aa892;font-size:12px;line-height:1.6;text-align:left;margin:14px 2px 4px}
#lobby .howtxt b{color:#cfe8d4;font-weight:bold}
`;

export function showLobby(): Promise<GameConfig> {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'lobby';
    document.body.appendChild(root);

    // A8 — the objective the SOLO/HOST run starts in (cycled from the menu). Daily
    // stays SURVIVE so its seeded leaderboard means one fixed thing.
    let mode: GameMode = 'endless';

    const done = (cfg: GameConfig) => {
      root.remove();
      style.remove();
      resolve(cfg);
    };

    const MODE_DESC: Record<GameMode, string> = {
      endless: 'endless waves — die and the run ends',
      extraction: 'survive 10 waves, then reach & hold the exit',
      defend: 'protect the generator for 15 waves',
    };

    const menu = () => {
      root.innerHTML = `<div class="box"><h1>DEADLIGHT</h1><div class="sub">CO-OP · UP TO 4</div>
        <button id="mode">◎ MODE · ${MODE_LABEL[mode]}</button>
        <div class="sub" style="margin:-2px 0 12px;color:#4d6b55">${MODE_DESC[mode]}</div>
        <button id="solo">▶ SOLO</button>
        <button id="daily">☠ DAILY CHALLENGE</button>
        <button id="host">⌂ HOST GAME</button>
        <button id="join">⇲ JOIN GAME</button>
        <button class="ghost" id="loadouts">⚙ LOADOUTS · ${getLoadout(getSelectedLoadout()).name}</button>
        <button class="ghost" id="settings">⚙ SETTINGS</button>
        <button class="ghost" id="howto">⚑ HOW TO PLAY</button>
        <div class="sub" style="margin:14px 0 0">SEED · ${dailySeedString(todayYYYYMMDD())}</div></div>`;
      const loadout = getSelectedLoadout();
      root.querySelector('#mode')!.addEventListener('click', () => {
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        menu();
      });
      root.querySelector('#solo')!.addEventListener('click', () => done({ role: 'solo', loadout, mode }));
      root.querySelector('#daily')!.addEventListener('click', () =>
        done({ role: 'solo', seed: dailySeedString(todayYYYYMMDD()), loadout }), // daily is always SURVIVE
      );
      root.querySelector('#host')!.addEventListener('click', hostFlow);
      root.querySelector('#join')!.addEventListener('click', joinFlow);
      root.querySelector('#loadouts')!.addEventListener('click', loadoutFlow);
      root.querySelector('#settings')!.addEventListener('click', settingsFlow);
      root.querySelector('#howto')!.addEventListener('click', howToFlow);
    };

    // HOW TO PLAY — a controls reference + a one-paragraph "how it works", plus a
    // button to re-arm the contextual onboarding tips. Pure render/DOM (mirrors the
    // SETTINGS / LOADOUTS sub-screen pattern); nothing here touches the sim.
    const howToFlow = () => {
      const controls: [string, string][] = [
        ['WASD', 'move'],
        ['Mouse', 'aim · click to fire'],
        ['Shift', 'sprint'],
        ['Space', 'dash (dodge)'],
        ['1–9 / Q · E / wheel', 'switch weapons'],
        ['F', 'interact · buy (doors / box / Pack-a-Punch / walls / power)'],
        ['B', 'build (barricade / trap)'],
        ['Z', 'ping (mark enemy / loot / go)'],
        ['X', 'Zed-Time (slow enemies when the meter is full)'],
        ['R', 'restart after death'],
      ];
      const rows = controls
        .map(([k, v]) => `<div class="ctl"><span class="key">${k}</span><span class="cd">${v}</span></div>`)
        .join('');
      root.innerHTML = `<div class="box"><h1 style="font-size:24px">HOW TO PLAY</h1>
        <div class="sub" style="margin:-2px 0 12px">CONTROLS</div>
        ${rows}
        <div class="howtxt">Survive endless waves of the dead. Every hit and kill earns
        shared <b>cash</b> — spend it to open <b>doors</b>, buy guns off the <b>wall</b>
        or the <b>Mystery Box</b>, flip the <b>power</b>, and <b>Pack-a-Punch</b> your
        weapon. Between waves, <b>draft a perk</b> (rarer = more levels). Stay together:
        reviving a downed teammate beats going down alone.</div>
        <div class="msg" id="msg" style="min-height:0"></div>
        <button class="ghost" id="rt">↺ RESET TIPS</button>
        <button class="ghost" id="back" style="margin-top:6px">← back</button></div>`;
      root.querySelector('#back')!.addEventListener('click', menu);
      root.querySelector('#rt')!.addEventListener('click', () => {
        resetTips();
        root.querySelector('#msg')!.textContent = 'onboarding tips will show again';
      });
    };

    // Accessibility settings screen. Every control persists immediately to the
    // localStorage settings module (render-layer only); GameScene reads it at run
    // start. Sliders update their % label live without a full re-render so dragging
    // stays smooth; toggles/cycles re-render to refresh their label.
    const settingsFlow = () => {
      const render = () => {
        const s = getSettings();
        const pct = (n: number) => `${Math.round(n * 100)}%`;
        root.innerHTML = `<div class="box"><h1 style="font-size:24px">SETTINGS</h1>
          <div class="sub" style="margin:-2px 0 14px">ACCESSIBILITY</div>
          <div class="set"><span class="sname">Colour-blind mode</span>
            <button id="cb">${COLORBLIND_LABEL[s.colorblind]}</button></div>
          <div class="set"><span class="sname">Captions</span>
            <button id="cap">${s.captions ? 'ON' : 'OFF'}</button></div>
          <div class="set"><span class="sname">High contrast</span>
            <button id="hc">${s.highContrast ? 'ON' : 'OFF'}</button></div>
          <div class="set col"><div class="srow"><span class="sname">Screen shake</span>
            <span class="sval" id="shakeV">${pct(s.shake)}</span></div>
            <input type="range" id="shake" min="0" max="100" step="5" value="${Math.round(s.shake * 100)}"></div>
          <div class="set col"><div class="srow"><span class="sname">Flash · red damage</span>
            <span class="sval" id="flashV">${pct(s.flash)}</span></div>
            <input type="range" id="flash" min="0" max="100" step="5" value="${Math.round(s.flash * 100)}"></div>
          <button class="ghost" id="back" style="margin-top:14px">← back</button></div>`;
        root.querySelector('#back')!.addEventListener('click', menu);
        root.querySelector('#cb')!.addEventListener('click', () => {
          cycleColorblind();
          render();
        });
        root.querySelector('#cap')!.addEventListener('click', () => {
          setSettings({ captions: !getSettings().captions });
          render();
        });
        root.querySelector('#hc')!.addEventListener('click', () => {
          setSettings({ highContrast: !getSettings().highContrast });
          render();
        });
        const shake = root.querySelector('#shake') as HTMLInputElement;
        shake.addEventListener('input', () => {
          setSettings({ shake: Number(shake.value) / 100 });
          root.querySelector('#shakeV')!.textContent = `${shake.value}%`;
        });
        const flash = root.querySelector('#flash') as HTMLInputElement;
        flash.addEventListener('input', () => {
          setSettings({ flash: Number(flash.value) / 100 });
          root.querySelector('#flashV')!.textContent = `${flash.value}%`;
        });
      };
      render();
    };

    // Meta-progression screen: spend earned currency to unlock loadouts, then SELECT
    // the active one. All state lives in the localStorage profile (render-layer only).
    const loadoutFlow = () => {
      const profile = getProfile();
      const rows = LOADOUTS.map((l) => {
        const owned = isUnlocked(l.id);
        const active = profile.selected === l.id;
        const act = active
          ? `<span class="tag on">✓ ACTIVE</span>`
          : owned
            ? `<button data-select="${l.id}">SELECT</button>`
            : `<button data-unlock="${l.id}">☠ ${l.cost}</button>`;
        return `<div class="lo${active ? ' sel' : ''}">
          <div><div class="lname">${l.name}</div><div class="ldesc">${l.desc}</div></div>
          <div class="lact">${act}</div></div>`;
      }).join('');
      root.innerHTML = `<div class="box"><h1 style="font-size:24px">LOADOUTS</h1>
        <div class="curr">☠ ${profile.currency} CURRENCY</div>
        <div class="msg" id="msg" style="min-height:0"></div>
        ${rows}
        <button class="ghost" id="back" style="margin-top:14px">← back</button></div>`;
      root.querySelector('#back')!.addEventListener('click', menu);
      root.querySelectorAll<HTMLButtonElement>('button[data-select]').forEach((b) =>
        b.addEventListener('click', () => {
          selectLoadout(b.dataset.select!);
          loadoutFlow();
        }),
      );
      root.querySelectorAll<HTMLButtonElement>('button[data-unlock]').forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.unlock!;
          const cost = getLoadout(id).cost;
          if (spend(cost)) {
            unlock(id);
            selectLoadout(id); // unlocking selects it right away
          } else {
            root.querySelector('#msg')!.textContent = 'not enough currency — survive more waves';
            return;
          }
          loadoutFlow();
        }),
      );
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
          done({ role: 'host', net, players: count, loadout: getSelectedLoadout(), mode });
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
