import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_ALGORITHM, JwtPayload, jwtSecret, resolveSessionUser } from './session';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config),
      algorithms: [JWT_ALGORITHM],
    });
  }

  // role comes from the database, so role changes and deactivation apply at once
  async validate(payload: JwtPayload) {
    const user = await resolveSessionUser(this.prisma, payload);
    if (!user) {
      throw new UnauthorizedException('Your session has ended. Please sign in again.');
    }
    return user;
  }
}
