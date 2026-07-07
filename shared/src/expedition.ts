/**
 * Exploration — expeditions into ruins and the drowned world.
 * Deterministic given a seed. Every expedition should read like a story beat.
 */
import type { ExpeditionOutcome, PlayerState, Resources, Tile } from './types.js';
import {
  EXPEDITION_BASE_TICKS,
  EXPEDITION_RELICS_BY_TIER,
  EXPEDITION_TECH_CHANCE,
  EXPEDITION_TICKS_PER_HEX,
  SCORE_EXPEDITION,
  TECHS,
} from './constants.js';
import { rng } from './rng.js';

/** Speed multiplier granted by the star_charts tech. */
const STAR_CHARTS_SPEED = 0.7;
/** Relics granted instead of a duplicate/exhausted tech discovery. */
const ALL_TECHS_KNOWN_RELIC_BONUS = 2;
/** Salvage per tier: modest resource bonus ranges [min, max] per resource. */
const SALVAGE_BY_TIER: { timber: [number, number]; ore: [number, number]; food: [number, number] }[] = [
  { timber: [0, 10], ore: [0, 8], food: [0, 10] },
  { timber: [5, 20], ore: [4, 16], food: [5, 18] },
  { timber: [12, 35], ore: [10, 30], food: [10, 30] },
];

/**
 * Travel time in ticks: EXPEDITION_BASE_TICKS + distance × EXPEDITION_TICKS_PER_HEX,
 * ×0.7 (rounded up) if the owner has 'star_charts'.
 */
export function expeditionDuration(distance: number, owner: PlayerState): number {
  const d = Math.max(0, distance);
  let ticks = EXPEDITION_BASE_TICKS + d * EXPEDITION_TICKS_PER_HEX;
  if (owner.techs.includes('star_charts')) ticks = Math.ceil(ticks * STAR_CHARTS_SPEED);
  return Math.max(1, Math.ceil(ticks));
}

// ---------------------------------------------------------------------------
// Story templates. {relics} is replaced with the relic count found.
// ---------------------------------------------------------------------------

const SUNKEN_STORIES = [
  'Divers followed a stair that spiraled down into green dark, and came up gasping with {relics} relics wrapped in oilcloth.',
  'Beneath the surface, a drowned bell tower still swayed with the current. In its crypt: {relics} relics of the old world.',
  'The rope came up heavy. Silt, bones, and {relics} relics — and no diver would say what they saw down there.',
  'A shoal of silver fish parted to reveal a sunken archive. {relics} relics were saved before the ink of ages dissolved.',
  'Your crew worked by lamplight above the flooded streets, hauling up {relics} relics as something large circled below.',
  'The drowned market square kept its last secrets in a bronze chest — {relics} relics, cold as the deep.',
  'Half a temple, upside down in the murk. The offering bowls still held {relics} relics, untouched by the sea.',
  'An eel had made its home in the vault. The divers made quick work anyway: {relics} relics for the hold.',
];

const SURFACE_STORIES = [
  'The ruins stood silent but for gulls. Under a fallen lintel your explorers pried loose {relics} relics.',
  'Wind through empty windows sounded like voices. Your crew left offerings, and left with {relics} relics.',
  'A collapsed watchhall, a skeleton at its post. Beside it, a strongbox with {relics} relics — duty kept to the end.',
  'Carvings above the gate warned of the rising water. Whoever built this place knew. They left {relics} relics behind.',
  'Your explorers camped in the shadow of the old walls and dug until dawn: {relics} relics from the dry earth.',
  'A cistern, long dry, hid a smuggler\'s cache: {relics} relics and the stub of a candle burned centuries ago.',
  'The mosaic floor showed a flood swallowing a city — a memory, or a prophecy. Beneath it lay {relics} relics.',
  'Someone had been here first, long ago, and missed the false wall. Behind it: {relics} relics.',
];

const TECH_STORIES: Record<string, string> = {
  deep_saws: 'Among the wreckage: saw-blades of a metal that never dulls. Your lumber camps will sing a new song.',
  fire_hardening: 'A forge-master\'s journal, legible after all these years. Its secrets harden your ore works.',
  tide_terraces: 'Diagrams of stepped fields that drink the flood instead of drowning. Your farms learn from the dead.',
  star_charts: 'A sealed tube of star charts, drawn for seas that did not exist yet. Your expeditions will run swifter.',
  drowned_tongue: 'A stone that hums when spoken to. Your divers begin to understand what the drowned are saying.',
  hull_lore: 'Ship-plans of the old world, annotated in a steady hand. Your Ark will move lighter for it.',
};

/**
 * Resolve an expedition against `tile` (terrain 'ruins' or 'drowned').
 * See stub spec: relic yield by tier (+drowned_tongue bonus), seeded salvage,
 * tech chance by tier (never duplicates; converts to relics when all known),
 * SCORE_EXPEDITION score, deterministic story.
 */
export function resolveExpedition(
  tile: Tile,
  tier: number,
  owner: PlayerState,
  seed: number,
): ExpeditionOutcome {
  const t = Math.min(Math.max(1, Math.floor(tier)), EXPEDITION_RELICS_BY_TIER.length);
  const r = rng(seed);

  // 1. Relics.
  const [minR, maxR] = EXPEDITION_RELICS_BY_TIER[t - 1];
  let relics = r.int(minR, maxR);
  if (owner.techs.includes('drowned_tongue')) relics += 1;

  // 2. Salvage.
  const salvage = SALVAGE_BY_TIER[t - 1];
  const loot: Partial<Resources> = {
    relics,
    timber: r.int(salvage.timber[0], salvage.timber[1]),
    ore: r.int(salvage.ore[0], salvage.ore[1]),
    food: r.int(salvage.food[0], salvage.food[1]),
  };

  // 3. Tech discovery.
  let tech: string | undefined;
  if (r.chance(EXPEDITION_TECH_CHANCE[t - 1])) {
    const unknown = Object.keys(TECHS).filter((id) => !owner.techs.includes(id));
    if (unknown.length > 0) {
      tech = unknown[r.int(0, unknown.length - 1)];
    } else {
      loot.relics = (loot.relics ?? 0) + ALL_TECHS_KNOWN_RELIC_BONUS;
      relics += ALL_TECHS_KNOWN_RELIC_BONUS;
    }
  }

  // 4. Story.
  const pool = tile.terrain === 'drowned' ? SUNKEN_STORIES : SURFACE_STORIES;
  let story = pool[r.int(0, pool.length - 1)].replace('{relics}', String(relics));
  if (tech) story += ` ${TECH_STORIES[tech] ?? 'And something stranger besides.'}`;

  return { loot, tech, story, scoreGained: SCORE_EXPEDITION };
}
