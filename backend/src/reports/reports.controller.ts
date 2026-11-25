import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { RouteReportDto } from './dto/route-report.dto';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { photoUpload } from '../common/photo-upload';
import { SignPhotoUrlsInterceptor } from '../storage/sign-photo-urls.interceptor';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SignPhotoUrlsInterceptor)
export class ReportsController {
  constructor(private reports: ReportsService) {}

  // any logged-in user: dropdown data
  @Get('options')
  options() {
    return this.reports.options();
  }

  @Roles(Role.REPORTER)
  @Post()
  @UseInterceptors(photoUpload)
  create(
    @Req() req: any,
    @Body() dto: CreateReportDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A photo is required to submit a report');
    }
    return this.reports.create(req.user.userId, dto, file);
  }

  @Roles(Role.REPORTER)
  @Get('mine')
  mine(@Req() req: any) {
    return this.reports.findMine(req.user.userId);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get()
  list(@Query() filters: ListReportsDto) {
    return this.reports.findAll(filters);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Patch(':id/route')
  route(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: RouteReportDto,
  ) {
    return this.reports.routeReport(id, req.user.userId, dto);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.reports.findOne(id, req.user);
  }

  @Roles(Role.REPORTER)
  @Post(':id/feedback')
  feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.reports.addFeedback(id, req.user.userId, dto);
  }
}
