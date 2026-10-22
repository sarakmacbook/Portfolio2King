/**
 * Small helpers shared by every "move this up/down" list in the app
 * (holding categories, dashboard cards, allocation slices).
 *
 * Pure functions only — see tests/holdings-groups.test.ts and
 * tests/dashboard-layout.test.ts.
 */

export function isKeyOf<K extends string>(value: unknown, keys: readonly K[]): value is K {
  return typeof value === "string" && (keys as readonly string[]).includes(value);
}

export function insertAt<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (from === target) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Accepts a stored value — comma string, JSON array, or array — and returns a
 * complete, duplicate-free, known-only order. Missing keys are appended in their
 * default position so a stale tab or hand-edited setting can never break a page.
 */
export function normaliseKeyOrder<K extends string>(value: unknown, keys: readonly K[]): K[] {
  let parts: unknown[] = [];
  if (Array.isArray(value)) {
    parts = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        parts = Array.isArray(parsed) ? parsed : [];
      } catch {
        parts = [];
      }
    } else {
      parts = trimmed.split(",");
    }
  }

  const seen = new Set<K>();
  const order: K[] = [];
  for (const part of parts) {
    const key = typeof part === "string" ? part.trim() : "";
    if (!isKeyOf(key, keys) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  for (const key of keys) {
    if (!seen.has(key)) order.push(key);
  }
  return order;
}

/** Moves one key up (-1) or down (+1); clamped at the ends. */
export function moveKeyBy<K extends string>(order: readonly K[], key: K, delta: number): K[] {
  const from = order.indexOf(key);
  if (from < 0) return [...order];
  return insertAt(order, from, from + delta);
}

/** Moves `key` so it lands before or after `overKey` (drag-and-drop). */
export function moveKeyTo<K extends string>(
  order: readonly K[],
  key: K,
  overKey: K,
  after: boolean,
): K[] {
  const from = order.indexOf(key);
  const overIndex = order.indexOf(overKey);
  if (from < 0 || overIndex < 0 || from === overIndex) return [...order];
  let target = overIndex + (after ? 1 : 0);
  if (target > from) target -= 1;
  return insertAt(order, from, target);
}
