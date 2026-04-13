import { HttpException, InternalServerErrorException } from '@nestjs/common';

/**
 * Same behavior as {@link AuthService} try/catch: rethrow Nest HTTP errors,
 * wrap unexpected errors as 500.
 */
export function catchServiceError(error: unknown): never {
  if (error instanceof HttpException) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new InternalServerErrorException('Internal Error:', message);
}
