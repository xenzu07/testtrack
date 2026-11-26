import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

// Slows down password guessing by counting failed sign-ins.
// - per IP + email: stops guessing one account
// - per IP: stops spraying many accounts from one address
// Counts live in memory: one backend instance is assumed. If the backend is
// ever scaled to several instances, move these counters to a shared store.
@Injectable()
export class LoginThrottle {
  private readonly windowMs = 15 * 60 * 1000;
  private readonly maxPerAccount = 5;
  private readonly maxPerIp = 20;
  private readonly failures = new Map<string, Bucket>();

  private keys(ip: string, email: string) {
    return { account: `acct:${ip}|${email}`, ip: `ip:${ip}` };
  }

  private active(key: string, now: number): Bucket | null {
    const b = this.failures.get(key);
    if (!b) return null;
    if (b.resetAt <= now) {
      this.failures.delete(key);
      return null;
    }
    return b;
  }

  assertAllowed(ip: string, email: string) {
    const now = Date.now();
    const k = this.keys(ip, email);
    const acct = this.active(k.account, now);
    const byIp = this.active(k.ip, now);
    const blocked =
      (acct && acct.count >= this.maxPerAccount ? acct : null) ??
      (byIp && byIp.count >= this.maxPerIp ? byIp : null);
    if (blocked) {
      const minutes = Math.max(1, Math.ceil((blocked.resetAt - now) / 60000));
      throw new HttpException(
        `Too many failed sign-in attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(ip: string, email: string) {
    const now = Date.now();
    const k = this.keys(ip, email);
    for (const key of [k.account, k.ip]) {
      const b = this.active(key, now);
      if (b) b.count += 1;
      else this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    }
    if (this.failures.size > 10_000) this.prune(now);
  }

  // a successful sign-in clears that account's counter (not the IP's)
  reset(ip: string, email: string) {
    this.failures.delete(this.keys(ip, email).account);
  }

  private prune(now: number) {
    for (const [key, b] of this.failures) {
      if (b.resetAt <= now) this.failures.delete(key);
    }
  }
}
