import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { GetAppointmentsQueryDto } from './dto/get-appointments-query.dto';
import { PatientAppointmentDto } from './dto/patient-appointment.dto';
import { DoctorAppointmentDto } from './dto/doctor-appointment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { ApiBadRequestResponse, ApiExtraModels, ApiInternalServerErrorResponse, ApiNotFoundResponse, ApiOkResponse, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginatedResponseDto } from './dto/pagination-resp.dto';

@UseGuards(JwtAuthGuard)
@ApiExtraModels(DoctorAppointmentDto, PatientAppointmentDto, PaginatedResponseDto)
@Controller('appointment')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Appointment created successfully'
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Post()
  create(@Body() createAppointmentDto: CreateAppointmentDto, @CurrentUser() user: any) {
    return this.appointmentService.create(createAppointmentDto, user.userId);
  }


  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Paginated Appointment for doctors retrieved successfully',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(PaginatedResponseDto),
        },
      ],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DoctorAppointmentDto) },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Get('doctor')
  getForDoctor(@Query() query: GetAppointmentsQueryDto, @CurrentUser() user: any): Promise<PaginatedResponseDto<DoctorAppointmentDto>> {
    return this.appointmentService.getForDoctor(user.userId, query);
  }


  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Paginated appointment for patient retrieved successfully',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(PaginatedResponseDto),
        },
      ],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(PatientAppointmentDto) },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  // GET /appointment/patient
  @Get('patient')
  getByPatient(@Query() query: GetAppointmentsQueryDto, @CurrentUser() user: any): Promise<PaginatedResponseDto<PatientAppointmentDto>> {
    return this.appointmentService.getByPatient(user.userId, query);
  }

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Daily appointments for doctor retrieved successfully',
    type: [DoctorAppointmentDto]
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  // GET /appointment/doctor/day?date=YYYY-MM-DD
  @Get('doctor/day')
  getPerDayForDoctor(@Query('date') date: string, @CurrentUser() user: any): Promise<DoctorAppointmentDto[]> {
    return this.appointmentService.getPerDayForDoctor(user.userId, date);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateAppointmentDto: UpdateAppointmentDto) {
    return this.appointmentService.update(id, updateAppointmentDto);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.appointmentService.cancel(id, user.userId);
  }
}
