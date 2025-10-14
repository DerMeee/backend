import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength,  IsString, MinLength, IsOptional, IsBoolean, IsInt, IsDateString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'invalid email format' })
  @MaxLength(50, { message: 'email can not be longer than 50 charaters' })
  @MinLength(6, { message: 'email must be at least 12 characters long' })
  @ApiProperty({ example: 'name@example.com'})
  email: string;

  @IsNotEmpty({ message: 'password is required' })
  @MinLength(6, { message: 'password must be at least 6 characters long' })
  @MaxLength(15, { message: 'password can not be longer than 15 charaters' })
  @ApiProperty({ example: 'P@ssw0rd!' })
  password: string;
}

class AddressDetailsDto {
  @ApiProperty()
  id:string;    
  
  @ApiProperty()
  street:string;
  
  @ApiProperty()
  city:string;        

  @ApiProperty()
  state:string
  
  @ApiProperty()
  postalCode:string;
  
  @ApiProperty()
  country:string;
  
  @ApiProperty()
  validated:boolean;  

  @ApiProperty()
  createdAt:Date;   

  @ApiProperty()
  updatedAt:Date;  
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

export class LoginResponseDto{
  @ApiProperty({ type: UserLoginResponseDto })
  user: UserLoginResponseDto;

  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;
}

export class RefreshTokenResponseDto {
  @ApiProperty()
  accessToken: string;
}

export class RefreshTokenRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}