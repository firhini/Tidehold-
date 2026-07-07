/**
 * The Ledger — contracts, reputation, and consequence.
 * Pure helpers; the server owns persistence and resource transfer.
 */
import type { Contract, ContractTerms, ContractType, PlayerState } from './types.js';

export function isOathbreaker(player: PlayerState): boolean {
  throw new Error('unimplemented'); // reputation < OATHBREAKER_THRESHOLD
}

/** Clamp reputation into [0, MAX_REPUTATION]. */
export function clampReputation(rep: number): number {
  throw new Error('unimplemented');
}

/**
 * Validate a proposal. Returns an error string or null if valid.
 * Rules:
 * - type must be a known ContractType; fromId !== toId.
 * - durationTicks within [CONTRACT_MIN_DURATION_TICKS, CONTRACT_MAX_DURATION_TICKS].
 * - trade: at least one of give/receive non-empty; all amounts positive
 *   integers; intervalTicks (if present) >= 10.
 * - ransom: terms.commanderId required; must be a commander of `to` captured
 *   by `from`... (the server passes `captorHoldsCommander` after checking).
 * - alliance/non_aggression: give/receive must be empty.
 * - tribute: exactly one direction (give XOR receive non-empty), intervalTicks required.
 */
export function validateProposal(
  type: ContractType,
  fromId: string,
  toId: string,
  terms: ContractTerms,
  durationTicks: number,
  captorHoldsCommander: boolean,
): string | null {
  throw new Error('unimplemented');
}

/** Construct a Contract in 'proposed' status. */
export function createProposal(
  id: string,
  type: ContractType,
  fromId: string,
  toId: string,
  terms: ContractTerms,
  tick: number,
  durationTicks: number,
): Contract {
  throw new Error('unimplemented');
}

/** Do these two players share an active contract of one of the given types? */
export function hasActiveContract(
  contracts: Contract[],
  a: string,
  b: string,
  types: ContractType[],
): boolean {
  throw new Error('unimplemented');
}

/**
 * Consequence of `attackerId` attacking `defenderId` given active contracts.
 * Returns the contracts broken by this attack (alliance/non_aggression/tribute
 * between the two) and the total reputation delta for the attacker:
 * - each broken alliance: REP_ATTACK_ALLY
 * - each other broken contract: REP_BREAK_CONTRACT
 * - if nothing broken: REP_UNPROVOKED_ATTACK (or REP_PUNISH_OATHBREAKER if
 *   defender is an oathbreaker — justice pays).
 */
export function attackConsequences(
  contracts: Contract[],
  attackerId: string,
  defenderId: string,
  defenderIsOathbreaker: boolean,
): { broken: Contract[]; repDelta: number } {
  throw new Error('unimplemented');
}

/**
 * Which recurring contracts owe an exchange at `tick`?
 * (status active, nextDueTick <= tick). Pure query; server applies transfers
 * and calls contractExchangeApplied afterwards.
 */
export function dueExchanges(contracts: Contract[], tick: number): Contract[] {
  throw new Error('unimplemented');
}

/** Advance nextDueTick after a successful exchange (mutates contract). */
export function contractExchangeApplied(contract: Contract, tick: number): void {
  throw new Error('unimplemented');
}

/**
 * Expire proposals past their TTL and active contracts past expiresTick.
 * Mutates statuses; returns the contracts that changed.
 */
export function expireContracts(contracts: Contract[], tick: number): Contract[] {
  throw new Error('unimplemented');
}
