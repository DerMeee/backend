import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

const logger = new Logger('ServiceError');

/**
 * Same behavior as {@link AuthService} try/catch: rethrow Nest HTTP errors,
 * map known database errors to 4xx, wrap anything else as 500.
 */
export function catchServiceError(error: unknown): never {
  if (error instanceof HttpException) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target =
        (error.meta?.target as string[] | string | undefined) ?? 'field';
      throw new ConflictException(`Value already used: ${String(target)}`);
    }
    if (error.code === 'P2025') {
      throw new NotFoundException('Record not found');
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  // Postgres CHECK constraint violation (e.g. stock >= 0) — surfaced through raw queries.
  if (message.includes('23514') || /violates check constraint/i.test(message)) {
    throw new BadRequestException(
      'Operation would break a data rule (for example negative stock)',
    );
  }
  logger.error(message, error instanceof Error ? error.stack : undefined);
  throw new InternalServerErrorException('Internal Error:', message);
}
