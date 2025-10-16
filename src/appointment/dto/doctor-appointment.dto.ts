import { ApiProperty } from "@nestjs/swagger";

class UserDto {
    @ApiProperty()
    name: string;
}

class PatientDto {
    @ApiProperty({ type: UserDto })
    user: UserDto;
}

export class DoctorAppointmentDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    date: string;

    @ApiProperty()
    time: string;

    @ApiProperty()
    patient: string;

    @ApiProperty()
    state: string;

    @ApiProperty()
    type: string;
}
