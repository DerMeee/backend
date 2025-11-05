import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { GetAppointmentsQueryDto } from './dto/get-appointments-query.dto';
import { PatientAppointmentDto } from './dto/patient-appointment.dto';
import { DoctorAppointmentDto } from './dto/doctor-appointment.dto';
import { ApproveAppointmentDto } from './dto/approve-appointment.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { Permissions } from '../auth/decorator/require-permission.decorator';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiBody,
  getSchemaPath,
} from '@nestjs/swagger';
import { PaginatedResponseDto } from './dto/pagination-resp.dto';
import { ResponseDto } from './dto/response.dto';

@UseGuards(JwtAuthGuard)
@ApiExtraModels(
  DoctorAppointmentDto,
  PatientAppointmentDto,
  PaginatedResponseDto,
)
@Controller('appointment')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Appointment created successfully',
    type: ResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Post()
  create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @CurrentUser() user: any,
  ): Promise<ResponseDto> {
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
  getForDoctor(
    @Query() query: GetAppointmentsQueryDto,
    @CurrentUser() user: any,
  ): Promise<PaginatedResponseDto<DoctorAppointmentDto>> {
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
  getByPatient(
    @Query() query: GetAppointmentsQueryDto,
    @CurrentUser() user: any,
  ): Promise<PaginatedResponseDto<PatientAppointmentDto>> {
    return this.appointmentService.getByPatient(user.userId, query);
  }

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Daily appointments for doctor retrieved successfully',
    type: [DoctorAppointmentDto],
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  // GET /appointment/doctor/day?date=YYYY-MM-DD
  @Get('doctor/day')
  getPerDayForDoctor(
    @Query('date') date: string,
    @CurrentUser() user: any,
  ): Promise<DoctorAppointmentDto[]> {
    return this.appointmentService.getPerDayForDoctor(user.userId, date);
  }

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Appointment updated successfully',
    type: ResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
  ): Promise<ResponseDto> {
    return this.appointmentService.update(id, updateAppointmentDto);
  }

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiOkResponse({
    description: 'Appointment deleted successfully',
    type: ResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Patient not found' })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: any): Promise<ResponseDto> {
    return this.appointmentService.cancel(id, user.userId);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'appointment', action: 'update' }])
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a pending appointment' })
  @ApiParam({
    name: 'id',
    description: 'Appointment ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiBody({
    type: ApproveAppointmentDto,
    description: 'Optional approval message',
  })
  @ApiOkResponse({
    description: 'Appointment approved successfully',
    type: AppointmentResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Bad Request - Invalid appointment state or time slot not available',
  })
  @ApiNotFoundResponse({
    description: 'Appointment or Doctor not found',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - Insufficient permissions or not your appointment',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal Server Error',
  })
  async approveAppointment(
    @Param('id') id: string,
    @Body() approveDto: ApproveAppointmentDto,
    @CurrentUser() user: any,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentService.approveAppointment(
      id,
      user.userId,
      approveDto,
    );
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'appointment', action: 'update' }])
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending appointment' })
  @ApiParam({
    name: 'id',
    description: 'Appointment ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiBody({
    type: RejectAppointmentDto,
    description: 'Rejection reason',
  })
  @ApiOkResponse({
    description: 'Appointment rejected successfully',
    type: AppointmentResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Bad Request - Invalid appointment state',
  })
  @ApiNotFoundResponse({
    description: 'Appointment or Doctor not found',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - Insufficient permissions or not your appointment',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal Server Error',
  })
  async rejectAppointment(
    @Param('id') id: string,
    @Body() rejectDto: RejectAppointmentDto,
    @CurrentUser() user: any,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentService.rejectAppointment(
      id,
      user.userId,
      rejectDto,
    );
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'appointment', action: 'update' }])
  @Put(':id/reschedule')
  @ApiOperation({ summary: 'Reschedule an appointment to a new date and time' })
  @ApiParam({
    name: 'id',
    description: 'Appointment ID',
    example: 'cmgscuyjw0004uggovqk7ildx',
  })
  @ApiBody({
    type: RescheduleAppointmentDto,
    description: 'New date, start time, end time, and optional reason',
  })
  @ApiOkResponse({
    description: 'Appointment rescheduled successfully',
    type: AppointmentResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Bad Request - Invalid time format, past date, time slot not available, or cancelled appointment',
  })
  @ApiNotFoundResponse({
    description: 'Appointment or Doctor not found',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - Insufficient permissions or not your appointment',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal Server Error',
  })
  async rescheduleAppointment(
    @Param('id') id: string,
    @Body() rescheduleDto: RescheduleAppointmentDto,
    @CurrentUser() user: any,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentService.rescheduleAppointment(
      id,
      user.userId,
      rescheduleDto,
    );
  }
}
