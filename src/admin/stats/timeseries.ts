import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Db } from '../../audit/audit.service';
import {
  APP_TIMEZONE,
  DAY_MS,
  endOfLocalDay,
  startOfLocalDay,
} from '../../common/dates';
import { toInt } from '../../common/sql';

export type Granularity = 'day' | 'week' | 'month';

/** Hard caps so a chart request can't ask Postgres for millions of buckets. */
const MAX_BUCKETS: Record<Granularity, number> = {
  day: 400,
  week: 260,
  month: 120,
};

const STEP: Record<Granularity, string> = {
  day: '1 day',
  week: '1 week',
  month: '1 month',
};

/**
 * Bucket start for a local timestamp. Weeks start on Sunday (Algerian work week),
 * Postgres' date_trunc('week') starts on Monday, hence the one-day shift.
 */
function bucketOf(granularity: Granularity, local: Prisma.Sql): Prisma.Sql {
  switch (granularity) {
    case 'day':
      return Prisma.sql`date_trunc('day', ${local})`;
    case 'week':
      return Prisma.sql`(date_trunc('week', ${local} + interval '1 day') - interval '1 day')`;
    case 'month':
      return Prisma.sql`date_trunc('month', ${local})`;
  }
}

/** Columns are timestamp(3) holding UTC; convert to Algeria local time before bucketing. */
function localTime(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${APP_TIMEZONE})`;
}

export interface SeriesSpec {
  /** Table and timestamp column: constants only, never user input. */
  table: 'User' | 'Appointment' | 'Order';
  dateColumn: 'createdAt' | 'startAt';
  /** Named counters, e.g. { clients: role = 'PATIENT' }. */
  splits: Record<string, Prisma.Sql>;
  where?: Prisma.Sql;
  granularity: Granularity;
  from: string; // YYYY-MM-DD, local
  to: string; // YYYY-MM-DD, local
}

export interface SeriesPoint {
  bucket: string; // YYYY-MM-DD (bucket start, local)
  total: number;
  [split: string]: number | string;
}

export function validateRange(
  from: string,
  to: string,
  granularity: Granularity,
) {
  const start = startOfLocalDay(from);
  const end = endOfLocalDay(to);
  if (start > end) throw new BadRequestException('from must be before to');
  const days = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  const buckets =
    granularity === 'day'
      ? days
      : granularity === 'week'
        ? days / 7
        : days / 28;
  if (buckets > MAX_BUCKETS[granularity]) {
    throw new BadRequestException(
      `Range too long for ${granularity} view (max ${MAX_BUCKETS[granularity]} points). Use a larger granularity.`,
    );
  }
  return { start, end, days };
}

/**
 * Counts rows per time bucket, with empty buckets filled with zeros (generate_series).
 * Aggregation happens before the join so the date index on `dateColumn` is used.
 */
export async function countSeries(
  db: Db,
  spec: SeriesSpec,
): Promise<SeriesPoint[]> {
  const { start, end } = validateRange(spec.from, spec.to, spec.granularity);
  const col = Prisma.raw(`"${spec.dateColumn}"`);
  const table = Prisma.raw(`"${spec.table}"`);
  const names = Object.keys(spec.splits);
  if (names.some((n) => !/^[a-zA-Z]+$/.test(n)))
    throw new Error('Invalid split name');

  const splitCols = names.length
    ? Prisma.sql`, ${Prisma.join(
        names.map(
          (n) =>
            Prisma.sql`COUNT(*) FILTER (WHERE ${spec.splits[n]})::int AS ${Prisma.raw(`"${n}"`)}`,
        ),
      )}`
    : Prisma.empty;
  const splitSelect = names.length
    ? Prisma.sql`, ${Prisma.join(
        names.map(
          (n) =>
            Prisma.sql`COALESCE(c.${Prisma.raw(`"${n}"`)}, 0) AS ${Prisma.raw(`"${n}"`)}`,
        ),
      )}`
    : Prisma.empty;

  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH counts AS (
      SELECT ${bucketOf(spec.granularity, localTime(col))} AS bucket,
             COUNT(*)::int AS total ${splitCols}
      FROM ${table}
      WHERE ${col} >= ${start} AND ${col} <= ${end}
        AND ${spec.where ?? Prisma.sql`TRUE`}
      GROUP BY 1
    ),
    series AS (
      SELECT generate_series(
        ${bucketOf(spec.granularity, Prisma.sql`${spec.from}::timestamp`)},
        ${bucketOf(spec.granularity, Prisma.sql`${spec.to}::timestamp`)},
        ${STEP[spec.granularity]}::interval
      ) AS bucket
    )
    SELECT to_char(s.bucket, 'YYYY-MM-DD') AS bucket,
           COALESCE(c.total, 0) AS total ${splitSelect}
    FROM series s
    LEFT JOIN counts c ON c.bucket = s.bucket
    ORDER BY s.bucket`;

  return rows.map((r) => {
    const point: SeriesPoint = {
      bucket: String(r.bucket),
      total: toInt(r.total),
    };
    for (const n of names) point[n] = toInt(r[n]);
    return point;
  });
}

/** The period of the same length that ends the day before `from`. */
export function previousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const lengthDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (lengthDays - 1) * DAY_MS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(prevStart), to: fmt(prevEnd) };
}

export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Today in Algeria as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
