import { ApiProperty } from '@nestjs/swagger';
import { OrderState, PaymentMethod } from '@prisma/client';

export class OrderItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  productName: string;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ description: 'Item subtotal (unitPrice × quantity)' })
  subtotal: number;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  patientId: string;

  @ApiProperty({ enum: PaymentMethod })
  payMethod: PaymentMethod;

  @ApiProperty({ enum: OrderState })
  state: OrderState;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty({ description: 'Total order amount' })
  total: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
