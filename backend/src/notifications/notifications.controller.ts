import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto, RegisterDeviceDto, RemoveDeviceDto } from './dto/notifications.dto';

// Every route works on the signed-in user's own notifications and devices
// only; there is no way to read or change another person's.
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@Req() req: any, @Query() q: ListNotificationsDto) {
    return this.notifications.list(req.user.userId, q.limit, q.before);
  }

  @Get('unread-count')
  async unread(@Req() req: any) {
    return { unread: await this.notifications.unreadCount(req.user.userId) };
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Req() req: any) {
    return this.notifications.markAllRead(req.user.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }

  // public VAPID key for browsers, and which push channels are switched on
  @Get('push-config')
  pushConfig() {
    return this.notifications.pushConfig();
  }

  @Post('devices')
  @HttpCode(200)
  register(@Req() req: any, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(req.user.userId, dto);
  }

  @Delete('devices')
  remove(@Req() req: any, @Body() dto: RemoveDeviceDto) {
    return this.notifications.removeDevice(req.user.userId, dto.token);
  }
}
