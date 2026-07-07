/**
 * Headless smoke test for the solo engine: run full games from several seeds,
 * with the AI active, and assert they terminate with a sane result and no
 * exceptions. Validates the client-side game loop without any DOM/UI.
 *
 *   npx tsx scripts/solo-smoke.mts
 */
import { createRun, tick, runStats, salvageFor, human } from '../client/src/solo/engine.ts';
import type { MetaState } from '../client/src/solo/types.ts';

function meta(upgrades: string[] = []): MetaState {
  return {
    version: 1,
    salvage: 0,
    upgrades,
    commanders: ['maren'],
    skins: ['brass'],
    selectedCommander: 'maren',
    selectedSkin: 'brass',
    bestScore: 0,
    bestTide: 0,
    runsPlayed: 0,
    runsSinceInterstitial: 0,
    dailyDone: {},
  };
}

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : ' ' + extra}`);
  if (!cond) failures++;
}

const seeds = [1, 42, 421337, 999983, 7, 2024];
for (const seed of seeds) {
  const m = meta(seed % 2 === 0 ? ['stores', 'hull', 'vanguard', 'founders'] : []);
  const a = createRun(seed, m);
  // Determinism: an identical run should tick identically.
  const b = createRun(seed, m);

  let ticks = 0;
  while (!a.ended && ticks < 2000) {
    tick(a, m);
    tick(b, m);
    ticks++;
  }
  const sa = runStats(a);
  const you = human(a);

  console.log(`seed ${seed}:`);
  check('run terminated', a.ended, `(ran ${ticks} ticks)`);
  check('reached an outcome', a.outcome !== null);
  check('tide advanced', a.meta.tideLevel >= 1, `tide=${a.meta.tideLevel}`);
  check('score is finite & >= 0', Number.isFinite(you.score) && you.score >= 0, `score=${you.score}`);
  check('placement within field', sa.placement >= 1 && sa.placement <= sa.fieldSize, `#${sa.placement}/${sa.fieldSize}`);
  check('salvage computes', Number.isFinite(salvageFor(you.score, a.meta.tideLevel)));
  check(
    'deterministic (a === b end state)',
    a.meta.tick === b.meta.tick && Math.round(human(a).score) === Math.round(human(b).score) && a.outcome === b.outcome,
    `a(t${a.meta.tick},s${Math.round(human(a).score)},${a.outcome}) b(t${b.meta.tick},s${Math.round(human(b).score)},${b.outcome})`,
  );
  console.log(`   → outcome=${a.outcome} tide=${a.meta.tideLevel}/8 score=${Math.round(you.score)} placement=#${sa.placement}/${sa.fieldSize} ticks=${ticks}`);
}

console.log(failures === 0 ? '\nENGINE SMOKE: ALL PASSED' : `\nENGINE SMOKE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
