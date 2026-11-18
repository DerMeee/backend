import { Prisma } from '@prisma/client';

/** `%text%` for ILIKE, with the user's own % and _ escaped. */
export function likePattern(text: string): string {
  return `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Joins SQL conditions with AND; `TRUE` when there are none. */
export function andAll(conditions: Prisma.Sql[]): Prisma.Sql {
  return conditions.length
    ? Prisma.join(conditions, ' AND ')
    : Prisma.sql`TRUE`;
}

/** Postgres bigint counts come back as BigInt, which JSON can't serialise. */
export function toInt(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}
