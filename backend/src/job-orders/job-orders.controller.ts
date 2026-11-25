import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
} from '@nestjs/common';
import { Role, Status } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { photoUpload } from '../common/photo-upload';
import { SignPhotoUrlsInterceptor } from '../storage/sign-photo-urls.interceptor';
import { JobOrdersService } from './job-orders.service';
import { CreateJobOrderDto } from './dto/create-job-order.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { AssignTechnicianDto } from './dto/assign-technician.dto';
import { AddProgressDto } from './dto/add-progress.dto';
import { ReportDelayDto } from './dto/report-delay.dto';
import { ResumeJobDto } from './dto/resume-job.dto';
import { VerifyJobDto } from './dto/verify-job.dto';
import { DeclineJobDto } from './dto/decline-job.dto';

@Controller('job-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SignPhotoUrlsInterceptor)
export class JobOrdersController {
  constructor(private jobs: JobOrdersService) {}

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Post()
  create(@Req() req: any, @Body() dto: CreateJobOrderDto) {
    return this.jobs.create(req.user.userId, dto);
  }

  // technicians for the dashboard's "assign technician" dropdown
  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get('technicians')
  technicians(
    @Query('tradeUnitId', new ParseUUIDPipe({ optional: true }))
    tradeUnitId?: string,
  ) {
    return this.jobs.listTechnicians(tradeUnitId);
  }

  @Roles(Role.TECHNICIAN)
  @Get('assigned')
  assigned(@Req() req: any) {
    return this.jobs.findAssigned(req.user.userId);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get()
  list(
    @Query('status', new ParseEnumPipe(Status, { optional: true }))
    status?: Status,
  ) {
    return this.jobs.findAll(status);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.jobs.findOne(id, req.user);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Patch(':id/verify')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: VerifyJobDto,
  ) {
    return this.jobs.verify(id, req.user.userId, dto);
  }

  // printable job order form
  @Get(':id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const { buffer, filename } = await this.jobs.buildPdf(id, req.user);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Patch(':id/technician')
  assignTechnician(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: AssignTechnicianDto,
  ) {
    return this.jobs.assignTechnician(id, req.user.userId, dto);
  }

  // the assigned technician answers the assignment (once)
  @Roles(Role.TECHNICIAN)
  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.jobs.respond(id, req.user.userId, true);
  }

  @Roles(Role.TECHNICIAN)
  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: DeclineJobDto,
  ) {
    return this.jobs.respond(id, req.user.userId, false, dto.reason);
  }

  // multipart: status, remarks (optional), photo (required for COMPLETED)
  @Roles(Role.TECHNICIAN)
  @Patch(':id/status')
  @UseInterceptors(photoUpload)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: UpdateJobStatusDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.jobs.updateStatus(id, req.user.userId, dto, file);
  }

  // multipart: remarks (required), photo (optional)
  @Roles(Role.TECHNICIAN)
  @Post(':id/progress')
  @UseInterceptors(photoUpload)
  addProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: AddProgressDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.jobs.addProgress(id, req.user.userId, dto, file);
  }

  @Roles(Role.TECHNICIAN, Role.COORDINATOR, Role.ADMIN)
  @Post(':id/delay')
  reportDelay(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: ReportDelayDto,
  ) {
    return this.jobs.reportDelay(id, req.user, dto);
  }

  @Roles(Role.TECHNICIAN, Role.COORDINATOR, Role.ADMIN)
  @Post(':id/resume')
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: ResumeJobDto,
  ) {
    return this.jobs.resume(id, req.user, dto);
  }
}
