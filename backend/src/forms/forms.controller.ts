import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FormStatus, Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DecideFormDto, ReturnFormDto, SubmitFormDto } from './dto/form.dto';
import { FormsService, MAX_SIGNATURE_BYTES } from './forms.service';

// the signature arrives as a small PNG drawn on the phone
const signatureUpload = FileInterceptor('signature', {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_SIGNATURE_BYTES,
    files: 1,
    fields: 20,
    fieldSize: 16 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype !== 'image/png' &&
      file.mimetype !== 'application/octet-stream'
    ) {
      return cb(
        new BadRequestException('The signature must be a PNG image'),
        false,
      );
    }
    cb(null, true);
  },
});

const pdfResponse = ({
  buffer,
  filename,
}: {
  buffer: Buffer;
  filename: string;
}) =>
  new StreamableFile(buffer, {
    type: 'application/pdf',
    disposition: `inline; filename="${filename}"`,
  });

@Controller('job-order-forms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FormsController {
  constructor(private forms: FormsService) {}

  // ---- reporter
  @Roles(Role.REPORTER)
  @Get('prefill/:reportId')
  prefill(@Param('reportId', ParseUUIDPipe) reportId: string, @Req() req: any) {
    return this.forms.prefill(reportId, req.user.userId);
  }

  // multipart: the form fields + "signature" (PNG)
  @Roles(Role.REPORTER)
  @Post()
  @UseInterceptors(signatureUpload)
  submit(
    @Req() req: any,
    @Body() dto: SubmitFormDto,
    @UploadedFile() signature?: Express.Multer.File,
  ) {
    return this.forms.submit(req.user.userId, dto, signature);
  }

  @Roles(Role.REPORTER)
  @Get('mine')
  mine(@Req() req: any) {
    return this.forms.mine(req.user.userId);
  }

  // ---- coordinators/admins
  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get()
  list(
    @Query('status', new ParseEnumPipe(FormStatus, { optional: true }))
    status?: FormStatus,
  ) {
    return this.forms.list(status);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Post(':id/receive')
  @HttpCode(200)
  receive(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.forms.decide(id, req.user.userId, 'receive');
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: DecideFormDto,
  ) {
    return this.forms.decide(id, req.user.userId, 'approve', dto.note);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Post(':id/return')
  @HttpCode(200)
  returnForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: ReturnFormDto,
  ) {
    return this.forms.decide(id, req.user.userId, 'return', dto.reason);
  }

  // ---- requester or coordinators (checked in the service)
  @Roles(Role.REPORTER, Role.COORDINATOR, Role.ADMIN)
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.forms.findOne(id, req.user);
  }

  @Roles(Role.REPORTER, Role.COORDINATOR, Role.ADMIN)
  @Get(':id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return pdfResponse(await this.forms.pdf(id, req.user));
  }

  @Roles(Role.REPORTER, Role.COORDINATOR, Role.ADMIN)
  @Post(':id/pdf-link')
  @HttpCode(200)
  pdfLink(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.forms.pdfLink(id, req.user);
  }
}

// Opened by the phone's browser or PDF viewer, which cannot send the login
// token: access is granted by the short-lived link token instead.
@Controller('job-order-forms')
export class FormsSharedPdfController {
  constructor(private forms: FormsService) {}

  @Get(':id/shared-pdf')
  async sharedPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token?: string,
  ) {
    if (!token) throw new BadRequestException('Missing link token');
    return pdfResponse(await this.forms.pdfByToken(id, token));
  }
}
