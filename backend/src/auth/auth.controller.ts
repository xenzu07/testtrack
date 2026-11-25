import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: any) {
    // req.ip honours TRUST_PROXY (see main.ts) when behind a reverse proxy
    const ip: string = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.auth.login(dto.email, dto.password, ip);
  }

  // the signed-in user's own profile (used for dashboard headers)
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.auth.profile(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(200)
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.userId, dto.currentPassword, dto.newPassword);
  }

  // signing out on one device only needs the client to drop its token;
  // this ends the sessions on every device (e.g. a lost phone)
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@Req() req: any) {
    return this.auth.logoutEverywhere(req.user.userId);
  }
}
