import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    // the client always gets the same generic message; the real reason is
    // only written to the server console (the password is never logged)
    const tried = email.trim().toLowerCase();
    if (!user) {
      this.logger.warn(`Login failed for "${tried}": no user with that email in this database`);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      this.logger.warn(`Login failed for "${tried}": account is inactive`);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      this.logger.warn(`Login failed for "${tried}": wrong password (${password.length} characters received)`);
      throw new UnauthorizedException('Invalid email or password');
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return {
      accessToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        tradeUnitId: user.tradeUnitId,
      },
    };
  }
}