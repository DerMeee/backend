import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/** Stock is not editable here: use stock adjustments so every change is recorded. */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['stock', 'images'] as const),
) {}
