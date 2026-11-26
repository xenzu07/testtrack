import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { sniffImage } from './image-sniff';

// Photos live in a PRIVATE Supabase Storage bucket. Only this backend (using
// the service-role key) can upload, read or delete objects. Clients never get
// the key: they receive short-lived signed URLs, and only inside responses the
// backend has already authorised (e.g. a reporter's own report).
//
// The database stores the object path (e.g. "reports/<reportId>/<uuid>.jpg")
// in ReportPhoto.storageUrl and StatusLog.photoUrl. Older rows still hold
// "/uploads/<file>" paths from the previous local-disk storage; those are
// left untouched here and served by the legacy route until migrated
// (see scripts/migrate-legacy-uploads.ts).
@Injectable()
export class PhotoStorageService implements OnModuleInit {
  private readonly logger = new Logger(PhotoStorageService.name);
  private readonly baseUrl: string;
  private readonly key: string;
  readonly bucket: string;
  private readonly ttlSeconds: number;
  private readonly signed = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  constructor(config: ConfigService) {
    // accepts the Project URL with or without a copied "/rest/v1" or
    // "/storage/v1" suffix (the dashboard shows both next to each other)
    this.baseUrl = config
      .getOrThrow<string>('SUPABASE_URL')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/(rest|storage)\/v1$/i, '');
    this.key = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket =
      config.get<string>('SUPABASE_STORAGE_BUCKET') || 'report-photos';
    const ttl = Number(config.get<string>('PHOTO_URL_TTL_SECONDS') ?? 3600);
    this.ttlSeconds = Number.isFinite(ttl)
      ? Math.min(Math.max(ttl, 300), 86400)
      : 3600;
  }

  // a missing or public bucket is reported loudly at startup, without
  // stopping the server (a network blip at boot should not take it down)
  async onModuleInit() {
    try {
      const res = await this.request(
        'GET',
        `/bucket/${encodeURIComponent(this.bucket)}`,
      );
      if (!res.ok) {
        const body = await res.text();
        if (/bucket not found/i.test(body)) {
          this.logger.error(
            `Storage bucket "${this.bucket}" does not exist. Run prisma/sql/001_phase1_security.sql ` +
              'to create it. Photo uploads will fail until then.',
          );
        } else if (/PGRST/.test(body)) {
          this.logger.error(
            'SUPABASE_URL does not point at the project root. Use the Project URL, ' +
              'e.g. https://<project-ref>.supabase.co (nothing after .supabase.co).',
          );
        } else if (
          res.status === 401 ||
          res.status === 403 ||
          /jws|jwt|signature|unauthori[sz]ed/i.test(body)
        ) {
          this.logger.error(
            'Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Use the secret / service_role key ' +
              '(not the anon or publishable key).',
          );
        } else {
          this.logger.error(
            `Could not check storage bucket (HTTP ${res.status}): ${body.slice(0, 300)}`,
          );
        }
        return;
      }
      const bucket = (await res.json()) as { public?: boolean };
      if (bucket.public) {
        this.logger.error(
          `Storage bucket "${this.bucket}" is PUBLIC: anyone with a link can see report photos. ` +
            'Make it private (Supabase dashboard > Storage > bucket settings).',
        );
      } else {
        this.logger.log(`Using private storage bucket "${this.bucket}"`);
      }
    } catch (e) {
      this.logger.error(`Could not reach Supabase Storage: ${String(e)}`);
    }
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  private request(method: string, path: string, init: RequestInit = {}) {
    return fetch(`${this.baseUrl}/storage/v1${path}`, {
      ...init,
      method,
      headers: this.headers((init.headers as Record<string, string>) ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
  }

  private objectUrl(objectPath: string) {
    const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
    return `/object/${encodeURIComponent(this.bucket)}/${encoded}`;
  }

  // true for paths stored by this service (not legacy "/uploads/..." values
  // and not absolute URLs)
  static isStoragePath(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      !value.startsWith('/') &&
      !/^https?:\/\//i.test(value)
    );
  }

  // Validates the bytes and uploads them. Returns the object path to store.
  async uploadImage(
    data: Buffer,
    folder: string,
    opts: { name?: string; upsert?: boolean } = {},
  ): Promise<string> {
    const kind = sniffImage(data);
    if (!kind) {
      throw new BadRequestException(
        'The photo must be a JPEG, PNG or WebP image',
      );
    }
    const objectPath = `${folder.replace(/^\/+|\/+$/g, '')}/${opts.name ?? randomUUID()}.${kind.ext}`;
    let res: Response;
    try {
      res = await this.request('POST', this.objectUrl(objectPath), {
        body: new Blob([new Uint8Array(data)], { type: kind.mime }),
        headers: {
          'Content-Type': kind.mime,
          'x-upsert': opts.upsert ? 'true' : 'false',
          'cache-control': 'private, max-age=3600',
        },
      });
    } catch (e) {
      this.logger.error(`Photo upload to storage failed: ${String(e)}`);
      throw new ServiceUnavailableException(
        'The photo could not be uploaded. Please try again.',
      );
    }
    if (!res.ok) {
      this.logger.error(
        `Photo upload rejected (HTTP ${res.status}): ${await res.text()}`,
      );
      throw new ServiceUnavailableException(
        'The photo could not be uploaded. Please try again.',
      );
    }
    return objectPath;
  }

  // Reads an object back (backend only), e.g. to put a signature into a PDF.
  async download(objectPath: string): Promise<Buffer> {
    let res: Response;
    try {
      res = await this.request(
        'GET',
        `/object/authenticated${this.objectUrl(objectPath).slice('/object'.length)}`,
      );
    } catch (e) {
      this.logger.error(`Download of ${objectPath} failed: ${String(e)}`);
      throw new ServiceUnavailableException(
        'A stored file could not be read. Please try again.',
      );
    }
    if (!res.ok) {
      this.logger.error(
        `Download of ${objectPath} rejected (HTTP ${res.status})`,
      );
      throw new ServiceUnavailableException(
        'A stored file could not be read. Please try again.',
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // used to clean up when the database write after an upload fails
  async removeQuietly(objectPath: string | null | undefined) {
    if (!PhotoStorageService.isStoragePath(objectPath)) return;
    try {
      const res = await this.request(
        'DELETE',
        `/object/${encodeURIComponent(this.bucket)}`,
        {
          body: JSON.stringify({ prefixes: [objectPath] }),
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok)
        this.logger.warn(`Could not delete ${objectPath}: HTTP ${res.status}`);
    } catch (e) {
      this.logger.warn(`Could not delete ${objectPath}: ${String(e)}`);
    }
  }

  // Returns a signed URL per path. Paths that could not be signed are absent.
  // URLs are cached and reused until 5 minutes before they expire, so lists
  // don't re-sign every photo on each request and clients can cache images.
  async signUrls(paths: string[]): Promise<Map<string, string>> {
    const now = Date.now();
    const result = new Map<string, string>();
    const missing: string[] = [];
    for (const p of new Set(paths)) {
      const hit = this.signed.get(p);
      if (hit && hit.expiresAt - now > 5 * 60_000) result.set(p, hit.url);
      else missing.push(p);
    }

    for (let i = 0; i < missing.length; i += 500) {
      const chunk = missing.slice(i, i + 500);
      try {
        const res = await this.request(
          'POST',
          `/object/sign/${encodeURIComponent(this.bucket)}`,
          {
            body: JSON.stringify({ expiresIn: this.ttlSeconds, paths: chunk }),
            headers: { 'Content-Type': 'application/json' },
          },
        );
        if (!res.ok) {
          this.logger.warn(
            `Could not sign photo URLs (HTTP ${res.status}): ${await res.text()}`,
          );
          continue;
        }
        const rows = (await res.json()) as {
          path: string | null;
          signedURL: string | null;
          error: string | null;
        }[];
        for (const row of rows) {
          if (!row.path || !row.signedURL || row.error) continue;
          const url = `${this.baseUrl}/storage/v1${row.signedURL}`;
          result.set(row.path, url);
          this.signed.set(row.path, {
            url,
            expiresAt: now + this.ttlSeconds * 1000,
          });
        }
      } catch (e) {
        this.logger.warn(`Could not sign photo URLs: ${String(e)}`);
      }
    }

    if (this.signed.size > 5000) {
      for (const [p, v] of this.signed)
        if (v.expiresAt <= now) this.signed.delete(p);
    }
    return result;
  }

  // Replaces every storage path found under a `storageUrl` or `photoUrl` key
  // in a response with a signed URL. A photo that cannot be signed becomes
  // null so clients show their "photo unavailable" state instead of failing.
  async signPhotoFields<T>(data: T): Promise<T> {
    const hits: { obj: Record<string, unknown>; key: string; path: string }[] =
      [];
    const visit = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!v || typeof v !== 'object') return;
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return; // Date, Buffer, streams…
      const obj = v as Record<string, unknown>;
      for (const [k, val] of Object.entries(obj)) {
        if (
          (k === 'storageUrl' || k === 'photoUrl') &&
          PhotoStorageService.isStoragePath(val)
        ) {
          hits.push({ obj, key: k, path: val });
        } else {
          visit(val);
        }
      }
    };
    visit(data);
    if (hits.length === 0) return data;

    const urls = await this.signUrls(hits.map((h) => h.path));
    for (const h of hits) h.obj[h.key] = urls.get(h.path) ?? null;
    return data;
  }
}
