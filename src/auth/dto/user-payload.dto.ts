import { IsString } from 'class-validator';

export class UserPayload {
  @IsString()
  userId: string;

  @IsString()
  role: string;
}
