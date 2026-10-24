/**
 * Spam filter for wallet scans and holdings.
 *
 * A wallet that has ever been used in public attracts airdropped junk: tokens
 * minted to whoever they can reach, named so the name itself is the advert
 * ("Visit usdt-claim.io to claim 5,000 USDT"). Many of them carry a made-up
 * price, so they are *not* dust — a scam token "worth" $40,000 sails past a
 * dollar cut-off and sits at the top of the portfolio looking like the best
 * position the user owns.
 *
 * This module is the one place that decides what looks like spam, so the wallet
 * importer, the server action and the table agree. It never deletes anything:
 * callers hide what it flags, say how much was hidden, and keep a one-click way
 * to show it again.
 *
 * The rules only look at what the scan actually knows — the name, the symbol and
 * any flag the indexer sent. There is no blocklist to keep stale and no network
 * call: the patterns below are the durable part of spam naming.
 */

/** Anything that carries a name, a symbol and maybe an indexer's spam flag. */
export type SpamCheckable = {
  name?: string | null;
  symbol?: string | null;
  /** Blockscout / Routescan reputation flag or DeBank's `is_scam`. */
  spam?: boolean | null;
  /** Alias some parsers use for the same thing. */
  isSpam?: boolean | null;
};

export type SpamReason =
  | "flagged by the chain"
  | "contains a web address"
  | "airdrop wording"
  | "hidden characters"
  | "unusually long name";

/** Real token names are short; bait messages are not. */
const MAX_NAME_LENGTH = 64;
/** Real tickers are short too; spam symbols are whole sentences. */
const MAX_SYMBOL_LENGTH = 16;

/**
 * A domain, a URL or a chat invite. Real tokens do not put an address in their
 * name, and a `.eth`/`.sol` handle is harmless enough to leave alone.
 */
const WEB_ADDRESS_RE =
  /\bhttps?:\/\/|\bwww\.|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|xyz|site|app|finance|live|pro|co|me|gg|link|top|club|online|vip|info|biz|fun|space|website|store|shop|cc|ai|money|exchange|tech|click|page|help|support|buzz|cafe|group)\b/i;

/** `t.me/…`, `telegram`, or an `@handle`. */
const CHAT_HANDLE_RE = /\bt\.me\b|\btelegram\b|@[a-z0-9_]{4,}/i;

/**
 * Airdrop marketing words. Deliberately a short list of words that do not turn
 * up in real token names — "reward", "bonus" and "gift" are left out on purpose
 * because legitimate tokens do use them.
 */
const BAIT_RE = /\b(?:claim|claimable|airdrop|airdrops|visit|redeem|voucher|giveaway|winner|congratulations)\b/i;

/** Zero-width and bidi characters: used to fake a ticker that looks like another. */
const HIDDEN_CHARACTER_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;

function textOf(token: SpamCheckable): { name: string; symbol: string } {
  const name = typeof token.name === "string" ? token.name : "";
  const symbol = typeof token.symbol === "string" ? token.symbol : "";
  return { name, symbol };
}

/**
 * Every reason this token looks like spam, in the order the checks run.
 * An empty list means "nothing suspicious" — that is the common case.
 */
export function spamReasonsOf(token: SpamCheckable): SpamReason[] {
  const reasons: SpamReason[] = [];
  if (token.spam === true || token.isSpam === true) reasons.push("flagged by the chain");

  const { name, symbol } = textOf(token);
  // The name is the payload of an airdrop, but a short symbol is sometimes the
  // whole advert (“CLAIM”), so both are checked.
  const readable = `${name} ${symbol}`;

  if (WEB_ADDRESS_RE.test(readable)) reasons.push("contains a web address");
  if (CHAT_HANDLE_RE.test(readable)) reasons.push("contains a web address");
  if (BAIT_RE.test(readable)) reasons.push("airdrop wording");
  if (HIDDEN_CHARACTER_RE.test(readable)) reasons.push("hidden characters");
  if (name.trim().length > MAX_NAME_LENGTH || symbol.trim().length > MAX_SYMBOL_LENGTH) {
    reasons.push("unusually long name");
  }

  // De-duplicate: a name with both a URL and a chat invite has one problem.
  return [...new Set(reasons)];
}

/** True when the token looks like airdropped spam. */
export function isSpamToken(token: SpamCheckable): boolean {
  return spamReasonsOf(token).length > 0;
}

/** The first reason, for a tooltip or a note. `null` when the token looks fine. */
export function spamReasonOf(token: SpamCheckable): SpamReason | null {
  return spamReasonsOf(token)[0] ?? null;
}

export type SpamSplit<T> = {
  /** What the user sees and what "Import all" imports. */
  kept: T[];
  /** The hidden tokens. */
  spam: T[];
  /** How many were hidden — 0 when the filter is off. */
  spamCount: number;
};

/**
 * Splits rows into what to show and what to hide.
 *
 * `hide` is the user's switch. Switching it off keeps everything, so spam is
 * only ever hidden on request and never dropped.
 */
export function splitSpam<T extends SpamCheckable>(rows: readonly T[], hide: boolean): SpamSplit<T> {
  if (!hide) return { kept: [...rows], spam: [], spamCount: 0 };

  const kept: T[] = [];
  const spam: T[] = [];
  for (const row of rows) {
    if (isSpamToken(row)) spam.push(row);
    else kept.push(row);
  }
  return { kept, spam, spamCount: spam.length };
}
