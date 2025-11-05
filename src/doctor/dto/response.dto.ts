import { ApiProperty } from "@nestjs/swagger";

class DataDto {
    @ApiProperty({type: String})
    id: string;
}


export class ResponseDto {
    @ApiProperty({type: String})
    message: string;

    @ApiProperty({type: DataDto})
    data: DataDto;
}