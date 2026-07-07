# 🌊 TIDEHOLD

**A multiplayer browser strategy game where the world itself is the enemy.**

The continent is drowning. Level by level, the Tide takes everything — and every tile on
the map shows you exactly when it dies. Build, trade, swear oaths, fight wars, raid the
ruins of what the sea already took, and move your civilization before the water reaches
it. When the last peaks stand alone above an endless sea, the Chronicle remembers who
mattered.

![status](https://img.shields.io/badge/status-playable-2ea44f) ![tests](https://img.shields.io/badge/tests-223%20passing-2ea44f)

---

## The pitch

- **The Tide** — the map is not static. The sea rises on a fixed, public schedule and
  permanently floods the low country. The richest land lies lowest, so greed is always a
  bet against the water. Doomed tiles pulse on the map; the countdown is in your face.
- **The Ark** — your capital is a ship. You can only claim land near it, so migration is
  a way of life, not a setback. Enemies can plunder its cargo, damage its systems,
  capture your commanders, and force it to flee — but it can never be destroyed.
  **Defeat hurts. It never deletes you.**
- **The Ledger** — diplomacy as public record. Alliances, non-aggression pacts,
  recurring trades, tributes, and ransoms for captured commanders. Anyone can betray
  anyone; the reputation system makes infamy expensive. Drop below 60 reputation and you
  are an **Oathbreaker**: doubled market fees, and attacking you carries no dishonor —
  it's *rewarded*.
- **Warfare without click-speed** — a counter triangle (Bladesworn > Tidebows >
  Shieldbearers > Bladesworn), terrain and watchtower bonuses, commander traits, and a
  preparation window between declaration and resolution. The defender sees the attack
  coming and can reinforce or evacuate. The best strategist wins, not the fastest hand.
- **Exploration that tells stories** — surface ruins are guarded by remnant garrisons;
  drowned ruins are open to divers. Every expedition returns with relics, salvage, and a
  written story beat — and sometimes a permanent technology of the old world.
- **Seasons** — expansion → conflict → endgame, driven entirely by the tide level. When
  the sea wins (it always wins), scores are settled, the world rests briefly, and a new
  continent rises from a new seed. Reputation persists across seasons; everything else
  starts fresh.

## Stack

| Layer     | Choice                                                                 |
|-----------|------------------------------------------------------------------------|
| `shared/` | Pure TypeScript game logic — deterministic, seeded, 210 unit tests      |
| `server/` | Fastify + better-sqlite3 + ws. Fully server-authoritative tick engine   |
| `client/` | React 18 + Vite + zustand + a hand-rolled Canvas hex renderer           |

One deployable service: the server serves the API, the WebSocket feed, and the built
client. SQLite keeps operations at zero-config; the data layer is a thin document store
that could be pointed at Postgres for horizontal scale (see *Scaling* below).

**Never trust the client:** every action is validated server-side (costs, ranges,
terrain, ownership, contract rules), all randomness is seeded server-side, rate limits
guard auth/chat/actions, passwords are scrypt-hashed, and sessions are opaque revocable
tokens.

## Quick start (development)

```bash
npm install
npm run dev        # server on :8080 (tsx watch) + client on :5173 (vite)
```

Open http://localhost:5173, create an account, and you're on the continent.

Useful dev pacing — a whole season in an hour:

```bash
TICK_SECONDS=2 TIDE_INTERVAL_TICKS=60 npm run dev:server
```

## Tests

```bash
npm test           # 210 shared unit tests + 13 server integration tests
node scripts/e2e.mjs   # full gameplay smoke test against a running server
```

The E2E script drives a real server through the entire loop: register → claim → build →
produce → recruit → march → battle (with narrative report) → expedition → contracts →
betrayal → chat.

## Production deployment

### Docker (recommended)

```bash
docker build -t tidehold .
docker run -d -p 8080:8080 -v tidehold-data:/app/data \
  -e TICK_SECONDS=20 -e TIDE_INTERVAL_TICKS=360 tidehold
```

### Bare Node

```bash
npm ci
npm run build              # builds the client into client/dist
NODE_ENV=production npm start
```

The server binds `0.0.0.0:8080` by default and persists to `./data/tidehold.db`
(WAL-mode SQLite, flushed every tick and on shutdown). Put a TLS-terminating proxy
(Caddy, nginx, a PaaS) in front and you're live. All configuration is in
[`.env.example`](.env.example) — season pacing is two environment variables.

### Season pacing cheat-sheet

| Style        | `TICK_SECONDS` | `TIDE_INTERVAL_TICKS` | Season length |
|--------------|---------------:|----------------------:|---------------|
| Demo day     | 20             | 360                    | ~16 hours     |
| One week     | 30             | 2880                   | ~8 days       |
| Classic long | 60             | 10080                  | ~8 weeks      |

After the season ends the world rests for `SEASON_REST_TICKS` (90 ticks), then
regenerates from a new seed automatically. No manual resets.

## Architecture notes

- **Determinism** — worldgen, combat, and expedition loot are pure functions of explicit
  seeds (`shared/`). The same seed always produces the same world, battle, and story,
  which is what makes 210 unit tests possible against "random" systems.
- **Tick engine** — one heartbeat (`server/src/tick.ts`): production → upkeep →
  movement → battles → expeditions → contracts → market → reputation drift → tide →
  persist → broadcast. Everything time-based lives here; HTTP handlers only mutate
  through validated actions.
- **Scouting** — enemy army compositions are fuzzed to size bands unless they're within
  3 hexes of your Ark, armies, or watchtowers. Watchtowers are eyes as well as walls.
- **The market** — an NPC exchange whose prices scale with the tide level (scarcity) and
  drift with player buy/sell pressure. Ports halve fees; oathbreakers pay double.
- **Balance** — every number lives in `shared/src/constants.ts`. Change values there,
  never inline.

### Scaling path

SQLite + a single process comfortably runs one world shard (the design target: a few
hundred concurrent players per shard, one world per shard). To go bigger: move the
document tables behind the same `db.ts` interface onto Postgres, run one shard process
per world, and route players by world id at the proxy. The shared game logic and the
client don't change.

## Project layout

```
shared/src/     types, constants (ALL balance), hex math, seeded RNG,
                worldgen, tide, economy, combat, contracts, expeditions
server/src/     config, db, auth, state, actions (validation), tick, ws, api
client/src/     store (zustand), api client, ws client, canvas renderer,
                HUD + panels (tile/ark/armies/ledger/market/rankings/chronicle)
scripts/        e2e.mjs — live-server gameplay smoke test
DESIGN.md       full design document
```

---

*The sea is patient. You should not be.*
