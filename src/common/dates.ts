import { BadRequestException } from '@nestjs/common';

/**
 * Dermee operates in Algeria. Algeria uses UTC+1 all year (no daylight saving),
 * so day boundaries for filters and charts use this fixed offset.
 */
export const APP_TIMEZONE = 'Africa/Algiers';
export const APP_UTC_OFFSET = '+01:00';

/** Start of a local (Algeria) day, as a UTC Date. */
export function startOfLocalDay(date: string): Date {
  const d = new Date(`${date}T00:00:00.000${APP_UTC_OFFSET}`);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException(`Invalid date: ${date}`);
  return d;
}

/** End of a local (Algeria) day, as a UTC Date. */
export function endOfLocalDay(date: string): Date {
  const d = new Date(`${date}T23:59:59.999${APP_UTC_OFFSET}`);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException(`Invalid date: ${date}`);
  return d;
}

/** Prisma `where` fragment for an inclusive YYYY-MM-DD range. Undefined when no bound is set. */
export function dateRangeFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = startOfLocalDay(from);
  if (to) range.lte = endOfLocalDay(to);
  if (range.gte && range.lte && range.gte > range.lte) {
    throw new BadRequestException('from must be before to');
  }
  return range;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
