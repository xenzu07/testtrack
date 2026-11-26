import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SubmitSurveyDto } from './dto/submit-survey.dto';
import { TechniciansService } from './technicians.service';

@Controller('technicians')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TechniciansController {
  constructor(private technicians: TechniciansService) {}

  // the signed-in technician's own survey
  @Roles(Role.TECHNICIAN)
  @Get('survey')
  survey(@Req() req: any) {
    return this.technicians.getSurvey(req.user.userId);
  }

  @Roles(Role.TECHNICIAN)
  @Post('survey')
  submit(@Req() req: any, @Body() dto: SubmitSurveyDto) {
    return this.technicians.submitSurvey(req.user.userId, dto);
  }

  // coordinators/admins: technicians with roles and workload,
  // optionally only those qualified for one trade unit
  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get()
  list(
    @Query('tradeUnitId', new ParseUUIDPipe({ optional: true }))
    tradeUnitId?: string,
  ) {
    return this.technicians.list(tradeUnitId);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get(':id/survey')
  surveyFor(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicians.surveyFor(id);
  }
}
