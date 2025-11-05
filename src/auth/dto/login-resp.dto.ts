import { ApiProperty } from '@nestjs/swagger';

export class AddressDetailsDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  street: string;

  @ApiProperty({ type: String })
  city: string;

  @ApiProperty({ type: String })
  state: string;

  @ApiProperty({ type: String })
  postalCode: string;

  @ApiProperty({ type: String })
  country: string;

  @ApiProperty({ type: Boolean })
  validated?: boolean;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class UserLoginResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  phoneNumber: string;

  @ApiProperty()
  role?: string;

  @ApiProperty({ type: AddressDetailsDto, required: false })
  address?: AddressDetailsDto;
}

export class LoginResponseDto {
  @ApiProperty({ type: UserLoginResponseDto })
  user: UserLoginResponseDto;

  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;
}
