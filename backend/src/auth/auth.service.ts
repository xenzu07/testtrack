import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottle } from './login-throttle';
import { hashPassword, needsRehash, timingSafeDummyHash } from './password';
import { JwtPayload } from './session';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private throttle: LoginThrottle,
  ) {}

  private issueToken(user: { id: string; role: JwtPayload['role']; tokenVersion: number }) {
    const payload: JwtPayload = { sub: user.id, role: user.role, ver: user.tokenVersion };
    return this.jwt.signAsync(payload);
  }

  async login(email: string, password: string, ip: string) {
    const tried = email.trim().toLowerCase();
    this.throttle.assertAllowed(ip, tried);

    const user = await this.prisma.user.findUnique({ where: { email: tried } });
    // always run bcrypt, even for unknown emails, so timing does not reveal
    // which accounts exist
    const passwordOk = await bcrypt.compare(
      password,
      user?.passwordHash ?? (await timingSafeDummyHash()),
    );

    // the client always gets the same generic message; the real reason is
    // only written to the server log (nothing about the password is logged)
    const reason = !user
      ? 'no user with that email'
      : !passwordOk
        ? 'wrong password'
        : !user.isActive
          ? 'account is inactive'
          : null;
    if (!user || reason) {
      this.throttle.recordFailure(ip, tried);
      this.logger.warn(`Login failed for "${tried}" from ${ip}: ${reason}`);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.throttle.reset(ip, tried);

    // transparently upgrade hashes made with the older, weaker cost factor
    if (needsRehash(user.passwordHash)) {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        });
      } catch (e) {
        this.logger.warn(`Could not upgrade password hash for ${user.id}: ${String(e)}`);
      }
    }

    return {
      accessToken: await this.issueToken(user),
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        tradeUnitId: user.tradeUnitId,
        // technicians are asked for the skills survey until this is set
        surveyCompletedAt: user.surveyCompletedAt,
      },
    };
  }

  // keeps the original { userId, role } fields so existing callers still work
  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        userType: true,
        surveyCompletedAt: true,
        tradeUnit: { select: { id: true, name: true } },
        technicianRoles: {
          select: { score: true, tradeUnit: { select: { id: true, name: true } } },
          orderBy: { score: 'desc' },
        },
      },
    });
    if (!user) throw new UnauthorizedException();
    return { userId: user.id, ...user };
  }

  // signed-in user changes their own password; every other session ends,
  // and this device receives a fresh token so it stays signed in
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Your current password is incorrect');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('The new password must be different from the current one');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        tokenVersion: { increment: 1 },
      },
    });
    return { accessToken: await this.issueToken(updated) };
  }

  // ends every session of this user on every device
  async logoutEverywhere(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { ok: true };
  }
}
