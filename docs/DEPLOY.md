# Deploying Deadlight

The game is a static site (Vite build). It runs from **any** path — Vite `base`
is `./` and runtime asset URLs use `import.meta.env.BASE_URL`.

## GitHub Pages (automatic)

`.github/workflows/deploy.yml` builds `dist/` and publishes it on every push to
`main` / `feat/big-map`. **One-time setup by a repo admin:**

1. Repo **Settings → Pages**
2. **Source: GitHub Actions**

After that, each push auto-deploys to `https://<owner>.github.io/deadlight/`.
(The workflow tries to enable Pages itself, but that needs admin — a WRITE
collaborator can't. So an admin flips the Source once.)

## Cloudflare Pages (alternative)

- Framework preset: none
- Build command: `npm run build`
- Output directory: `dist`

Drop your own TURN credentials in at runtime via `window.DEADLIGHT_TURN`
(array of `RTCIceServer`) for a faster/private relay than the bundled public one.

## Local

```bash
npm run build      # dist/
npm run preview    # serve the built game
npm run dev        # dev server with HMR
```

## Playing co-op

Both players open the site → **HOST GAME** shows a 4-char code → the other picks
**JOIN GAME** and enters it → **START**. Same network connects over STUN;
cross-country falls back to the bundled TURN relays (works through CGNAT).
