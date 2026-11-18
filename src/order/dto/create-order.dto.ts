import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/**
 * Checkout from the current cart. Delivery fields left empty are taken from the
 * patient's profile (name, phone, address); the order fails if something is still missing.
 */
export class CreateOrderDto {
  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
    description:
      'CASH = cash on delivery. BARIDIMOB / CIB are confirmed manually by Dermee.',
  })
  @IsEnum(PaymentMethod)
  payMethod: PaymentMethod;

  @ApiPropertyOptional({ example: 'Amina Benali' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  recipientName?: string;

  @ApiPropertyOptional({ example: '0555 12 34 56' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  recipientPhone?: string;

  @ApiPropertyOptional({ example: 'Alger' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  wilaya?: string;

  @ApiPropertyOptional({ example: 'Bab Ezzouar' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commune?: string;

  @ApiPropertyOptional({ example: 'Cité 5 juillet, bât. 12, apt 3' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Call before coming' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  deliveryNote?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
