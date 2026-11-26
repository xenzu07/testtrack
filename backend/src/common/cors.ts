import { Logger } from '@nestjs/common';

// CORS_ORIGINS: comma-separated list of browser origins allowed to call the
// API, e.g. "https://dashboard.example.edu,https://app.example.edu".
// Native mobile apps send no Origin header and are not affected.
// When unset, every origin is allowed (development only; a warning is logged).
export function allowedOrigins(): string[] | null {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Outside production, any localhost / 127.0.0.1 port is allowed so the Vite
// dev server still works when it falls back to 5174, 5175, ... because 5173
// is already taken.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin requests, curl, native apps
  const list = allowedOrigins();
  if (list === null || list.includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && LOOPBACK_ORIGIN.test(origin);
}

// shared by the HTTP server and the websocket gateway
export const corsOriginCheck = (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => cb(null, isOriginAllowed(origin));

export function warnIfCorsOpen() {
  if (allowedOrigins() === null) {
    new Logger('CORS').warn(
      'CORS_ORIGINS is not set: any website may call this API from a browser. ' +
        'Set CORS_ORIGINS to the dashboard URL(s) in production.',
    );
  }
}
