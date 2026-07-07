# TIDEHOLD SOLO — design & implementation

The conversion of TIDEHOLD from a persistent multiplayer strategy game into a
**serverless single-player flood-survival roguelite** built for browser portals
(CrazyGames, Poki, GameDistribution). Zero backend, everything in `localStorage`,
runs entirely from a static build.

The whole game reuses the existing pure, deterministic `shared/` package — the
same world generator, tide, economy, combat, and expedition logic that powered
the multiplayer server — now driven by a client-side tick loop. The old
multiplayer client (`client/src/App.tsx`, `store.ts`, `api.ts`, `ws.ts`,
`components/`) is kept in the tree as a future "director's cut" and is tree-shaken
out of the shipped bundle.

---

## The game loop

```
BOOT ── boot() ──► START RUN (today's Daily Tide seed, immediately in-game)
                         │
                         ▼
         ┌──────────── RUN (tick every 850ms, pausable) ─────────────┐
         │  each tick: production → upkeep → army movement →         │
         │  battles → expeditions → AI rival Arks → tide rise →      │
         │  survival score → win/lose check                          │
         │                                                            │
         │  player intents (map taps / sheets):                       │
         │    claim · build · upgrade · move Ark · refit Ark ·        │
         │    recruit · move army · attack · expedition · offer relics│
         │                                                            │
         │  rewarded hooks: hold back the tide · (on death) continue  │
         └───────────────────────────┬────────────────────────────────┘
                                     ▼
                          GAME OVER (drowned / breached / outlasted)
                          score → salvage → localStorage
                          rewarded: continue · double salvage · share
                                     │
                    ┌────────────────┼─────────────────┐
                    ▼                ▼                  ▼
              PLAY AGAIN        THE RELIQUARY       THE DAILY TIDE
            (interstitial      (spend salvage on    (local leaderboard,
             every 2nd run)     permanent upgrades)  share seed)
```

A run lasts **~6–12 minutes**: the tide rises every 52 ticks (~44s) and the world
ends after 8 rises. The first rise is scripted at tick 30 (~25s) so the threat is
felt immediately. Map radius is 15 (smaller and sharper than multiplayer's 26).

### First 60 seconds (cold open)

- **0s** — `boot()` drops you straight onto today's Daily map, camera on your Ark.
- One tile **glows gold** with "Settle here" (`SoloMapCanvas` renders the glow from
  `engine.startTile`; the `ColdOpenHint` shows a one-line prompt).
- **~10s** — first claim → **guaranteed reward** (`FIRST_CLAIM_SALVAGE_RELICS`
  relics: "salvage in the old ruins beneath your claim"). Hint advances to "raise a
  Farm or Lumber Camp".
- **~25s** — the first tide rise visibly floods the lowlands (doom-telegraph tiles
  pulse cyan the tick before they die). The map teaches loss with no text.
- From there the fork that *is* the game: exploit the rich, doomed lowlands, or
  climb to safe high ground.

---

## State architecture

```
shared/ (unchanged, pure)         client/src/solo/
  worldgen · tide · economy         config.ts   all balance + upgrade/skin/commander specs
  combat · expedition · hex · rng   types.ts    MetaState, RunResult, DailyStore, RunStats
                                    engine.ts   EngineState + createRun/tick/intents (reuses shared)
                                    ai.ts       AI rival Ark controllers (same intents as the human)
                                    save.ts     localStorage load/save (versioned, corruption-safe)
                                    daily.ts    day-seed, share links, ?seed=/?day= replay
                                    ads.ts      rewarded/interstitial adapter (CrazyGames/GD/mock)
                                    store.ts    zustand: run lifecycle, tick loop, render view, all actions
                                    ui.ts       pure formatting/metadata helpers
                                    SoloMapCanvas.tsx   the renderer
                                    SoloApp.tsx         screen shell
                                    components/*        HUD, sheets, overlays
```

- **`engine.ts` owns truth.** `EngineState` holds the live world (tiles, players,
  armies, battles, expeditions) exactly like the old server `GameState`, minus
  multiplayer/market/contracts. `tick()` advances it; intent functions
  (`claimTile`, `build`, `moveArk`, `recruit`, `attack`, `launchExpedition`, …)
  are the same rules the AI uses.
- **`store.ts` is the only thing the UI sees.** Each tick it mirrors the engine
  into a render-ready view (`tiles`, `me`, `players`, `armies`, `battles`,
  `stats`, …) and drains toast-flagged engine events. Every mutation goes through
  a store action that calls the engine, re-syncs, and toasts errors.
- **Determinism.** `createRun(seed, meta)` fully reproduces a world; per-event
  seeds come from `hash2(entityCounter, tick, worldSeed)`. Same seed → same run.

---

## Save format (`localStorage`)

Three versioned keys, all defensively parsed (a corrupt/old save silently resets):

- **`tidehold_solo_meta_v1`** — `MetaState`:
  ```json
  { "version": 1, "salvage": 240, "upgrades": ["stores","hull"],
    "commanders": ["maren","kael"], "skins": ["brass","frost"],
    "selectedCommander": "kael", "selectedSkin": "frost",
    "bestScore": 3120, "bestTide": 8, "runsPlayed": 17,
    "runsSinceInterstitial": 1, "dailyDone": { "20260707": 3120 } }
  ```
- **`tidehold_solo_daily_v1`** — `DailyStore`: `{ version, days: { "YYYYMMDD": DailyEntry[] } }`
  (each day keeps the top 20 attempts, best-first).
- **`tidehold_solo_run_v1`** — reserved for mid-run resume (P2).

Nothing else leaves the browser. No accounts, no server, no personal data.

---

## AI behavior (`ai.ts`)

Each of 3 rival Arks plays by the **same intents** the human uses (fair, one rule
set), taking at most one major action on its staggered tick. Priority ladder:

1. **Survive** — if the Ark's tile floods next rise and a move is ready, relocate
   to the highest safe land in range.
2. **Economy** — build on an owned empty tile (farm → production → shrine →
   tower), else claim a high, productive, unflooded tile in influence.
3. **Score** — offer banked relics at a shrine; send expeditions to open ruins.
4. **War** (from tide level 2) — raise a small force by an aggression trait, then
   take a garrisoned ruin or a neighbor's exposed tile; march adjacent and attack.

AIs are scored and placed against the player; the game-over screen shows your
placement in the field. They create the late-game pressure a shrinking map needs
without any server or human liquidity.

---

## Monetization hooks (`ads.ts`, retention-safe)

| Hook | Where | Effect |
|------|-------|--------|
| **Rewarded: hold back the tide** | `HoldTidePrompt`, shown when a rise is imminent | pushes the next tide rise `HOLD_TIDE_TICKS` later |
| **Rewarded: continue after defeat** | game-over screen | revive the Ark on safe ground, restore hull, ease the tide |
| **Rewarded: double salvage** | game-over screen | doubles the run's meta-currency |
| **Interstitial between runs** | `startNextRun`, capped to every 2nd run | one break, never mid-run |

The adapter auto-detects the CrazyGames SDK (`window.CrazyGames`) or
GameDistribution (`window.gdsdk`); with neither present it renders a built-in mock
ad (`AdModal`) so the game is fully playable in dev and on any host. Add the SDK
`<script>` in `index.html` for the portal build (commented example included).

---

## Portal optimization

- **Fast load** — static Vite build (~single JS chunk), no network calls at boot.
- **Keyboard + mouse** — drag/wheel to pan/zoom; WASD/arrows pan; `+/-` zoom; `Esc`
  cancels targeting; taps select and issue orders.
- **Touch** — pointer events + pinch-zoom; touch targets ≥ 40px; `user-scalable=no`.
- **Fullscreen** — HUD button via the Fullscreen API.
- **Pause/resume** — the tick loop halts while paused or while an ad is showing;
  gameplay-start/stop signals sent to the portal SDK when available.

---

## Prioritized task list & build order

**P0 — a playable run (done).** Client engine reusing `shared/`; cold-open with
glow + guaranteed reward + scripted first flood; continuous flooding; migrate-or-die;
AI rivals; run-end with score → salvage; deterministic seeds.

**P1 — the retention & money loop (done).** Daily Tide seed + local leaderboard +
share/replay links; permanent meta-progression (upgrades/commanders/skins in
`localStorage`); rewarded + interstitial hooks; portal SDK adapter; keyboard/
fullscreen/pause/mobile.

**P2 — polish & depth (next).** Mid-run resume (`tidehold_solo_run_v1`);
achievements surfaced to portal SDKs; weekly mutators (fast tide / relic drought);
an auto-generated "drowning map" thumbnail GIF; deterministic input-replay (not
just seed-replay) for verifiable leaderboards and shareable clips.

**P3 — growth & catalog.** Real CrazyGames/GD submission with tags + GIF; localize
UI strings (ES/PT/DE/TR); reskin the engine into sibling SKUs (wildfire, plague,
space-station) — same code, new portals; Steam "director's cut" of the multiplayer
build.

---

## Run it

```bash
npm install && npm run dev     # http://localhost:5173 — starts in-game on the Daily
npm run build                  # static bundle in client/dist, deployable to any CDN/portal
```

No server process is required to play the single-player game.
