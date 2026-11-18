import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';

export class OrderItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() productId: string;
  @ApiProperty() productName: string;
  @ApiProperty() unitPrice: number;
  @ApiProperty() quantity: number;
  @ApiProperty() subtotal: number;
}

export class OrderDeliveryDto {
  @ApiPropertyOptional({ nullable: true }) recipientName: string | null;
  @ApiPropertyOptional({ nullable: true }) recipientPhone: string | null;
  @ApiPropertyOptional({ nullable: true }) wilaya: string | null;
  @ApiPropertyOptional({ nullable: true }) commune: string | null;
  @ApiPropertyOptional({ nullable: true }) addressLine: string | null;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiPropertyOptional({ nullable: true }) company: string | null;
  @ApiPropertyOptional({ nullable: true }) trackingNumber: string | null;
  @ApiPropertyOptional({ nullable: true }) shippedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt: Date | null;
}

export class OrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'ORD-000045' }) reference: string;
  @ApiProperty() patientId: string;
  @ApiProperty({ enum: PaymentMethod, description: 'CASH = cash on delivery' })
  payMethod: PaymentMethod;
  @ApiProperty({ enum: OrderStatus }) status: OrderStatus;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus: PaymentStatus;
  @ApiProperty({ enum: DeliveryStatus }) deliveryStatus: DeliveryStatus;
  @ApiProperty({ type: [OrderItemResponseDto] }) items: OrderItemResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty({ type: OrderDeliveryDto }) delivery: OrderDeliveryDto;
  @ApiPropertyOptional({ nullable: true }) paidAt: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Reason when rejected or cancelled',
  })
  closeReason: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
