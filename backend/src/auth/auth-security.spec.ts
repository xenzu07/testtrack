import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role } from '@prisma/client';
import { LoginThrottle } from './login-throttle';
import { resolveSessionUser } from './session';
import { ResetPasswordDto } from '../users/dto/reset-password.dto';

describe('LoginThrottle', () => {
  it('blocks an account after 5 failures from the same IP, not other IPs', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 5; i++) {
      t.assertAllowed('1.1.1.1', 'a@x.com');
      t.recordFailure('1.1.1.1', 'a@x.com');
    }
    expect(() => t.assertAllowed('1.1.1.1', 'a@x.com')).toThrow(HttpException);
    expect(() => t.assertAllowed('2.2.2.2', 'a@x.com')).not.toThrow();
  });

  it('blocks an IP spraying many accounts after 20 failures', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 20; i++) t.recordFailure('9.9.9.9', `u${i}@x.com`);
    expect(() => t.assertAllowed('9.9.9.9', 'fresh@x.com')).toThrow(HttpException);
  });

  it('returns 429 and clears the account counter on success', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 4; i++) t.recordFailure('1.1.1.1', 'a@x.com');
    t.reset('1.1.1.1', 'a@x.com');
    t.recordFailure('1.1.1.1', 'a@x.com');
    expect(() => t.assertAllowed('1.1.1.1', 'a@x.com')).not.toThrow();
    for (let i = 0; i < 5; i++) t.recordFailure('1.1.1.1', 'a@x.com');
    try {
      t.assertAllowed('1.1.1.1', 'a@x.com');
      fail('expected a throw');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
    }
  });
});

describe('resolveSessionUser', () => {
  const prismaWith = (user: unknown) =>
    ({ user: { findUnique: jest.fn().mockResolvedValue(user) } }) as never;
  const active = { id: 'u1', role: Role.TECHNICIAN, isActive: true, tokenVersion: 2 };

  it('accepts a token whose version matches, using the role from the database', async () => {
    const u = await resolveSessionUser(prismaWith(active), {
      sub: 'u1',
      role: Role.COORDINATOR, // stale/forged role in the token is ignored
      ver: 2,
    });
    expect(u).toEqual({ userId: 'u1', role: Role.TECHNICIAN });
  });

  it('rejects older token versions, inactive users, unknown users and bad payloads', async () => {
    expect(await resolveSessionUser(prismaWith(active), { sub: 'u1', ver: 1 })).toBeNull();
    expect(await resolveSessionUser(prismaWith(active), { sub: 'u1' })).toBeNull();
    expect(
      await resolveSessionUser(prismaWith({ ...active, isActive: false }), { sub: 'u1', ver: 2 }),
    ).toBeNull();
    expect(await resolveSessionUser(prismaWith(null), { sub: 'u1', ver: 2 })).toBeNull();
    expect(await resolveSessionUser(prismaWith(active), null)).toBeNull();
  });

  it('keeps pre-upgrade tokens (no "ver") valid while the version is still 0', async () => {
    const u = await resolveSessionUser(prismaWith({ ...active, tokenVersion: 0 }), { sub: 'u1' });
    expect(u).toEqual({ userId: 'u1', role: Role.TECHNICIAN });
  });
});

describe('password policy', () => {
  const errors = (newPassword: unknown) =>
    validateSync(plainToInstance(ResetPasswordDto, { newPassword })).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );

  it('accepts reasonable passwords', () => {
    expect(errors('password123')).toEqual([]);
    expect(errors('correct horse 9 battery')).toEqual([]);
  });

  it('rejects short, letter-only, digit-only and over-72-byte passwords', () => {
    expect(errors('abc12')).not.toEqual([]);
    expect(errors('abcdefghij')).not.toEqual([]);
    expect(errors('1234567890')).not.toEqual([]);
    expect(errors('a1' + 'é'.repeat(36))).not.toEqual([]); // 74 bytes
    expect(errors(12345678)).not.toEqual([]);
  });
});
