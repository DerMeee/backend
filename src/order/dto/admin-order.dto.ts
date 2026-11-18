import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/list-query.dto';

export const ORDER_SORTS = [
  'createdAt',
  'totalAmount',
  'refNo',
  'updatedAt',
] as const;

/** `from`/`to` filter the order date. `search` matches the reference (ORD-…), customer name or phone. */
export class AdminOrdersQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Customer name or phone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  wilaya?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  commune?: string;

  @ApiPropertyOptional({ description: 'Product id or part of a product name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  product?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  deliveryStatus?: DeliveryStatus;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  payMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: ORDER_SORTS, default: 'createdAt' })
  declare sortBy?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Required for REJECTED and CANCELLED',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdatePaymentStatusDto {
  @ApiProperty({ enum: PaymentStatus })
  @IsEnum(PaymentStatus)
  paymentStatus: PaymentStatus;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Change the delivery status and/or record delivery info (company, tracking, an update note). */
export class UpdateDeliveryDto {
  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  deliveryStatus?: DeliveryStatus;

  @ApiPropertyOptional({ example: 'Yalidine' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  deliveryCompany?: string;

  @ApiPropertyOptional({ example: 'YAL-123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNumber?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'Parcel at the Bab Ezzouar hub',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
