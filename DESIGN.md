# TIDEHOLD — Design & Architecture

A multiplayer browser strategy game where **the world itself is the enemy**: the
continent is drowning, level by level, and every civilization must migrate or die.

## The core loop

1. **Settle** — claim tiles near your Ark, build production (lumber camps, mines, farms).
2. **Watch the water** — every tile shows when the Tide will take it. Rich land lies low.
3. **Expand or prepare** — exploit doomed lowlands hard, or invest in high ground early.
4. **Fight, trade, swear oaths** — armies with counter-triangle composition and a
   preparation window; a dynamic market whose prices climb with the Tide; The Ledger,
   where contracts are public and betrayal brands you an Oathbreaker.
5. **Migrate** — move your Ark upslope, rebuild, raid the drowned ruins of what was lost.
6. **Endgame** — the last peaks, final wars, and a season scoreboard measured in
   relics banked at shrines, battles won, oaths kept, and land that survived.

## Design pillars

- **Time creates conflict.** The map shrinks; players are forced into contact.
- **Defeat matters, elimination doesn't.** The Ark cannot be destroyed — cargo can be
  plundered, modules damaged, commanders captured, but you always sail on.
- **No click-speed.** Battles resolve after a 3-tick preparation window; the defender
  can reinforce or evacuate. Composition, terrain, towers, and commanders decide.
- **Every building has a purpose.** Six buildings, no filler.
- **Rich land drowns first.** Richness is biased toward low elevation — greed is a bet
  against the sea.

## Architecture

```
shared/   Pure, deterministic game logic + canonical types & balance constants.
          No I/O, no Date.now(), no Math.random() — all randomness is seeded.
server/   Fastify + better-sqlite3 + ws. Owns ALL state mutation. The tick loop
          (production → upkeep → movement → battles → expeditions → contracts →
          market → tide) runs server-side; clients only send intents.
client/   React + Vite + zustand + a Canvas hex renderer. Beautiful, mobile-capable.
```

Module contracts live as documented stubs in `shared/src/*.ts`; balance numbers only
in `shared/src/constants.ts`. Server API is REST for actions + WebSocket for pushes
(`snapshot` deltas, events, battle reports).

### Key rules the server enforces (never trust the client)

- All costs checked & deducted atomically server-side; all coordinates validated.
- Build only on legal terrain, within Ark influence, on owned/claimable tiles.
- Attacks route through `attackConsequences` — breaking Ledger contracts costs
  reputation; oathbreakers (< 60 rep) pay doubled market fees and are fair game.
- Battles/expeditions resolve on schedule inside the tick loop with server seeds.
- Rate limits on auth and chat-adjacent endpoints; scrypt password hashing;
  opaque session tokens.

### Determinism

Worldgen, combat, and expedition loot are pure functions of explicit seeds so the
whole game state can be reproduced and unit-tested. The server derives per-event
seeds as `hash2(entityCounter, tick, worldSeed)`.
