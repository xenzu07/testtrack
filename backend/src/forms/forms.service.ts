import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FormStatus, JobOrderForm, Prisma, Role, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhotoStorageService } from '../storage/photo-storage.service';
import { EventsGateway } from '../events/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { sniffImage } from '../storage/image-sniff';
import { SubmitFormDto } from './dto/form.dto';
import { contentHash, sha256 } from './form-integrity';
import { buildFormPdf } from './form-pdf';

type SessionUser = { userId: string; role: Role };
const isStaff = (u: SessionUser) =>
  u.role === Role.COORDINATOR || u.role === Role.ADMIN;

export const MAX_SIGNATURE_BYTES = 300 * 1024;
const PDF_LINK_SECONDS = 300;

const people = {
  receivedBy: { select: { id: true, fullName: true } },
  decidedBy: { select: { id: true, fullName: true } },
  report: {
    select: {
      id: true,
      status: true,
      duplicateOfId: true,
      jobOrder: { select: { id: true, jobOrderNo: true, status: true } },
    },
  },
} satisfies Prisma.JobOrderFormInclude;

type FormWithPeople = Prisma.JobOrderFormGetPayload<{ include: typeof people }>;

@Injectable()
export class FormsService {
  constructor(
    private prisma: PrismaService,
    private storage: PhotoStorageService,
    private events: EventsGateway,
    private jwt: JwtService,
    private notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ helpers

  private locationText(l: { building: string; floor: string; room: string }) {
    return `${l.building}, ${l.floor}, ${l.room}`;
  }

  private integrityOk(f: JobOrderForm): boolean {
    return contentHash(f) === f.contentHash;
  }

  // what the API returns: no storage path; a short-lived signature link;
  // and whether the signed content is unchanged since signing
  private async present(f: FormWithPeople, withSignature: boolean) {
    const { signaturePath, ...rest } = f;
    let signatureUrl: string | null = null;
    if (withSignature) {
      signatureUrl =
        (await this.storage.signUrls([signaturePath])).get(signaturePath) ??
        null;
    }
    return { ...rest, signatureUrl, integrityOk: this.integrityOk(f) };
  }

  private async load(id: string) {
    const f = await this.prisma.jobOrderForm.findUnique({
      where: { id },
      include: people,
    });
    if (!f) throw new NotFoundException('Job Order Form not found');
    return f;
  }

  private assertCanView(f: { requesterId: string }, user: SessionUser) {
    if (!isStaff(user) && f.requesterId !== user.userId) {
      throw new ForbiddenException('You cannot view this Job Order Form');
    }
  }

  private async nextFormNo(tx: Prisma.TransactionClient) {
    const prefix = `JOF-${new Date().getFullYear()}-`;
    const last = await tx.jobOrderForm.findFirst({
      where: { formNo: { startsWith: prefix } },
      orderBy: { formNo: 'desc' },
      select: { formNo: true },
    });
    const next = last ? parseInt(last.formNo.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  // ------------------------------------------------------------ reporter

  // everything the form can be pre-filled with
  async prefill(reportId: string, userId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        category: true,
        location: true,
        jobOrderForm: { include: people },
      },
    });
    if (!report || report.reporterId !== userId)
      throw new NotFoundException('Report not found');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, userType: true },
    });
    // department and contact number are remembered from the last form
    const last = await this.prisma.jobOrderForm.findFirst({
      where: { requesterId: userId },
      orderBy: { submittedAt: 'desc' },
      select: { department: true, contactNumber: true },
    });
    return {
      requester: user,
      report: {
        id: report.id,
        status: report.status,
        category: report.category.name,
        location: this.locationText(report.location),
        urgency: report.urgency,
        description: report.description,
        createdAt: report.createdAt,
      },
      remembered: last,
      existingForm: report.jobOrderForm
        ? await this.present(report.jobOrderForm, false)
        : null,
      canSubmit:
        report.status !== Status.CLOSED &&
        (!report.jobOrderForm ||
          report.jobOrderForm.status === FormStatus.RETURNED),
    };
  }

  async submit(
    userId: string,
    dto: SubmitFormDto,
    signature?: Express.Multer.File,
  ) {
    if (!signature) throw new BadRequestException('Please sign the form');
    if (signature.size > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException('The signature image is too large');
    }
    if (sniffImage(signature.buffer)?.mime !== 'image/png') {
      throw new BadRequestException('The signature must be a PNG image');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: dto.reportId },
      include: { category: true, location: true, jobOrderForm: true },
    });
    if (!report || report.reporterId !== userId)
      throw new NotFoundException('Report not found');
    if (report.status === Status.CLOSED) {
      throw new BadRequestException(
        'This report is already closed; a Job Order Form is no longer needed',
      );
    }
    const existing = report.jobOrderForm;
    if (existing && existing.status !== FormStatus.RETURNED) {
      throw new ConflictException(
        `A Job Order Form (${existing.formNo}) was already submitted for this report`,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, userType: true },
    });
    if (!user) throw new UnauthorizedException();

    // the signature is stored first; it is removed again if saving fails
    const signaturePath = await this.storage.uploadImage(
      signature.buffer,
      `signatures/${report.id}`,
    );
    const signatureHash = sha256(signature.buffer);
    const signedAt = new Date();

    try {
      const form = await this.prisma.$transaction(async (tx) => {
        const formNo = existing?.formNo ?? (await this.nextFormNo(tx));
        const revision = existing ? existing.revision + 1 : 1;
        const content = {
          formNo,
          revision,
          reportId: report.id,
          requesterId: userId,
          requesterName: user.fullName,
          requesterEmail: user.email,
          requesterType: user.userType,
          department: dto.department,
          contactNumber: dto.contactNumber,
          workRequested: dto.workRequested,
          locationText: this.locationText(report.location),
          categoryName: report.category.name,
          urgency: report.urgency,
          preferredSchedule: dto.preferredSchedule ?? null,
          notes: dto.notes ?? null,
          certified: dto.certified,
          signedAt,
          signatureHash,
        };
        const data = {
          ...content,
          signaturePath,
          contentHash: contentHash(content),
          status: FormStatus.SUBMITTED,
          submittedAt: signedAt,
        };

        const saved = existing
          ? // resubmission of a returned form: only allowed while still RETURNED
            await tx.jobOrderForm.updateMany({
              where: { id: existing.id, status: FormStatus.RETURNED },
              data: {
                ...data,
                receivedAt: null,
                receivedById: null,
                decidedAt: null,
                decidedById: null,
                decisionNote: null,
              },
            })
          : null;
        if (existing && saved?.count === 0) {
          throw new ConflictException(
            'This form changed meanwhile. Reload and try again.',
          );
        }
        const row = existing
          ? await tx.jobOrderForm.findUniqueOrThrow({
              where: { id: existing.id },
            })
          : await tx.jobOrderForm.create({ data });

        await tx.statusLog.create({
          data: {
            reportId: report.id,
            oldStatus: report.status,
            newStatus: report.status,
            remarks: existing
              ? `Job Order Form ${formNo} corrected and resubmitted (revision ${revision}), signed by ${user.fullName}`
              : `Job Order Form ${formNo} submitted, signed by ${user.fullName}`,
            changedById: userId,
          },
        });
        return row;
      });

      this.events.statusChanged(
        {
          reportId: report.id,
          jobOrderId: null,
          status: report.status,
          message: `New Job Order Form ${form.formNo} from ${user.fullName}`,
          kind: 'form.submitted',
        },
        [userId],
      );
      this.notifications.emit({ type: 'form.submitted', reportId: report.id, formId: form.id, actorId: userId });
      return this.present(await this.load(form.id), true);
    } catch (e) {
      await this.storage.removeQuietly(signaturePath);
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A Job Order Form was just submitted for this report',
        );
      }
      throw e;
    }
  }

  async mine(userId: string) {
    const forms = await this.prisma.jobOrderForm.findMany({
      where: { requesterId: userId },
      include: people,
      orderBy: { submittedAt: 'desc' },
    });
    return Promise.all(forms.map((f) => this.present(f, false)));
  }

  // ------------------------------------------------------------ both

  async findOne(id: string, user: SessionUser) {
    const f = await this.load(id);
    this.assertCanView(f, user);
    return this.present(f, true);
  }

  async pdf(id: string, user: SessionUser) {
    const f = await this.load(id);
    this.assertCanView(f, user);
    return this.renderPdf(f);
  }

  private async renderPdf(f: FormWithPeople) {
    const signature = await this.storage.download(f.signaturePath);
    const buffer = await buildFormPdf(f, signature, {
      contentOk: this.integrityOk(f),
      signatureOk: sha256(signature) === f.signatureHash,
    });
    return { buffer, filename: `${f.formNo}.pdf` };
  }

  // a 5-minute link for one form's PDF, for the mobile app to open in the
  // phone's browser or PDF viewer (which cannot send the login token)
  async pdfLink(id: string, user: SessionUser) {
    const f = await this.load(id);
    this.assertCanView(f, user);
    const token = await this.jwt.signAsync(
      { purpose: 'form-pdf', formId: id },
      { expiresIn: PDF_LINK_SECONDS },
    );
    return {
      path: `/job-order-forms/${id}/shared-pdf?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + PDF_LINK_SECONDS * 1000),
    };
  }

  async pdfByToken(id: string, token: string) {
    let payload: { purpose?: string; formId?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException(
        'This link has expired. Open the form again to get a new one.',
      );
    }
    if (payload.purpose !== 'form-pdf' || payload.formId !== id) {
      throw new UnauthorizedException('Invalid link');
    }
    return this.renderPdf(await this.load(id));
  }

  // ------------------------------------------------------------ coordinator

  async list(status?: FormStatus) {
    const forms = await this.prisma.jobOrderForm.findMany({
      where: { status },
      include: people,
      orderBy: [{ submittedAt: 'desc' }],
    });
    return Promise.all(forms.map((f) => this.present(f, false)));
  }

  // SUBMITTED -> RECEIVED -> APPROVED, or RETURNED (reason) from either.
  // Each change only happens from the expected status, so two coordinators
  // acting at once cannot record conflicting decisions.
  async decide(
    id: string,
    userId: string,
    action: 'receive' | 'approve' | 'return',
    note?: string,
  ) {
    const f = await this.load(id);
    const now = new Date();
    const from: FormStatus[] =
      action === 'receive'
        ? [FormStatus.SUBMITTED]
        : [FormStatus.SUBMITTED, FormStatus.RECEIVED];
    const data: Prisma.JobOrderFormUpdateManyMutationInput & {
      receivedById?: string;
      decidedById?: string;
    } =
      action === 'receive'
        ? { status: FormStatus.RECEIVED, receivedAt: now, receivedById: userId }
        : {
            status:
              action === 'approve' ? FormStatus.APPROVED : FormStatus.RETURNED,
            decidedAt: now,
            decidedById: userId,
            decisionNote: note ?? null,
            ...(f.receivedAt ? {} : { receivedAt: now, receivedById: userId }),
          };

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.jobOrderForm.updateMany({
        where: { id, status: { in: from } },
        data,
      });
      if (res.count === 0) {
        throw new ConflictException(
          `This form is already ${f.status.toLowerCase()}`,
        );
      }
      const text =
        action === 'receive'
          ? `Job Order Form ${f.formNo} received by the GSO`
          : action === 'approve'
            ? `Job Order Form ${f.formNo} approved by ${me?.fullName ?? 'the coordinator'}${note ? `: ${note}` : ''}`
            : `Job Order Form ${f.formNo} returned for changes: ${note}`;
      await tx.statusLog.create({
        data: {
          reportId: f.reportId,
          oldStatus: f.report.status,
          newStatus: f.report.status,
          remarks: text,
          changedById: userId,
        },
      });
    });

    this.events.statusChanged(
      {
        reportId: f.reportId,
        jobOrderId: null,
        status: f.report.status,
        message:
          action === 'receive'
            ? `Your Job Order Form ${f.formNo} was received`
            : action === 'approve'
              ? `Your Job Order Form ${f.formNo} was approved`
              : `Your Job Order Form ${f.formNo} needs changes`,
        kind: 'form.updated',
      },
      [f.requesterId],
    );
    this.notifications.emit({
      type: 'form.decided',
      reportId: f.reportId,
      formId: f.id,
      actorId: userId,
      action,
      note,
    });
    return this.present(await this.load(id), true);
  }
}
