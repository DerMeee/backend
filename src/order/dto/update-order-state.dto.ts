import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderState } from '@prisma/client';

export class UpdateOrderStateDto {
  @ApiProperty({
    enum: OrderState,
    example: OrderState.PROCESSING,
    description: 'New order state',
  })
  @IsEnum(OrderState)
  state: OrderState;
}
