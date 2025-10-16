import { ApiProperty } from "@nestjs/swagger";

class UserDto {
    @ApiProperty()
    name: string;
}

class DoctorDto {
    @ApiProperty({ type: UserDto })
    user: UserDto;
}

export class PatientAppointmentDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    date: string;

    @ApiProperty()
    time: string;

    @ApiProperty()
    doctor: string;

    @ApiProperty()
    status: string;

    @ApiProperty()
    type: string;
}
