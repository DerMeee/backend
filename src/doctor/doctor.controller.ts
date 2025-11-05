import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Res,
} from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { GetDoctorsQueryDto } from './dto/get-doctors-query.dto';
import { DoctorResponseDto } from './dto/doctor-response.dto';
import { GetDoctorScheduleDto } from './dto/get-doctor-schedule.dto';
import { DoctorScheduleResponseDto } from './dto/doctor-schedule-response.dto';
import { PaginatedResponseDto } from '../appointment/dto/pagination-resp.dto';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { Permissions } from '../auth/decorator/require-permission.decorator';
import { CreateWorkDayDto } from './dto/create-work-day.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';
import { CreateDoctorLeaveDto } from './dto/create-doctor-leave.dto';
import { DoctorLeaveResponseDto } from './dto/doctor-leave-response.dto';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { CalendarResponseDto } from './dto/calendar-response.dto';
import { ExportQueryDto } from './dto/export-query.dto';
import { ResponseDto } from './dto/response.dto';
import { GetSchedualExcepDto } from './dto/get-schedual-excep.dto';

@ApiTags('doctors')
@ApiExtraModels(
  DoctorResponseDto,
  PaginatedResponseDto,
  DoctorScheduleResponseDto,
  CreateWorkDayDto,
  CreateDoctorLeaveDto,
  DoctorLeaveResponseDto,
  CalendarResponseDto,
  GetSchedualExcepDto,
)
@Controller('doctor')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @ApiOperation({ summary: 'Get all doctors with pagination' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 10, max: 100)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of doctors retrieved successfully',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(PaginatedResponseDto),
        },
      ],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DoctorResponseDto) },
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get()
  findAll(
    @Query() query: GetDoctorsQueryDto,
  ): Promise<PaginatedResponseDto<DoctorResponseDto>> {
    return this.doctorService.findAll(query);
  }

  @Post('schedule')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'create' }])
  @ApiOperation({ summary: 'Create work schedule for authenticated doctor' })
  @ApiResponse({
    status: 201,
    description: 'Work schedule created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid data or duplicate schedule',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  createSchedule(
    @CurrentUser() user: any,
    @Body() createWorkDayDto: CreateWorkDayDto,
  ): Promise<ResponseDto> {
    return this.doctorService.createWorkDay(user.id, createWorkDayDto);
  }

  @ApiOperation({ summary: 'Get doctor schedule for a specific date' })
  @ApiQuery({
    name: 'date',
    required: true,
    description: 'Date in YYYY-MM-DD format',
    example: '2024-01-15',
  })
  @ApiResponse({
    status: 200,
    description: 'Doctor schedule retrieved successfully',
    type: DoctorScheduleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Doctor not found',
  })
  @ApiBadRequestResponse({ description: 'Invalid date format' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'read' }])
  @Get('schedule')
  getDoctorSchedule(
    @CurrentUser() user: any,
    @Query() query: GetDoctorScheduleDto,
  ): Promise<DoctorScheduleResponseDto> {
    return this.doctorService.getDoctorSchedule(user.id, query.date);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'update' }])
  @ApiOkResponse({
    description: 'Schedule updated successfully',
    type: ResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid data' })
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  @Patch('schedule')
  updateDoctorSchedule(
    @CurrentUser() user: any,
    @Body() dto: UpdateDoctorDto,
  ): Promise<ResponseDto> {
    return this.doctorService.updateWorkDay(user.id, dto);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Post('schedule/exception')
  @Permissions([{ resource: 'doctor', action: 'create' }])
  @ApiOperation({
    summary: 'Create an exception date for authenticated doctor',
  })
  @ApiResponse({
    status: 201,
    description: 'Exception date created successfully',
    type: ResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid data',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  createExceptionDate(
    @Body() dto: CreateExceptionDto,
    @CurrentUser() user: any,
  ): Promise<ResponseDto> {
    console.log('userId', user.id);
    return this.doctorService.createExceptionDate(user.id, dto);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'delete' }])
  @ApiNotFoundResponse({ description: 'Exception date not found' })
  @ApiBadRequestResponse({ description: 'Invalid ID format' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  @ApiOkResponse({
    description: 'Exception date deleted successfully',
    type: ResponseDto,
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Delete('schedule/exception/:id')
  deleteExceptionDate(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<ResponseDto> {
    return this.doctorService.deleteExceptionDate(user.id, id);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'delete' }])
  @ApiOperation({
    summary: 'Get all exception dates for authenticated doctor',
  })
  @ApiOkResponse({
    description: 'List of exception dates retrieved successfully',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(PaginatedResponseDto),
        },
      ],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(GetSchedualExcepDto) },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Doctor not found' })
  @ApiBadRequestResponse({ description: 'Invalid request' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get('schedule/exception')
  GetAllScheduleExc(
    @CurrentUser() user: any,
    @Query() query: GetDoctorsQueryDto,
  ): Promise<PaginatedResponseDto<GetSchedualExcepDto>> {
    return this.doctorService.getAllExceptions(user.id, query);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'create' }])
  @Post('schedule/holidays')
  @ApiOperation({
    summary: 'Create a holiday/leave period for authenticated doctor',
  })
  @ApiResponse({
    status: 201,
    description: 'Holiday period created successfully',
    type: DoctorLeaveResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid data or overlapping dates',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  createHoliday(
    @CurrentUser() user: any,
    @Body() createDoctorLeaveDto: CreateDoctorLeaveDto,
  ): Promise<DoctorLeaveResponseDto> {
    return this.doctorService.createDoctorLeave(user.id, createDoctorLeaveDto);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'delete' }])
  @Delete('schedule/holidays/:id')
  @ApiOperation({
    summary: 'Delete a holiday/leave period for authenticated doctor',
  })
  @ApiResponse({
    status: 200,
    description: 'Holiday period deleted successfully',
    type: ResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Holiday period not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions or not your holiday',
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  deleteHoliday(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResponseDto> {
    return this.doctorService.deleteDoctorLeave(user.id, id);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'read' }])
  @Get('schedule/holidays')
  @ApiOperation({
    summary: 'Get all holiday/leave periods for authenticated doctor',
  })
  @ApiResponse({
    status: 200,
    description: 'Holiday periods retrieved successfully',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(PaginatedResponseDto),
        },
      ],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DoctorLeaveResponseDto) },
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  getAllHolidays(
    @CurrentUser() user: any,
    @Query() query: GetDoctorsQueryDto,
  ): Promise<PaginatedResponseDto<DoctorLeaveResponseDto>> {
    return this.doctorService.getAllDoctorLeaves(user.id, query);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'read' }])
  @Get('schedule/calendar')
  @ApiOperation({
    summary: 'Get doctor availability calendar for a specific month',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Month (1-12), defaults to current month',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Year (4 digits), defaults to current year',
    example: 2025,
  })
  @ApiResponse({
    status: 200,
    description: 'Calendar data retrieved successfully',
    type: CalendarResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  getDoctorCalendar(
    @CurrentUser() user: any,
    @Query() query: CalendarQueryDto,
  ): Promise<CalendarResponseDto> {
    return this.doctorService.getDoctorCalendar(user.id, query);
  }

  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions([{ resource: 'doctor', action: 'read' }])
  @Get('schedule/export')
  @ApiOperation({
    summary:
      'Export doctor schedule in various formats (ICS for Google Calendar)',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    description: 'Export format',
    enum: ['ics', 'json'],
    example: 'ics',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date for export (YYYY-MM-DD)',
    example: '2025-10-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date for export (YYYY-MM-DD)',
    example: '2025-10-31',
  })
  @ApiResponse({
    status: 200,
    description: 'Schedule exported successfully',
    content: {
      'text/calendar': {
        schema: {
          type: 'string',
          example: 'BEGIN:VCALENDAR\nVERSION:2.0\n...',
        },
      },
      'application/json': {
        schema: {
          type: 'object',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Doctor not found' })
  @ApiBadRequestResponse({ description: 'Invalid request parameters' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  async exportDoctorSchedule(
    @CurrentUser() user: any,
    @Query() query: ExportQueryDto,
    @Res() res: any,
  ) {
    const result = await this.doctorService.exportDoctorSchedule(
      user.id,
      query,
    );
    /**
       * const params = new URLSearchParams({
        format,
        ...(startDate && { startDate }),
        ...(endDate && { endDate })
        });
      
        const response = await fetch(
          `${API_BASE_URL}/api/doctors/schedule/export?${params}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          }
        );
    
          if (!response.ok) {
            throw new Error('Failed to download schedule');
          }
          * const blob = await response.blob();
          const filename = response.headers.get('Content-Disposition')
            ?.split('filename=')[1]
            ?.replace(/"/g, '') || `schedule.${format}`;
          
          // For React Native, you might need to use a library like react-native-fs
          // or expo-file-system to save the file
          const fileUri = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(fileUri, blob, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          
          // Open the file or share it
          await Sharing.shareAsync(fileUri);
          */
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.data);
  }

  @ApiOperation({ summary: 'Get a doctor by ID' })
  @ApiResponse({
    status: 200,
    description: 'Doctor retrieved successfully',
    type: DoctorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Doctor not found',
  })
  @ApiNotFoundResponse({ description: 'Doctor not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  @Get(':id')
  findOne(@Param('id') id: string): Promise<DoctorResponseDto> {
    return this.doctorService.findOne(id);
  }
}
