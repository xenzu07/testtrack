import { applyDecorators } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { IsString, Matches, MinLength, ValidateBy } from 'class-validator';

// Cost 12 is roughly 4x slower to brute force than the previous 10.
// Older cost-10 hashes keep working and are upgraded on the next sign-in.
export const BCRYPT_ROUNDS = 12;

// bcrypt silently ignores everything after 72 bytes
export const BCRYPT_MAX_BYTES = 72;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_ROUNDS;
  } catch {
    return false;
  }
}

// Compared against when the email does not exist, so a failed sign-in takes
// the same time whether or not the account exists (no account enumeration).
let dummyHash: Promise<string> | null = null;
export function timingSafeDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('timing-equaliser-not-a-real-password', BCRYPT_ROUNDS);
  return dummyHash;
}

// Rules for every password a user or admin sets.
export function IsAcceptablePassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: 'Password must be at least 8 characters' }),
    ValidateBy({
      name: 'maxBytes',
      validator: {
        validate: (v: unknown) =>
          typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= BCRYPT_MAX_BYTES,
        defaultMessage: () => `Password must be at most ${BCRYPT_MAX_BYTES} bytes`,
      },
    }),
    Matches(/[A-Za-z]/, { message: 'Password must contain at least one letter' }),
    Matches(/\d/, { message: 'Password must contain at least one number' }),
  );
}
