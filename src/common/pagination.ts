import { PaginatedResponseDto } from './dto/paginated-response.dto';

export function skipTake(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponseDto<T> {
  return new PaginatedResponseDto(data, page, limit, total);
}

/**
 * Picks a sort column from a whitelist so user input never reaches the query directly.
 * `allowed` maps the public name to whatever the query needs (a Prisma field or a SQL fragment).
 */
export function resolveSort<T>(
  sortBy: string | undefined,
  allowed: Record<string, T>,
  fallback: string,
): T {
  return sortBy && sortBy in allowed ? allowed[sortBy] : allowed[fallback];
}
