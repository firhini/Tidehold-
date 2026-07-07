import { describe, expect, it } from 'vitest';
import { expeditionDuration, resolveExpedition } from '../src/expedition.js';
import {
  EXPEDITION_BASE_TICKS,
  EXPEDITION_RELICS_BY_TIER,
  EXPEDITION_TICKS_PER_HEX,
  SCORE_EXPEDITION,
  TECHS,
} from '../src/constants.js';
import type { PlayerState, Tile } from '../src/types.js';

function owner(techs: string[] = []): PlayerState {
  return { techs } as PlayerState;
}

function ruin(terrain: 'ruins' | 'drowned' = 'ruins', tier = 1): Tile {
  return { q: 0, r: 0, elevation: 3, terrain, flooded: terrain === 'drowned', richness: 1, ruinTier: tier };
}

describe('expeditionDuration', () => {
  it('scales with distance', () => {
    expect(expeditionDuration(0, owner())).toBe(EXPEDITION_BASE_TICKS);
    expect(expeditionDuration(6, owner())).toBe(EXPEDITION_BASE_TICKS + 6 * EXPEDITION_TICKS_PER_HEX);
  });

  it('star charts speed travel by 30%', () => {
    const slow = expeditionDuration(10, owner());
    const fast = expeditionDuration(10, owner(['star_charts']));
    expect(fast).toBe(Math.ceil(slow * 0.7));
  });

  it('never returns less than one tick', () => {
    expect(expeditionDuration(-5, owner(['star_charts']))).toBeGreaterThanOrEqual(1);
  });
});

describe('resolveExpedition', () => {
  it('is deterministic for a given seed', () => {
    const a = resolveExpedition(ruin(), 2, owner(), 12345);
    const b = resolveExpedition(ruin(), 2, owner(), 12345);
    expect(a).toEqual(b);
  });

  it('relic yield stays within the tier range', () => {
    for (let tier = 1; tier <= 3; tier++) {
      const [min, max] = EXPEDITION_RELICS_BY_TIER[tier - 1];
      for (let seed = 1; seed <= 60; seed++) {
        const out = resolveExpedition(ruin('ruins', tier), tier, owner(), seed);
        // Techs (all-known fallback) can add, drowned_tongue not present here.
        expect(out.loot.relics!).toBeGreaterThanOrEqual(min);
        expect(out.loot.relics!).toBeLessThanOrEqual(max + 2);
        expect(out.scoreGained).toBe(SCORE_EXPEDITION);
        expect(out.story.length).toBeGreaterThan(20);
      }
    }
  });

  it('drowned_tongue adds a relic', () => {
    const base = resolveExpedition(ruin(), 1, owner(), 777);
    const blessed = resolveExpedition(ruin(), 1, owner(['drowned_tongue']), 777);
    expect(blessed.loot.relics!).toBe(base.loot.relics! + 1);
  });

  it('never grants a duplicate tech; all-known converts to relics', () => {
    const allTechs = Object.keys(TECHS);
    for (let seed = 1; seed <= 200; seed++) {
      const out = resolveExpedition(ruin('ruins', 3), 3, owner(['deep_saws']), seed);
      if (out.tech) expect(out.tech).not.toBe('deep_saws');
      const full = resolveExpedition(ruin('ruins', 3), 3, owner(allTechs), seed);
      expect(full.tech).toBeUndefined();
    }
  });

  it('higher tiers can find techs; stories differ by terrain', () => {
    let techsFound = 0;
    const sunkenStories = new Set<string>();
    const surfaceStories = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const out = resolveExpedition(ruin('ruins', 3), 3, owner(), seed);
      if (out.tech) techsFound++;
      surfaceStories.add(resolveExpedition(ruin('ruins', 1), 1, owner(), seed).story);
      sunkenStories.add(resolveExpedition(ruin('drowned', 1), 1, owner(), seed).story);
    }
    expect(techsFound).toBeGreaterThan(10); // ~30% of 120
    // Different template pools produce disjoint narrative voices.
    for (const s of sunkenStories) expect([...surfaceStories]).not.toContain(s);
  });

  it('clamps degenerate tier inputs', () => {
    expect(() => resolveExpedition(ruin('ruins', 0), 0, owner(), 5)).not.toThrow();
    expect(() => resolveExpedition(ruin('ruins', 9), 9, owner(), 5)).not.toThrow();
  });
});
