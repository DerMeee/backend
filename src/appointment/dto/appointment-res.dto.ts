import { ApiProperty } from "@nestjs/swagger";

class UserDto {
    @ApiProperty()
    name: string;
}

class PatientDto {
    @ApiProperty({type: UserDto})
    user: UserDto
}

export class AppointmentDto {
    @ApiProperty()
    id: string

    @ApiProperty()
    startAt: Date

    @ApiProperty()
    endAt: Date

    @ApiProperty()
    state: string

    @ApiProperty()
    type: string

    @ApiProperty()
    patient: PatientDto
    
}