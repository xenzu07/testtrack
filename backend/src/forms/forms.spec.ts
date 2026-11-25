import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { FormStatus, Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { deflateSync } from 'zlib';
import { SubmitFormDto } from './dto/form.dto';
import { contentHash, fingerprint, sha256 } from './form-integrity';
import { buildFormPdf } from './form-pdf';
import { FormsService } from './forms.service';

// a real, tiny 2x1 PNG (built here so the test has no files)
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const valid = {
  reportId: '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
  department: 'College of Engineering',
  contactNumber: '0917 123 4567',
  workRequested: 'Replace the broken outlet near the teacher table',
  certified: 'true',
};
const errors = (o: object) =>
  validateSync(plainToInstance(SubmitFormDto, o)).flatMap((e) => Object.values(e.constraints ?? {}));

describe('Job Order Form validation', () => {
  it('accepts a complete form', () => {
    expect(errors(valid)).toEqual([]);
    expect(errors({ ...valid, contactNumber: '+63 (46) 123-4567', preferredSchedule: '', notes: '  ' })).toEqual([]);
  });

  it('requires department, contact, work description and the certification', () => {
    expect(errors({ ...valid, department: ' ' })).toContain('Department or office is required');
    expect(errors({ ...valid, contactNumber: 'call me' }).join()).toMatch(/contact number/);
    expect(errors({ ...valid, workRequested: 'fix it' }).join()).toMatch(/at least 10/);
    expect(errors({ ...valid, certified: 'false' }).join()).toMatch(/true and correct/);
    expect(errors({ ...valid, certified: undefined }).join()).toMatch(/true and correct/);
  });
});

const signed = {
  formNo: 'JOF-2026-0001',
  revision: 1,
  reportId: 'r1',
  requesterId: 'u1',
  requesterName: 'Test Student',
  requesterEmail: 'student@test.com',
  requesterType: 'student',
  department: 'CEIT',
  contactNumber: '0917 000 0000',
  workRequested: 'Replace outlet',
  locationText: 'Main Building, 1st Floor, Room 101',
  categoryName: 'Faulty Wiring / Outlet',
  urgency: 'HIGH',
  preferredSchedule: null,
  notes: null,
  certified: true,
  signedAt: new Date('2026-11-25T03:00:00Z'),
  signatureHash: sha256(png()),
};

describe('signature integrity', () => {
  it('same content gives the same fingerprint; any change is detected', () => {
    const h = contentHash(signed);
    expect(contentHash({ ...signed })).toBe(h);
    expect(contentHash({ ...signed, workRequested: 'Replace outlet and switch' })).not.toBe(h);
    expect(contentHash({ ...signed, signatureHash: sha256('other image') })).not.toBe(h);
    expect(fingerprint(h)).toMatch(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
  });

  it('renders a PDF with the signature image', async () => {
    const pdf = await buildFormPdf(
      {
        ...signed,
        status: 'APPROVED',
        submittedAt: signed.signedAt,
        contentHash: contentHash(signed),
        receivedAt: signed.signedAt,
        receivedBy: { fullName: 'GSO Coordinator' },
        decidedAt: signed.signedAt,
        decidedBy: { fullName: 'GSO Coordinator' },
        decisionNote: 'OK',
        report: { jobOrder: { jobOrderNo: 'JO-2026-0009', status: 'ASSIGNED' } },
      },
      png(),
      { contentOk: true, signatureOk: true },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  });
});

describe('FormsService rules', () => {
  const report = (over: object = {}) => ({
    id: valid.reportId,
    reporterId: 'u1',
    status: 'SUBMITTED',
    urgency: 'HIGH',
    category: { name: 'Faulty Wiring / Outlet' },
    location: { building: 'Main Building', floor: '1st Floor', room: 'Room 101' },
    jobOrderForm: null,
    ...over,
  });
  const make = (rep: object | null, extra: Record<string, unknown> = {}) => {
    const prisma = {
      report: { findUnique: jest.fn().mockResolvedValue(rep) },
      user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Test Student', email: 's@x', userType: 'student' }) },
      jobOrderForm: { findUnique: jest.fn() },
      ...extra,
    };
    const storage = { uploadImage: jest.fn(), removeQuietly: jest.fn(), signUrls: jest.fn().mockResolvedValue(new Map()) };
    const jwt = { signAsync: jest.fn().mockResolvedValue('tok'), verifyAsync: jest.fn() };
    return { svc: new FormsService(prisma as never, storage as never, {} as never, jwt as never, { emit: jest.fn(), emitPriorityReview: jest.fn() } as never), prisma, storage, jwt };
  };
  const dto = { ...valid, certified: true } as SubmitFormDto;
  const file = (buf: Buffer) => ({ buffer: buf, size: buf.length }) as Express.Multer.File;

  it('needs a PNG signature', async () => {
    const { svc, storage } = make(report());
    await expect(svc.submit('u1', dto)).rejects.toThrow('Please sign the form');
    await expect(svc.submit('u1', dto, file(Buffer.from('<svg/>')))).rejects.toThrow('PNG');
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('only the reporter of the report can submit, and not for a closed report', async () => {
    await expect(make(report({ reporterId: 'someone' })).svc.submit('u1', dto, file(png()))).rejects.toThrow('Report not found');
    await expect(make(report({ status: 'CLOSED' })).svc.submit('u1', dto, file(png()))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('one form per report: a second one is refused unless the first was returned', async () => {
    const { svc, storage } = make(report({ jobOrderForm: { formNo: 'JOF-2026-0001', status: FormStatus.RECEIVED } }));
    await expect(svc.submit('u1', dto, file(png()))).rejects.toBeInstanceOf(ConflictException);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('a decision is only recorded from the expected status', async () => {
    const tx = { jobOrderForm: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, statusLog: { create: jest.fn() } };
    const { svc } = make(null, {
      jobOrderForm: {
        findUnique: jest.fn().mockResolvedValue({ id: 'f1', formNo: 'JOF-1', status: FormStatus.APPROVED, report: { status: 'ASSIGNED' } }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'C' }) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    });
    await expect(svc.decide('f1', 'c1', 'return', 'Please add the room number')).rejects.toThrow('already approved');
    expect(tx.statusLog.create).not.toHaveBeenCalled();
  });

  it('other reporters cannot view a form; coordinators can', async () => {
    const form = { ...signed, id: 'f1', signaturePath: 'signatures/r/x.png', contentHash: contentHash(signed), report: null };
    const { svc } = make(null, { jobOrderForm: { findUnique: jest.fn().mockResolvedValue(form) } });
    await expect(svc.findOne('f1', { userId: 'u2', role: Role.REPORTER })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.findOne('f1', { userId: 'c1', role: Role.COORDINATOR })).resolves.toMatchObject({ id: 'f1', signatureUrl: null });
    const shown = await svc.findOne('f1', { userId: 'u1', role: Role.REPORTER });
    expect('signaturePath' in shown).toBe(false);
    expect(shown.integrityOk).toBe(true);
  });

  it('a PDF link only opens its own form and cannot be a login token', async () => {
    const { svc, jwt } = make(null);
    jwt.verifyAsync.mockResolvedValueOnce({ purpose: 'form-pdf', formId: 'other' });
    await expect(svc.pdfByToken('f1', 't')).rejects.toBeInstanceOf(UnauthorizedException);
    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'u1', role: 'REPORTER' }); // an access token
    await expect(svc.pdfByToken('f1', 't')).rejects.toBeInstanceOf(UnauthorizedException);
    jwt.verifyAsync.mockRejectedValueOnce(new Error('jwt expired'));
    await expect(svc.pdfByToken('f1', 't')).rejects.toThrow(/expired/);
  });
});
