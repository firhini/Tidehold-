/**
 * The Ledger — contracts, reputation, and consequence.
 * Pure helpers; the server owns persistence and resource transfer.
 */
import type {
  Contract,
  ContractTerms,
  ContractType,
  PlayerState,
  Resources,
  ResourceType,
} from './types.js';
import {
  CONTRACT_MAX_DURATION_TICKS,
  CONTRACT_MIN_DURATION_TICKS,
  CONTRACT_PROPOSAL_TTL_TICKS,
  MAX_REPUTATION,
  OATHBREAKER_THRESHOLD,
  REP_ATTACK_ALLY,
  REP_BREAK_CONTRACT,
  REP_PUNISH_OATHBREAKER,
  REP_UNPROVOKED_ATTACK,
  RESOURCE_LIST,
} from './constants.js';

/** Every legal contract type — kept in sync with the ContractType union. */
export const CONTRACT_TYPE_LIST: ContractType[] = [
  'alliance',
  'non_aggression',
  'trade',
  'tribute',
  'ransom',
];

/** Contract types that an attack between the two parties breaks. */
export const ATTACK_BREAKS_TYPES: ContractType[] = ['alliance', 'non_aggression', 'tribute'];

/** Minimum interval for recurring exchanges (per the validateProposal spec). */
export const CONTRACT_MIN_INTERVAL_TICKS = 10;

export function isOathbreaker(player: PlayerState): boolean {
  return player.reputation < OATHBREAKER_THRESHOLD;
}

/** Clamp reputation into [0, MAX_REPUTATION]. */
export function clampReputation(rep: number): number {
  if (Number.isNaN(rep)) return 0;
  return Math.min(MAX_REPUTATION, Math.max(0, rep));
}

/** Defined entries of a (possibly absent) resource bag. */
function resourceEntries(bag: Partial<Resources> | undefined): [string, number][] {
  if (!bag) return [];
  return Object.entries(bag).filter(([, v]) => v !== undefined) as [string, number][];
}

/** True if the bag has no defined entries at all. */
function isEmptyBag(bag: Partial<Resources> | undefined): boolean {
  return resourceEntries(bag).length === 0;
}

/** Validate that every amount in the bag is a known resource and a positive integer. */
function validateAmounts(bag: Partial<Resources> | undefined, label: string): string | null {
  for (const [key, value] of resourceEntries(bag)) {
    if (!RESOURCE_LIST.includes(key as ResourceType)) {
      return `Unknown resource "${key}" in the ${label} terms.`;
    }
    if (!Number.isInteger(value) || value <= 0) {
      return `Amounts in the ${label} terms must be positive whole numbers (${key}: ${value}).`;
    }
  }
  return null;
}

/** Validate an intervalTicks value that is known to be present. */
function validateInterval(intervalTicks: number): string | null {
  if (!Number.isInteger(intervalTicks) || intervalTicks < CONTRACT_MIN_INTERVAL_TICKS) {
    return `The exchange interval must be at least ${CONTRACT_MIN_INTERVAL_TICKS} ticks.`;
  }
  return null;
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
  if (!CONTRACT_TYPE_LIST.includes(type)) {
    return `Unknown contract type "${type}".`;
  }
  if (fromId === toId) {
    return 'You cannot make a contract with yourself.';
  }
  if (
    !Number.isInteger(durationTicks) ||
    durationTicks < CONTRACT_MIN_DURATION_TICKS ||
    durationTicks > CONTRACT_MAX_DURATION_TICKS
  ) {
    return `Contract duration must be between ${CONTRACT_MIN_DURATION_TICKS} and ${CONTRACT_MAX_DURATION_TICKS} ticks.`;
  }

  const give = terms?.give;
  const receive = terms?.receive;
  const giveEmpty = isEmptyBag(give);
  const receiveEmpty = isEmptyBag(receive);
  const amountError = validateAmounts(give, 'give') ?? validateAmounts(receive, 'receive');

  switch (type) {
    case 'alliance':
    case 'non_aggression': {
      if (!giveEmpty || !receiveEmpty) {
        return 'Pacts of oath carry no resource exchange — leave give and receive empty.';
      }
      return null;
    }
    case 'trade': {
      if (amountError) return amountError;
      if (giveEmpty && receiveEmpty) {
        return 'A trade must exchange at least one resource.';
      }
      if (terms.intervalTicks !== undefined) {
        const intervalError = validateInterval(terms.intervalTicks);
        if (intervalError) return intervalError;
      }
      return null;
    }
    case 'tribute': {
      if (amountError) return amountError;
      if (giveEmpty === receiveEmpty) {
        return 'Tribute flows one way: fill exactly one side of the exchange.';
      }
      if (terms.intervalTicks === undefined) {
        return 'Tribute requires a payment interval.';
      }
      return validateInterval(terms.intervalTicks);
    }
    case 'ransom': {
      if (amountError) return amountError;
      if (!terms?.commanderId) {
        return 'A ransom must name the captured commander.';
      }
      if (!captorHoldsCommander) {
        return 'You do not hold that commander captive.';
      }
      return null;
    }
  }
}

/**
 * Construct a Contract in 'proposed' status.
 * Terms are deep-copied so later caller mutation cannot leak into the Ledger.
 * For recurring terms the first exchange is provisionally due one interval
 * after the proposal tick; the server may reset it on acceptance.
 */
export function createProposal(
  id: string,
  type: ContractType,
  fromId: string,
  toId: string,
  terms: ContractTerms,
  tick: number,
  durationTicks: number,
): Contract {
  const contract: Contract = {
    id,
    type,
    fromId,
    toId,
    status: 'proposed',
    terms: {
      ...terms,
      give: { ...terms.give },
      receive: { ...terms.receive },
    },
    createdTick: tick,
    expiresTick: tick + durationTicks,
  };
  if (terms.intervalTicks !== undefined) {
    contract.nextDueTick = tick + terms.intervalTicks;
  }
  return contract;
}

/** Is this contract between exactly these two players (either direction)? */
function isBetween(contract: Contract, a: string, b: string): boolean {
  return (
    (contract.fromId === a && contract.toId === b) ||
    (contract.fromId === b && contract.toId === a)
  );
}

/** Do these two players share an active contract of one of the given types? */
export function hasActiveContract(
  contracts: Contract[],
  a: string,
  b: string,
  types: ContractType[],
): boolean {
  return contracts.some(
    (c) => c.status === 'active' && types.includes(c.type) && isBetween(c, a, b),
  );
}

/**
 * Consequence of `attackerId` attacking `defenderId` given active contracts.
 * Returns the contracts broken by this attack (alliance/non_aggression/tribute
 * between the two) and the total reputation delta for the attacker:
 * - each broken alliance: REP_ATTACK_ALLY
 * - each other broken contract: REP_BREAK_CONTRACT
 * - if nothing broken: REP_UNPROVOKED_ATTACK (or REP_PUNISH_OATHBREAKER if
 *   defender is an oathbreaker — justice pays).
 * Pure query — does NOT mutate contract statuses; the server marks them broken.
 */
export function attackConsequences(
  contracts: Contract[],
  attackerId: string,
  defenderId: string,
  defenderIsOathbreaker: boolean,
): { broken: Contract[]; repDelta: number } {
  const broken = contracts.filter(
    (c) =>
      c.status === 'active' &&
      ATTACK_BREAKS_TYPES.includes(c.type) &&
      isBetween(c, attackerId, defenderId),
  );
  if (broken.length === 0) {
    return {
      broken,
      repDelta: defenderIsOathbreaker ? REP_PUNISH_OATHBREAKER : REP_UNPROVOKED_ATTACK,
    };
  }
  let repDelta = 0;
  for (const contract of broken) {
    repDelta += contract.type === 'alliance' ? REP_ATTACK_ALLY : REP_BREAK_CONTRACT;
  }
  return { broken, repDelta };
}

/**
 * Which recurring contracts owe an exchange at `tick`?
 * (status active, nextDueTick <= tick). Pure query; server applies transfers
 * and calls contractExchangeApplied afterwards.
 */
export function dueExchanges(contracts: Contract[], tick: number): Contract[] {
  return contracts.filter(
    (c) => c.status === 'active' && c.nextDueTick !== undefined && c.nextDueTick <= tick,
  );
}

/**
 * Advance nextDueTick after a successful exchange (mutates contract).
 * One-time terms (no intervalTicks) clear nextDueTick — nothing further is owed.
 */
export function contractExchangeApplied(contract: Contract, tick: number): void {
  const interval = contract.terms.intervalTicks;
  if (interval !== undefined && interval > 0) {
    contract.nextDueTick = tick + interval;
  } else {
    contract.nextDueTick = undefined;
  }
}

/**
 * Expire proposals past their TTL and active contracts past expiresTick.
 * Mutates statuses; returns the contracts that changed.
 * A proposal expires once `tick >= createdTick + CONTRACT_PROPOSAL_TTL_TICKS`;
 * an active contract lapses once `tick >= expiresTick`.
 */
export function expireContracts(contracts: Contract[], tick: number): Contract[] {
  const changed: Contract[] = [];
  for (const contract of contracts) {
    if (
      contract.status === 'proposed' &&
      tick >= contract.createdTick + CONTRACT_PROPOSAL_TTL_TICKS
    ) {
      contract.status = 'expired';
      changed.push(contract);
    } else if (contract.status === 'active' && tick >= contract.expiresTick) {
      contract.status = 'expired';
      changed.push(contract);
    }
  }
  return changed;
}
