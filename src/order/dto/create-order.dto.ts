import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateOrderDto {
  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
    description: 'Payment method: BARIDIMOB | CIB | CASH',
  })
  @IsEnum(PaymentMethod)
  payMethod: PaymentMethod;
}
