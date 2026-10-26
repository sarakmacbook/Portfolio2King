/**
 * Whatever gets pasted into the scan box, turned into an address.
 *
 * People do not paste bare addresses. They paste an Etherscan link, a line from
 * a chat message, a Solscan tab, an address with a trailing space or a newline,
 * or a checksummed address with one character mistyped. This module is the pure
 * half of the scan box: it finds the address, says what kind it is, and says
 * plainly when something is wrong — before a scan is spent on it.
 *
 * No network, no React: see tests/wallet-address.test.ts.
 */
import { detectWalletAddressKind, shortWalletAddress, type WalletAddressKind } from "@/lib/wallet-chains";

export type AddressKindLabel = "EVM" | "Solana" | "Bitcoin" | "Tron";

const KIND_LABELS: Record<WalletAddressKind, AddressKindLabel> = {
  evm: "EVM",
  solana: "Solana",
  bitcoin: "Bitcoin",
  tron: "Tron",
};

const KIND_HINTS: Record<WalletAddressKind, string> = {
  evm: "Every EVM chain is scanned at once — Ethereum, Base, Arbitrum and everything else DeBank indexes.",
  solana: "Read from the Solana RPC directly; the source menu above only applies to EVM addresses.",
  bitcoin: "Read from a Bitcoin explorer directly; the source menu above only applies to EVM addresses.",
  tron: "Read from a Tron explorer directly; the source menu above only applies to EVM addresses.",
};

export function addressKindLabel(kind: WalletAddressKind): AddressKindLabel {
  return KIND_LABELS[kind];
}

/** The one-line explanation of what a scan of this address will do. */
export function addressKindHint(kind: WalletAddressKind): string {
  return KIND_HINTS[kind];
}

/* ------------------------------------------------------------------ *
 * Finding the address inside whatever was pasted
 * ------------------------------------------------------------------ */

const EVM_PATTERN = /0x[a-fA-F0-9]{40}/g;
const TRON_PATTERN = /T[1-9A-HJ-NP-Za-km-z]{33}/g;
const BTC_PATTERN = /(?:bc1[a-zA-HJ-NP-Z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})/g;
const BASE58_PATTERN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export type ParsedAddressInput = {
  /** The bare address to scan ("" when nothing could be found). */
  address: string;
  /** What the input looked like before: an explorer link, extra words, clean. */
  source: "clean" | "text" | "link" | "empty";
  /** A sentence for the UI when the paste was not already a bare address. */
  note?: string;
};

/** Hosts whose URL contains the address, so a whole link can be pasted. */
const EXPLORER_HOSTS = [
  "etherscan.io",
  "basescan.org",
  "arbiscan.io",
  "polygonscan.com",
  "bscscan.com",
  "optimistic.etherscan.io",
  "snowtrace.io",
  "ftmscan.com",
  "gnosisscan.io",
  "lineascan.build",
  "scrollscan.com",
  "mantlescan.xyz",
  "blastscan.io",
  "zksync-era.blockscout.com",
  "blockscout.com",
  "debank.com",
  "solscan.io",
  "solana.fm",
  "explorer.solana.com",
  "blockchain.com",
  "mempool.space",
  "tronscan.org",
  "tronscan.io",
];

function firstMatch(text: string, pattern: RegExp): string {
  const found = text.match(pattern);
  return found && found[0] ? found[0] : "";
}

/**
 * Turns a paste into an address.
 *
 * Order matters: an explorer URL is recognised first (its text may contain a
 * chain slug that looks like nothing), then an embedded EVM address, then Tron
 * (its `T…` form cannot collide with the others), then Bitcoin, and Solana last
 * because its 32–44 character base58 alphabet is the loosest of the four.
 */
export function parseAddressInput(raw: string): ParsedAddressInput {
  const input = String(raw ?? "").trim();
  if (!input) return { address: "", source: "empty" };

  if (/^0x[a-fA-F0-9]{40}$/.test(input)) return { address: input, source: "clean" };
  if (detectWalletAddressKind(input)) return { address: input, source: "clean" };

  const looksLikeLink = /^https?:\/\//i.test(input) || /\b[\w-]+\.(?:io|com|org|xyz|fm|space|build)\//i.test(input);
  const host = EXPLORER_HOSTS.find((item) => input.toLowerCase().includes(item));

  const evm = firstMatch(input, EVM_PATTERN);
  if (evm) {
    return {
      address: evm,
      source: looksLikeLink || host ? "link" : "text",
      note:
        looksLikeLink || host
          ? "Took the address out of that link."
          : "Found an EVM address in what you pasted.",
    };
  }

  const tron = firstMatch(input, TRON_PATTERN);
  if (tron) {
    return {
      address: tron,
      source: looksLikeLink || host ? "link" : "text",
      note: looksLikeLink || host ? "Took the address out of that link." : "Found a Tron address in what you pasted.",
    };
  }

  const bitcoin = firstMatch(input, BTC_PATTERN);
  if (bitcoin) {
    return {
      address: bitcoin,
      source: looksLikeLink || host ? "link" : "text",
      note: looksLikeLink || host ? "Took the address out of that link." : "Found a Bitcoin address in what you pasted.",
    };
  }

  const solana = firstMatch(input, BASE58_PATTERN);
  if (solana) {
    return {
      address: solana,
      source: looksLikeLink || host ? "link" : "text",
      note: looksLikeLink || host ? "Took the address out of that link." : "Found a Solana address in what you pasted.",
    };
  }

  // Nothing that looks like an address: hand back the text so the caller can
  // say *why* it is wrong — and, for a link, that the link had no address in it
  // (usually a transaction page rather than an account page).
  return { address: input, source: looksLikeLink || host ? "link" : "text" };
}

/* ------------------------------------------------------------------ *
 * EIP-55: is a mixed-case EVM address the one its casing claims?
 * ------------------------------------------------------------------ */

/**
 * Keccak-256, byte-oriented — the hash EIP-55 checksums are built from.
 *
 * Written out rather than pulled from a dependency: `node:crypto` ships SHA-3,
 * which pads differently (0x06, not 0x01), so it cannot verify an EIP-55
 * checksum. BigInt literals are avoided because the app targets ES2019 browser
 * output; the constants are built from strings instead.
 */
const RC = [
  "0x0000000000000001", "0x0000000000008082", "0x800000000000808a", "0x8000000080008000",
  "0x000000000000808b", "0x0000000080000001", "0x8000000080008081", "0x8000000000008009",
  "0x000000000000008a", "0x0000000000000088", "0x0000000080008009", "0x000000008000000a",
  "0x000000008000808b", "0x800000000000008b", "0x8000000000008089", "0x8000000000008003",
  "0x8000000000008002", "0x8000000000000080", "0x000000000000800a", "0x800000008000000a",
  "0x8000000080008081", "0x8000000000008080", "0x0000000080000001", "0x8000000080008008",
].map((value) => BigInt(value));

/** Rotation offsets, indexed [x][y]. */
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const BITS = BigInt(64);
const MASK = (BigInt(1) << BITS) - BigInt(1);
const BYTE_MASK = BigInt(0xff);

const rotl = (value: bigint, shift: number): bigint => {
  const s = BigInt(shift % 64);
  if (s === BigInt(0)) return value & MASK;
  return ((value << s) | (value >> (BITS - s))) & MASK;
};

/** keccak-f[1600] over 25 lanes. */
function keccakF(state: bigint[]): void {
  for (const round of RC) {
    // θ
    const c = Array.from({ length: 5 }, (_, x) =>
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20],
    );
    const d = Array.from({ length: 5 }, (_, x) => c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1));
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= d[x];
    }
    // ρ and π
    const b = new Array<bigint>(25).fill(BigInt(0));
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROT[x][y]);
      }
    }
    // χ
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] =
          b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & MASK & b[((x + 2) % 5) + 5 * y]);
      }
    }
    // ι
    state[0] ^= round;
  }
}

/** Keccak-256 of a UTF-8 string, as lower-case hex (no `0x`). */
export function keccak256Hex(text: string): string {
  const rate = 136; // 1088 bits
  const bytes = [...Buffer.from(text, "utf8"), 0x01]; // Keccak padding (not SHA-3's 0x06)
  while (bytes.length % rate !== 0) bytes.push(0);
  bytes[bytes.length - 1] |= 0x80;

  const state = new Array<bigint>(25).fill(BigInt(0));
  for (let offset = 0; offset < bytes.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      let value = BigInt(0);
      for (let byte = 0; byte < 8; byte += 1) {
        value |= BigInt(bytes[offset + lane * 8 + byte]) << BigInt(8 * byte);
      }
      state[lane] = (state[lane] ^ value) & MASK;
    }
    keccakF(state);
  }

  // The digest is the first four lanes in little-endian byte order, which is
  // *not* the same as printing each 64-bit lane as a number.
  let hex = "";
  for (let lane = 0; lane < 4; lane += 1) {
    for (let byte = 0; byte < 8; byte += 1) {
      hex += Number((state[lane] >> BigInt(8 * byte)) & BYTE_MASK)
        .toString(16)
        .padStart(2, "0");
    }
  }
  return hex;
}

export type AddressChecksum = "ok" | "invalid" | "unknown";

/**
 * EIP-55: an all-lower or all-upper EVM address is legal but unchecksummed, so
 * it is `unknown`; a *mixed-case* one claims a checksum, and a typo breaks it.
 * That is the one mistake worth catching before a scan.
 */
export function evmChecksumStatus(address: string): AddressChecksum {
  const body = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(body)) return "unknown";
  const hex = body.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return "unknown";

  const hash = keccak256Hex(hex.toLowerCase());
  for (let index = 0; index < hex.length; index += 1) {
    const digit = parseInt(hash[index], 16);
    const expected = digit >= 8 ? hex[index].toUpperCase() : hex[index].toLowerCase();
    if (hex[index] !== expected) return "invalid";
  }
  return "ok";
}

/* ------------------------------------------------------------------ *
 * What the scan box should say about what is in it
 * ------------------------------------------------------------------ */

export type AddressParse = {
  status: "empty" | "invalid" | "valid";
  /** The bare address to scan ("" unless `status === "valid"`). */
  address: string;
  kind?: WalletAddressKind;
  kindLabel?: AddressKindLabel;
  /** `0x1234…abcd`. */
  short?: string;
  /** A line under the input: what kind of address it is, or what is wrong. */
  message?: string;
  /**
   * True when the value looks like a mistake rather than an empty box: the UI
   * reddens the input instead of quietly accepting it.
   */
  error: boolean;
  /** Where the address came from — a link, some text, or a clean paste. */
  source: ParsedAddressInput["source"];
  /** A mixed-case EVM address whose checksum does not match what was typed. */
  checksumFailed: boolean;
};

/** Everything the scan box needs to know about what the user pasted. */
export function parseWalletAddress(raw: string): AddressParse {
  const parsed = parseAddressInput(raw);
  if (parsed.source === "empty" || !parsed.address) {
    return { status: "empty", address: "", error: false, source: "empty", checksumFailed: false };
  }

  const kind = detectWalletAddressKind(parsed.address);
  if (!kind) {
    const hint = parsed.source === "link" ? " That link did not contain an address." : "";
    return {
      status: "invalid",
      address: parsed.address,
      error: true,
      source: parsed.source,
      checksumFailed: false,
      message: `Not an address the scanner knows.${hint} Use 0x… (EVM), a Solana base58 address, bc1… / 1… (Bitcoin), or T… (Tron).`,
    };
  }

  const checksum = kind === "evm" ? evmChecksumStatus(parsed.address) : "unknown";
  if (checksum === "invalid") {
    return {
      status: "valid",
      address: parsed.address,
      kind,
      kindLabel: addressKindLabel(kind),
      short: shortWalletAddress(parsed.address),
      // Still scanned: only the casing is wrong, and plenty of tools print it
      // that way. But say so, because usually it is one mistyped character.
      message:
        "The mixed-case spelling of this address does not match its checksum — usually one mistyped character. Check it against the wallet before scanning.",
      error: true,
      source: parsed.source,
      checksumFailed: true,
    };
  }

  return {
    status: "valid",
    address: parsed.address,
    kind,
    kindLabel: addressKindLabel(kind),
    short: shortWalletAddress(parsed.address),
    message: parsed.note,
    error: false,
    source: parsed.source,
    checksumFailed: false,
  };
}

/* ------------------------------------------------------------------ *
 * Addresses already scanned, remembered on this device
 * ------------------------------------------------------------------ */

export const RECENT_ADDRESSES_KEY = "ledgerly-recent-wallet-addresses";
/** Enough to cover the handful of wallets anyone actually owns. */
export const MAX_RECENT_ADDRESSES = 6;

export type RecentAddress = {
  address: string;
  /** Optional label the user gave it — "Ledger", "Binance hot wallet". */
  label?: string;
  /** ISO timestamp of the last scan. */
  scannedAt: string;
};

/** Reads whatever is in storage into a clean, de-duplicated, capped list. */
export function parseRecentAddresses(raw: string | null | undefined): RecentAddress[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: RecentAddress[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const address = typeof record.address === "string" ? record.address.trim() : "";
    if (!address || !detectWalletAddressKind(address) || seen.has(address)) continue;
    const scannedAt =
      typeof record.scannedAt === "string" && !Number.isNaN(Date.parse(record.scannedAt))
        ? record.scannedAt
        : new Date(0).toISOString();
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim().slice(0, 40)
        : undefined;
    seen.add(address);
    out.push({ address, ...(label ? { label } : {}), scannedAt });
    if (out.length >= MAX_RECENT_ADDRESSES) break;
  }
  return out;
}

/**
 * Adds one address to the front of the list. Scanning an address you already
 * scanned moves it back to the top instead of adding a second copy, and the
 * label (when given) replaces the old one.
 */
export function rememberAddress(
  recent: readonly RecentAddress[],
  address: string,
  options: { label?: string; at?: string } = {},
): RecentAddress[] {
  const clean = String(address ?? "").trim();
  if (!clean || !detectWalletAddressKind(clean)) return [...recent];
  const existing = recent.find((item) => item.address === clean);
  const label = (options.label ?? existing?.label ?? "").trim().slice(0, 40);
  const entry: RecentAddress = {
    address: clean,
    ...(label ? { label } : {}),
    scannedAt: options.at ?? new Date().toISOString(),
  };
  return [entry, ...recent.filter((item) => item.address !== clean)].slice(0, MAX_RECENT_ADDRESSES);
}

/** Drops one address (the × on a recent row). */
export function forgetAddress(recent: readonly RecentAddress[], address: string): RecentAddress[] {
  return recent.filter((item) => item.address !== address);
}
