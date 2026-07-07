/* End-to-end gameplay smoke test against a live TIDEHOLD server. */
const BASE = 'http://localhost:8080';
let failures = 0;

async function call(path, { token, body, method } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. Auth ---------------------------------------------------------------
console.log('AUTH');
const suffix = Math.floor(Math.random() * 100000);
const rA = await call('/api/auth/register', { body: { username: `Maru${suffix}`, password: 'salt-and-oath' } });
check('register A', rA.ok === true && rA.data.token, JSON.stringify(rA));
const rB = await call('/api/auth/register', { body: { username: `Kesh${suffix}`, password: 'salt-and-oath' } });
check('register B', rB.ok === true);
const A = rA.data, B = rB.data;

const dupe = await call('/api/auth/register', { body: { username: `Maru${suffix}`, password: 'xxxxxxxxx' } });
check('duplicate name rejected', dupe.status === 409);
const badLogin = await call('/api/auth/login', { body: { username: `Maru${suffix}`, password: 'wrong-password' } });
check('bad login rejected', badLogin.status === 401);
const weakPw = await call('/api/auth/register', { body: { username: `Weak${suffix}`, password: 'short' } });
check('weak password rejected', weakPw.status === 400);

// --- 2. World --------------------------------------------------------------
console.log('WORLD');
const world = await call('/api/world', { token: A.token });
check('world snapshot', world.ok && world.data.tiles.length > 2000, `tiles=${world.data?.tiles?.length}`);
check('meta present', world.data.meta.tickSeconds > 0);
const me0 = await call('/api/me', { token: A.token });
check('me', me0.ok && me0.data.player.username.startsWith('Maru'));
const ark = me0.data.player.ark;
check('ark on land', (() => {
  const t = world.data.tiles.find((t) => t.q === ark.q && t.r === ark.r);
  return t && !t.flooded;
})());
check('commanders granted', me0.data.player.commanders.length === 2);

// --- 3. Claim & build (validation + happy path) -----------------------------
console.log('TERRITORY');
const tiles = world.data.tiles;
const tileMap = new Map(tiles.map((t) => [`${t.q},${t.r}`, t]));
const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const nearMine = (terr) =>
  tiles.filter(
    (t) => terr.includes(t.terrain) && !t.flooded && !t.ownerId && !t.building && dist(t, ark) <= 4,
  ).sort((a, b) => dist(a, ark) - dist(b, ark));

const farTile = tiles.find((t) => !t.flooded && !t.ownerId && t.terrain === 'plains' && dist(t, ark) > 8);
if (farTile) {
  const tooFar = await call('/api/tile/claim', { token: A.token, body: { q: farTile.q, r: farTile.r } });
  check('claim outside influence rejected', tooFar.status === 400);
}
const oceanTile = tiles.find((t) => t.terrain === 'ocean');
const wet = await call('/api/tile/claim', { token: A.token, body: { q: oceanTile.q, r: oceanTile.r } });
check('claim ocean rejected', wet.status === 400);

const spots = nearMine(['plains', 'coast', 'forest', 'hills', 'mountains']);
check('claimable land near spawn', spots.length >= 3, `found ${spots.length}`);
const claimed = [];
for (const t of spots.slice(0, 3)) {
  const res = await call('/api/tile/claim', { token: A.token, body: { q: t.q, r: t.r } });
  if (res.ok) claimed.push(t);
}
check('claimed 3 tiles', claimed.length === 3);

// Build a farm (or lumber camp) on a suitable claimed tile.
const buildable = claimed.find((t) => ['plains', 'coast'].includes(t.terrain));
let built = false;
if (buildable) {
  const res = await call('/api/tile/build', { token: A.token, body: { q: buildable.q, r: buildable.r, type: 'farm' } });
  built = res.ok === true;
} else {
  const forest = claimed.find((t) => t.terrain === 'forest');
  if (forest) {
    const res = await call('/api/tile/build', { token: A.token, body: { q: forest.q, r: forest.r, type: 'lumber_camp' } });
    built = res.ok === true;
  }
}
check('built production building', built);

const wrongTerrain = claimed.find((t) => t.terrain === 'plains' || t.terrain === 'coast');
if (wrongTerrain && !wrongTerrain.building) {
  const bad = await call('/api/tile/build', { token: A.token, body: { q: wrongTerrain.q, r: wrongTerrain.r, type: 'mine' } });
  check('terrain mismatch rejected', bad.status === 400, JSON.stringify(bad));
}

// Cheating attempts.
const negRecruit = await call('/api/army/recruit', { token: A.token, body: { units: { shields: -5, blades: 0, bows: 0 } } });
check('negative recruit rejected', negRecruit.status === 400);
const hugeTrade = await call('/api/market/trade', { token: A.token, body: { resource: 'timber', amount: 999999999, side: 'buy' } });
check('unaffordable trade rejected', hugeTrade.status === 400);
const noAuth = await call('/api/tile/claim', { body: { q: 0, r: 0 } });
check('unauthenticated action rejected', noAuth.status === 401);

// --- 4. Production over ticks ------------------------------------------------
console.log('ECONOMY');
const before = (await call('/api/me', { token: A.token })).data.player.resources;
await sleep(5000); // ~2+ ticks at 2s
const after = (await call('/api/me', { token: A.token })).data.player.resources;
check('production accrues', after.food > before.food || after.timber > before.timber,
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

const sell = await call('/api/market/trade', { token: A.token, body: { resource: 'food', amount: 10, side: 'sell' } });
check('market sell works', sell.ok === true, JSON.stringify(sell));
const buy = await call('/api/market/trade', { token: A.token, body: { resource: 'ore', amount: 5, side: 'buy' } });
check('market buy works', buy.ok === true, JSON.stringify(buy));

// --- 5. Armies & combat vs garrison -----------------------------------------
console.log('WARFARE');
const rec = await call('/api/army/recruit', { token: A.token, body: { units: { shields: 0, blades: 8, bows: 0 } } });
check('recruit army', rec.ok === true, JSON.stringify(rec));
const armyId = rec.data?.id;

// find nearest garrisoned ruin
const ruins = tiles
  .filter((t) => t.terrain === 'ruins' && (t.garrison ?? 0) > 0)
  .sort((a, b) => dist(a, ark) - dist(b, ark));
check('ruins exist', ruins.length > 0);

// Move next to the ruin, then attack.
if (ruins.length > 0 && armyId) {
  const ruin = ruins[0];
  // premature attack from afar must fail
  if (dist(ark, ruin) > 1) {
    const farAttack = await call('/api/army/attack', { token: A.token, body: { armyId, q: ruin.q, r: ruin.r } });
    check('attack from afar rejected', farAttack.status === 400);
  }
  const mv = await call('/api/army/move', { token: A.token, body: { armyId, q: ruin.q, r: ruin.r } });
  check('army move order accepted', mv.ok === true, JSON.stringify(mv));
  // wait for arrival (2 ticks/hex over land; ruin may be ~5-10 hexes)
  let arrived = false;
  for (let i = 0; i < 40 && !arrived; i++) {
    await sleep(2000);
    const w = await call('/api/world', { token: A.token });
    const army = w.data.armies.find((a) => a.id === armyId);
    if (!army) break;
    if (dist(army, ruin) <= 1) arrived = true;
  }
  check('army marched to ruin', arrived);
  if (arrived) {
    const atk = await call('/api/army/attack', { token: A.token, body: { armyId, q: ruin.q, r: ruin.r } });
    check('attack declared', atk.ok === true, JSON.stringify(atk));
    // battle resolves in BATTLE_PREP_TICKS=3 ticks
    await sleep(9000);
    const w2 = await call('/api/world', { token: A.token });
    const ruinNow = w2.data.tiles.find((t) => t.q === ruin.q && t.r === ruin.r);
    const me2 = await call('/api/me', { token: A.token });
    check('battle resolved (garrison changed or army lost)',
      ruinNow.garrison === 0 || !w2.data.armies.find((a) => a.id === armyId) || me2.data.battleReports.length > 0,
      `garrison=${ruinNow.garrison}`);
    console.log('  battle report:', me2.data.battleReports[0]?.narrative ?? '(none)');
  }
}

// --- 6. Expedition ------------------------------------------------------------
console.log('EXPLORATION');
const wNow = (await call('/api/world', { token: A.token })).data;
const openRuin = wNow.tiles
  .filter((t) => (t.terrain === 'drowned' || (t.terrain === 'ruins' && (t.garrison ?? 0) === 0)) && (t.ruinTier ?? 0) > 0)
  .sort((a, b) => dist(a, ark) - dist(b, ark))[0];
if (openRuin && dist(openRuin, ark) <= 10) {
  // Reprovision after the war effort: buy food/timber from the exchange.
  const meNow = (await call('/api/me', { token: A.token })).data.player;
  if (meNow.resources.food < 35) await call('/api/market/trade', { token: A.token, body: { resource: 'food', amount: 40, side: 'buy' } });
  if (meNow.resources.timber < 15) await call('/api/market/trade', { token: A.token, body: { resource: 'timber', amount: 20, side: 'buy' } });
  const exp = await call('/api/expedition', { token: A.token, body: { q: openRuin.q, r: openRuin.r } });
  check('expedition launched', exp.ok === true, JSON.stringify(exp));
  if (exp.ok) {
    await sleep(24000); // base 4 + up to ~10 ticks travel at 2s/tick
    const meAfter = (await call('/api/me', { token: A.token })).data;
    const gotLoot = meAfter.player.resources.relics > 0 || meAfter.player.techs.length > 0 || meAfter.expeditions.length === 0;
    check('expedition resolved', gotLoot);
  }
} else {
  console.log('  (no reachable open ruin — skipping)');
}

// --- 7. The Ledger --------------------------------------------------------------
console.log('THE LEDGER');
const prop = await call('/api/ledger/propose', {
  token: A.token,
  body: { toId: B.playerId, type: 'trade', terms: { give: { timber: 5 }, receive: { ore: 2 } }, durationTicks: 600 },
});
check('trade proposal', prop.ok === true, JSON.stringify(prop));
const selfProp = await call('/api/ledger/propose', {
  token: A.token,
  body: { toId: A.playerId, type: 'alliance', terms: {}, durationTicks: 600 },
});
check('self-contract rejected', selfProp.status === 400);
if (prop.ok) {
  const respond = await call('/api/ledger/respond', { token: B.token, body: { contractId: prop.data.id, accept: true } });
  check('one-time trade executes on accept', respond.ok === true && respond.data.status === 'completed', JSON.stringify(respond));
}
const nap = await call('/api/ledger/propose', {
  token: A.token,
  body: { toId: B.playerId, type: 'non_aggression', terms: {}, durationTicks: 600 },
});
check('NAP proposal', nap.ok === true);
if (nap.ok) {
  await call('/api/ledger/respond', { token: B.token, body: { contractId: nap.data.id, accept: true } });
  const meA1 = (await call('/api/me', { token: A.token })).data.player;
  // A attacks B's ark → should break NAP and cost reputation. March adjacent first — just verify declaration-time rep logic via direct attack if adjacent; otherwise verify cancel path.
  const cancel = await call('/api/ledger/cancel', {
    token: A.token,
    body: { contractId: nap.data.id },
  });
  const meA2 = (await call('/api/me', { token: A.token })).data.player;
  check('breaking NAP costs 30 rep', cancel.ok === true && Math.round(meA1.reputation - meA2.reputation) === 30,
    `${meA1.reputation} -> ${meA2.reputation}`);
}

// --- 8. Events, rankings, chat ---------------------------------------------------
console.log('SOCIAL');
const events = await call('/api/events', { token: A.token });
check('events feed', events.ok && events.data.length > 0);
const rank = await call('/api/rankings', { token: A.token });
check('rankings', rank.ok && rank.data.length >= 2);
const chat = await call('/api/chat', { token: A.token, body: { message: 'The sea is patient. I am not.' } });
check('chat send', chat.ok === true);
const chatLog = await call('/api/chat', { token: A.token });
check('chat history', chatLog.ok && chatLog.data.some((m) => m.message.includes('patient')));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
