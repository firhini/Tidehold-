/**
 * Ad adapter. One tiny interface, three backends:
 *  - CrazyGames SDK (window.CrazyGames) when hosted there
 *  - GameDistribution (window.gdsdk) when hosted there
 *  - a built-in mock (a 2s simulated ad) everywhere else, so the game is fully
 *    playable in dev and on any host without an SDK.
 *
 * The mock renders through the store (see AdModal); this module just resolves.
 */

type MockRunner = (kind: 'rewarded' | 'interstitial') => Promise<boolean>;

let mockRunner: MockRunner | null = null;

/** The UI registers a renderer so mock ads show a real modal. */
export function registerMockAdRunner(fn: MockRunner): void {
  mockRunner = fn;
}

interface CrazyAds {
  requestAd: (
    type: 'rewarded' | 'midgame',
    callbacks: { adFinished?: () => void; adError?: (e: unknown) => void; adStarted?: () => void },
  ) => void;
}

function crazy(): CrazyAds | null {
  const w = window as unknown as { CrazyGames?: { SDK?: { ad?: CrazyAds } } };
  return w.CrazyGames?.SDK?.ad ?? null;
}

interface GdSdk {
  showAd: (type?: string) => Promise<void>;
  preloadAd?: (type?: string) => Promise<void>;
}
function gd(): GdSdk | null {
  const w = window as unknown as { gdsdk?: GdSdk };
  return w.gdsdk ?? null;
}

/**
 * Show a rewarded ad. Resolves true if the reward should be granted
 * (ad completed) and false if it was skipped/errored (reward denied).
 */
export async function showRewarded(): Promise<boolean> {
  const cg = crazy();
  if (cg) {
    return new Promise<boolean>((resolve) => {
      cg.requestAd('rewarded', {
        adFinished: () => resolve(true),
        adError: () => resolve(false),
      });
    });
  }
  const g = gd();
  if (g) {
    try {
      await g.showAd('rewarded');
      return true;
    } catch {
      return false;
    }
  }
  if (mockRunner) return mockRunner('rewarded');
  return true; // no adapter at all → grant (dev convenience)
}

/** Show an interstitial (no reward, just a break). Always resolves. */
export async function showInterstitial(): Promise<void> {
  const cg = crazy();
  if (cg) {
    await new Promise<void>((resolve) => {
      cg.requestAd('midgame', { adFinished: () => resolve(), adError: () => resolve() });
    });
    return;
  }
  const g = gd();
  if (g) {
    try {
      await g.showAd();
    } catch {
      /* ignore */
    }
    return;
  }
  if (mockRunner) {
    await mockRunner('interstitial');
  }
}

/** Best-effort signals some portals reward (gameplay start/stop). Safe no-ops otherwise. */
export function gameplayStart(): void {
  const w = window as unknown as { CrazyGames?: { SDK?: { game?: { gameplayStart?: () => void } } } };
  w.CrazyGames?.SDK?.game?.gameplayStart?.();
}
export function gameplayStop(): void {
  const w = window as unknown as { CrazyGames?: { SDK?: { game?: { gameplayStop?: () => void } } } };
  w.CrazyGames?.SDK?.game?.gameplayStop?.();
}
