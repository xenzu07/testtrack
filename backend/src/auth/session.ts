import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// claims carried in every access token
export interface JwtPayload {
  sub: string;
  role: Role;
  // session version: bumping User.tokenVersion invalidates every older token
  ver?: number;
}

// what guards and controllers see as req.user
export interface SessionUser {
  userId: string;
  role: Role;
}

export const JWT_ALGORITHM = 'HS256' as const;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

// refuses to start with a weak signing secret
export function jwtSecret(config: ConfigService): string {
  const secret = config.getOrThrow<string>('JWT_SECRET');
  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`,
    );
  }
  return secret;
}

// The role, active flag and session version always come from the database,
// so role changes, deactivation, password changes and "sign out everywhere"
// take effect immediately instead of when the token expires.
export async function resolveSessionUser(
  prisma: PrismaService,
  payload: Partial<JwtPayload> | null | undefined,
): Promise<SessionUser | null> {
  if (!payload?.sub || typeof payload.sub !== 'string') return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive) return null;
  // tokens issued before this change carry no version and count as version 0
  if ((payload.ver ?? 0) !== user.tokenVersion) return null;
  return { userId: user.id, role: user.role };
}
