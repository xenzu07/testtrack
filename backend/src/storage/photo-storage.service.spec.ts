import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sniffImage } from './image-sniff';
import { PhotoStorageService } from './photo-storage.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

describe('sniffImage', () => {
  it('recognises real JPEG, PNG and WebP bytes', () => {
    expect(sniffImage(JPEG)?.ext).toBe('jpg');
    expect(sniffImage(PNG)?.ext).toBe('png');
    expect(sniffImage(WEBP)?.ext).toBe('webp');
  });

  it('rejects HTML, SVG, empty and tiny buffers', () => {
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(undefined)).toBeNull();
  });
});

describe('PhotoStorageService', () => {
  const config = new ConfigService({
    SUPABASE_URL: 'https://proj.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_STORAGE_BUCKET: 'report-photos',
    PHOTO_URL_TTL_SECONDS: '3600',
  });
  let fetchMock: jest.Mock;
  let svc: PhotoStorageService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    svc = new PhotoStorageService(config);
  });

  it('classifies stored values', () => {
    expect(PhotoStorageService.isStoragePath('reports/a/b.jpg')).toBe(true);
    expect(PhotoStorageService.isStoragePath('/uploads/x.jpg')).toBe(false);
    expect(PhotoStorageService.isStoragePath('https://x/y.jpg')).toBe(false);
    expect(PhotoStorageService.isStoragePath('')).toBe(false);
    expect(PhotoStorageService.isStoragePath(null)).toBe(false);
  });

  it('uploads with the sniffed type and extension, ignoring the claimed one', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const path = await svc.uploadImage(PNG, 'reports/r1');
    expect(path).toMatch(/^reports\/r1\/[0-9a-f-]{36}\.png$/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://proj.supabase.co/storage/v1/object/report-photos/${path}`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(init.headers['x-upsert']).toBe('false');
    expect(init.headers.Authorization).toBe('Bearer service-key');
  });

  it('accepts a Project URL with a copied /rest/v1 suffix', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const s = new PhotoStorageService(
      new ConfigService({
        SUPABASE_URL: ' https://proj.supabase.co/rest/v1/ ',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
      }),
    );
    const path = await s.uploadImage(JPEG, 'reports/r1');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://proj.supabase.co/storage/v1/object/report-photos/${path}`,
    );
  });

  it('rejects non-images before contacting storage', async () => {
    await expect(svc.uploadImage(HTML, 'reports/r1')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns storage failures into a retryable 503', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(svc.uploadImage(JPEG, 'reports/r1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(svc.uploadImage(JPEG, 'reports/r1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('signs nested photo fields in one batch, leaves legacy paths, nulls failures', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { path: 'reports/r1/a.jpg', signedURL: '/object/sign/report-photos/reports/r1/a.jpg?token=t1', error: null },
          { path: 'reports/r1/work/b.jpg', signedURL: null, error: 'Not found' },
        ]),
        { status: 200 },
      ),
    );
    const created = new Date();
    const data = [
      {
        createdAt: created,
        photos: [{ id: 'p1', storageUrl: 'reports/r1/a.jpg' }],
        logs: [
          { id: 'l1', photoUrl: 'reports/r1/work/b.jpg' },
          { id: 'l2', photoUrl: '/uploads/old.jpg' },
          { id: 'l3', photoUrl: null },
        ],
      },
      { report: { photos: [{ id: 'p2', storageUrl: 'reports/r1/a.jpg' }] } },
    ];

    await svc.signPhotoFields(data);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ expiresIn: 3600, paths: ['reports/r1/a.jpg', 'reports/r1/work/b.jpg'] });

    const signed =
      'https://proj.supabase.co/storage/v1/object/sign/report-photos/reports/r1/a.jpg?token=t1';
    expect(data[0].photos![0].storageUrl).toBe(signed);
    expect(data[1].report!.photos[0].storageUrl).toBe(signed);
    expect(data[0].logs![0].photoUrl).toBeNull();
    expect(data[0].logs![1].photoUrl).toBe('/uploads/old.jpg');
    expect(data[0].logs![2].photoUrl).toBeNull();
    expect(data[0].createdAt).toBe(created);

    // a second response reuses the cached URL without calling storage again
    const again = { photos: [{ storageUrl: 'reports/r1/a.jpg' }] };
    await svc.signPhotoFields(again);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.photos[0].storageUrl).toBe(signed);
  });

  it('does not fail the response when signing is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const data = { photos: [{ storageUrl: 'reports/r9/x.jpg' }] };
    await expect(svc.signPhotoFields(data)).resolves.toBe(data);
    expect(data.photos[0].storageUrl).toBeNull();
  });
});
