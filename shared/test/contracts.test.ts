import { describe, expect, it } from 'vitest';
import {
  attackConsequences,
  clampReputation,
  contractExchangeApplied,
  createProposal,
  dueExchanges,
  expireContracts,
  hasActiveContract,
  isOathbreaker,
  validateProposal,
} from '../src/contracts.js';
import {
  CONTRACT_MIN_DURATION_TICKS,
  CONTRACT_PROPOSAL_TTL_TICKS,
  MAX_REPUTATION,
  OATHBREAKER_THRESHOLD,
  REP_ATTACK_ALLY,
  REP_BREAK_CONTRACT,
  REP_PUNISH_OATHBREAKER,
  REP_UNPROVOKED_ATTACK,
} from '../src/constants.js';
import type { Contract, ContractTerms, PlayerState } from '../src/types.js';

const terms = (t: Partial<ContractTerms> = {}): ContractTerms => ({ give: {}, receive: {}, ...t });

function contract(partial: Partial<Contract>): Contract {
  return {
    id: 'c1',
    type: 'trade',
    fromId: 'a',
    toId: 'b',
    status: 'active',
    terms: terms(),
    createdTick: 0,
    expiresTick: 1000,
    ...partial,
  };
}

function player(rep: number): PlayerState {
  return { reputation: rep } as PlayerState;
}

describe('reputation helpers', () => {
  it('clamps into [0, MAX_REPUTATION] and handles NaN', () => {
    expect(clampReputation(-5)).toBe(0);
    expect(clampReputation(500)).toBe(MAX_REPUTATION);
    expect(clampReputation(123)).toBe(123);
    expect(clampReputation(NaN)).toBe(0);
  });

  it('oathbreaker threshold is strict', () => {
    expect(isOathbreaker(player(OATHBREAKER_THRESHOLD))).toBe(false);
    expect(isOathbreaker(player(OATHBREAKER_THRESHOLD - 1))).toBe(true);
  });
});

describe('validateProposal', () => {
  const dur = CONTRACT_MIN_DURATION_TICKS;

  it('rejects self-contracts, bad types, bad durations', () => {
    expect(validateProposal('trade', 'a', 'a', terms({ give: { timber: 1 } }), dur, false)).toBeTruthy();
    expect(validateProposal('bogus' as never, 'a', 'b', terms(), dur, false)).toBeTruthy();
    expect(validateProposal('alliance', 'a', 'b', terms(), dur - 1, false)).toBeTruthy();
    expect(validateProposal('alliance', 'a', 'b', terms(), 999999, false)).toBeTruthy();
  });

  it('pacts must not carry resources; trades must carry some', () => {
    expect(validateProposal('alliance', 'a', 'b', terms(), dur, false)).toBeNull();
    expect(validateProposal('alliance', 'a', 'b', terms({ give: { ore: 5 } }), dur, false)).toBeTruthy();
    expect(validateProposal('non_aggression', 'a', 'b', terms(), dur, false)).toBeNull();
    expect(validateProposal('trade', 'a', 'b', terms(), dur, false)).toBeTruthy();
    expect(validateProposal('trade', 'a', 'b', terms({ give: { timber: 10 } }), dur, false)).toBeNull();
  });

  it('rejects non-integer or negative amounts', () => {
    expect(validateProposal('trade', 'a', 'b', terms({ give: { timber: -1 } }), dur, false)).toBeTruthy();
    expect(validateProposal('trade', 'a', 'b', terms({ give: { timber: 1.5 } }), dur, false)).toBeTruthy();
  });

  it('tribute flows one way and needs an interval', () => {
    const oneWay = terms({ give: { food: 20 }, intervalTicks: 50 });
    expect(validateProposal('tribute', 'a', 'b', oneWay, dur, false)).toBeNull();
    expect(validateProposal('tribute', 'a', 'b', terms({ give: { food: 20 } }), dur, false)).toBeTruthy();
    expect(
      validateProposal('tribute', 'a', 'b', terms({ give: { food: 1 }, receive: { ore: 1 }, intervalTicks: 50 }), dur, false),
    ).toBeTruthy();
  });

  it('ransom needs a commander actually held captive', () => {
    const t = terms({ give: { relics: 2 }, commanderId: 'cm1' });
    expect(validateProposal('ransom', 'a', 'b', t, dur, true)).toBeNull();
    expect(validateProposal('ransom', 'a', 'b', t, dur, false)).toBeTruthy();
    expect(validateProposal('ransom', 'a', 'b', terms({ give: { relics: 2 } }), dur, true)).toBeTruthy();
  });
});

describe('lifecycle', () => {
  it('createProposal deep-copies terms and sets recurring due tick', () => {
    const t = terms({ give: { timber: 5 }, intervalTicks: 60 });
    const c = createProposal('id1', 'trade', 'a', 'b', t, 100, 600);
    expect(c.status).toBe('proposed');
    expect(c.expiresTick).toBe(700);
    expect(c.nextDueTick).toBe(160);
    t.give!.timber = 999;
    expect(c.terms.give!.timber).toBe(5);
  });

  it('hasActiveContract matches either direction, active only', () => {
    const cs = [contract({ type: 'alliance', status: 'active' })];
    expect(hasActiveContract(cs, 'b', 'a', ['alliance'])).toBe(true);
    expect(hasActiveContract(cs, 'a', 'c', ['alliance'])).toBe(false);
    expect(hasActiveContract([contract({ type: 'alliance', status: 'broken' })], 'a', 'b', ['alliance'])).toBe(false);
  });

  it('dueExchanges + contractExchangeApplied advance the cycle', () => {
    const c = contract({ status: 'active', terms: terms({ give: { ore: 5 }, intervalTicks: 50 }), nextDueTick: 100 });
    expect(dueExchanges([c], 99)).toHaveLength(0);
    expect(dueExchanges([c], 100)).toHaveLength(1);
    contractExchangeApplied(c, 100);
    expect(c.nextDueTick).toBe(150);
  });

  it('expireContracts handles proposal TTL and active expiry', () => {
    const proposal = contract({ status: 'proposed', createdTick: 0 });
    const active = contract({ id: 'c2', status: 'active', expiresTick: 500 });
    const changed = expireContracts([proposal, active], CONTRACT_PROPOSAL_TTL_TICKS + 1);
    expect(changed).toContain(proposal);
    expect(proposal.status).not.toBe('proposed');
    expect(active.status).toBe('active');
    expireContracts([active], 501);
    expect(active.status).toBe('expired');
  });
});

describe('attackConsequences — the heart of The Ledger', () => {
  it('unprovoked attack: small rep hit', () => {
    const { broken, repDelta } = attackConsequences([], 'a', 'b', false);
    expect(broken).toHaveLength(0);
    expect(repDelta).toBe(REP_UNPROVOKED_ATTACK);
  });

  it('punishing an oathbreaker pays', () => {
    const { repDelta } = attackConsequences([], 'a', 'b', true);
    expect(repDelta).toBe(REP_PUNISH_OATHBREAKER);
  });

  it('attacking an ally is the deepest betrayal', () => {
    const cs = [contract({ type: 'alliance', status: 'active' })];
    const { broken, repDelta } = attackConsequences(cs, 'a', 'b', false);
    expect(broken).toHaveLength(1);
    expect(repDelta).toBe(REP_ATTACK_ALLY);
  });

  it('stacks multiple broken pacts; trade contracts survive attacks', () => {
    const cs = [
      contract({ id: 'x', type: 'non_aggression', status: 'active' }),
      contract({ id: 'y', type: 'tribute', status: 'active' }),
      contract({ id: 'z', type: 'trade', status: 'active' }),
    ];
    const { broken, repDelta } = attackConsequences(cs, 'a', 'b', false);
    expect(broken.map((c) => c.id).sort()).toEqual(['x', 'y']);
    expect(repDelta).toBe(REP_BREAK_CONTRACT * 2);
  });

  it('does not mutate contract status (pure query)', () => {
    const c = contract({ type: 'alliance', status: 'active' });
    attackConsequences([c], 'a', 'b', false);
    expect(c.status).toBe('active');
  });
});
