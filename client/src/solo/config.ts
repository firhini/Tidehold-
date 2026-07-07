/**
 * TIDEHOLD SOLO — balance for the single-player flood-survival roguelite.
 * A run is a race against the sea: ~6–12 minutes, deterministic from a seed.
 */
import type { CommanderTrait, Resources, ResourceType } from '@tidehold/shared';

// --- Run cadence ------------------------------------------------------------
/** Real milliseconds per game tick (the run heartbeat). */
export const SOLO_TICK_MS = 850;
/** Ticks between tide rises. 9 rises drown the world. */
export const SOLO_TIDE_INTERVAL = 52;
/** First tide rise lands here — a visible flood inside ~25 seconds. */
export const SOLO_FIRST_TIDE_TICK = 30;
/** Smaller, more intimate map than multiplayer: faster, sharper pressure. */
export const SOLO_WORLD_RADIUS = 15;
/** Number of AI rival Arks contesting the shrinking land. */
export const SOLO_AI_COUNT = 3;
/** Tide level at which the season/run ends (peaks may outlast it). */
export const SOLO_SEASON_END_TIDE = 8;

// --- Player start (before meta bonuses) -------------------------------------
export const SOLO_START_RESOURCES: Resources = { timber: 150, ore: 110, food: 170, relics: 3 };
export const SOLO_START_SHELLS = 0;

// --- Scoring ----------------------------------------------------------------
export const SCORE_PER_TIDE_LEVEL = 120; // survival is the point
export const SCORE_SURVIVAL_PER_TICK = 0.5;
export const SCORE_PLACEMENT_BONUS = [500, 250, 100, 0]; // 1st..4th of the field
/** Salvage (meta currency) earned from a run. */
export const SALVAGE_PER_100_SCORE = 6;
export const SALVAGE_PER_TIDE_LEVEL = 5;

// --- Guaranteed first reward ------------------------------------------------
/** Relics granted the first time the player claims their glowing start tile. */
export const FIRST_CLAIM_SALVAGE_RELICS = 4;

// --- Meta progression: permanent upgrades bought with Salvage ----------------
export interface UpgradeSpec {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** How the engine applies it at run start. */
  effect:
    | { kind: 'resources'; add: Partial<Resources> }
    | { kind: 'arkHp'; add: number }
    | { kind: 'arkSpeed'; cooldownReduction: number }
    | { kind: 'tech'; tech: string }
    | { kind: 'startBuildings' }
    | { kind: 'startArmy'; blades: number };
}

export const UPGRADES: UpgradeSpec[] = [
  { id: 'stores', name: 'Deep Stores', description: '+80 timber, +60 ore, +80 food at the start of every run.', cost: 60,
    effect: { kind: 'resources', add: { timber: 80, ore: 60, food: 80 } } },
  { id: 'hull', name: 'Reinforced Hull', description: 'Your Ark begins with +60 maximum hull.', cost: 90,
    effect: { kind: 'arkHp', add: 60 } },
  { id: 'engines', name: 'Tide Engines', description: 'The Ark relocates 3 ticks sooner between moves.', cost: 110,
    effect: { kind: 'arkSpeed', cooldownReduction: 3 } },
  { id: 'charts', name: 'Star Charts', description: 'Expeditions travel 30% faster, every run.', cost: 120,
    effect: { kind: 'tech', tech: 'star_charts' } },
  { id: 'tongue', name: 'The Drowned Tongue', description: '+1 relic from every expedition.', cost: 130,
    effect: { kind: 'tech', tech: 'drowned_tongue' } },
  { id: 'founders', name: "Founder's Cache", description: 'Begin each run with a Farm and a Lumber Camp already raised.', cost: 170,
    effect: { kind: 'startBuildings' } },
  { id: 'vanguard', name: 'Vanguard', description: 'Muster with 8 Bladesworn at your Ark.', cost: 150,
    effect: { kind: 'startArmy', blades: 8 } },
];

// --- Commanders you can lead a run with (unlockable) ------------------------
export interface CommanderSpec {
  id: string;
  name: string;
  trait: CommanderTrait;
  description: string;
  cost: number; // 0 = unlocked by default
}

export const COMMANDERS: CommanderSpec[] = [
  { id: 'maren', name: 'Maren the Steady', trait: 'bulwark', description: '+12% defense per level when holding ground.', cost: 0 },
  { id: 'kael', name: 'Kael Ironwake', trait: 'aggression', description: '+12% attack per level on the assault.', cost: 90 },
  { id: 'sig', name: 'Signe Far-Sail', trait: 'logistics', description: 'Armies march 25% faster.', cost: 90 },
];

// --- Cosmetic skins (Ark hull + map palette) --------------------------------
export interface SkinSpec {
  id: string;
  name: string;
  cost: number;
  /** Ark ring / hull accent color. */
  ark: string;
  /** Optional world tint overlay (rgba) for map-palette skins. */
  worldTint?: string;
}

export const SKINS: SkinSpec[] = [
  { id: 'brass', name: 'Brass Hull', cost: 0, ark: '#e0b64f' },
  { id: 'blackwater', name: 'Blackwater', cost: 70, ark: '#7fd7e8' },
  { id: 'ember', name: 'Ember Tide', cost: 120, ark: '#ff8d5a', worldTint: 'rgba(120,40,20,0.14)' },
  { id: 'frost', name: 'Frostfall', cost: 120, ark: '#bfe6ff', worldTint: 'rgba(120,180,220,0.14)' },
];

// --- Monetization pacing ----------------------------------------------------
/** Show one interstitial every Nth run start (from game-over). */
export const INTERSTITIAL_EVERY_N_RUNS = 2;
/** How far a "hold back the tide" reward pushes the next rise (ticks). */
export const HOLD_TIDE_TICKS = 26;
/** Ark hull restored on a rewarded continue-after-defeat. */
export const CONTINUE_ARK_HP = 120;

// --- localStorage keys ------------------------------------------------------
export const LS_META = 'tidehold_solo_meta_v1';
export const LS_RUN = 'tidehold_solo_run_v1';
export const LS_DAILY = 'tidehold_solo_daily_v1';

export const SOLO_RESOURCE_ORDER: ResourceType[] = ['timber', 'ore', 'food', 'relics'];
