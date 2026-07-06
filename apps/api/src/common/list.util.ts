import type { SortOrder } from '@crm/types';

/**
 * Cursor pagination + sort helpers shared by the list endpoints. The strategy:
 * order by the chosen field with `id` as a stable tiebreaker, fetch `limit + 1`
 * rows to detect a further page, and return the last visible row's id as the
 * next cursor. No COUNT(*) — keeps large lists under the P95 budget.
 */

/** Resolve an orderBy array, guarding against arbitrary/injected sort fields. */
export function resolveOrderBy(
  sort: string | undefined,
  order: SortOrder,
  allowed: readonly string[],
  fallback = 'createdAt',
): Array<Record<string, SortOrder>> {
  const field = sort && allowed.includes(sort) ? sort : fallback;
  // `id` tiebreaker guarantees a total ordering so the cursor never skips/dupes.
  return field === 'id' ? [{ id: order }] : [{ [field]: order }, { id: order }];
}

/** Prisma cursor args; empty on the first page. */
export function cursorArgs(cursor: string | undefined): { cursor?: { id: string }; skip?: number } {
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {};
}

/** Slice a `limit + 1` result set into a page + nextCursor. */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last ? last.id : null };
}
