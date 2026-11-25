import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PushPlatform, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { PushService } from './push.service';
import {
  COORDINATORS,
  NotificationKind,
  NotifyEvent,
  ReportContext,
  dedupeKey,
  messagesFor,
} from './notification-rules';

// a person may be told about their own action only as a confirmation
const SELF_CONFIRMATIONS = new Set<NotificationKind>(['report.received', 'job.answer', 'form.status']);

export interface DeviceInput {
  platform: PushPlatform;
  token: string;
  p256dh?: string;
  auth?: string;
  userAgent?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private push: PushService,
  ) {}

  // Called after a change is saved. Never throws: a notification problem must
  // not undo or fail the change itself.
  emit(event: NotifyEvent): void {
    void this.deliver(event).catch((e) =>
      this.logger.warn(`Could not create notifications for ${event.type}: ${String(e)}`),
    );
  }

  async deliver(event: NotifyEvent) {
    const ctx = await this.context(event.reportId);
    if (!ctx) return;
    // a declined job is no longer assigned, so name the person who answered
    if (event.type === 'job.answered') {
      const t = await this.prisma.user.findUnique({ where: { id: event.technicianId }, select: { fullName: true } });
      ctx.technicianName = t?.fullName ?? ctx.technicianName;
    }
    const stamp = await this.stamp(event, ctx);
    const actorId = 'actorId' in event ? event.actorId : null;

    let coordinatorIds: string[] | null = null;
    const rows: {
      userId: string;
      kind: string;
      title: string;
      body: string;
      reportId: string;
      jobOrderId: string | null;
      formId: string | null;
      dedupeKey: string;
    }[] = [];

    for (const m of messagesFor(event, ctx)) {
      let to: string[];
      if (m.to === COORDINATORS) {
        coordinatorIds ??= await this.coordinatorIds();
        to = coordinatorIds;
      } else {
        to = m.to;
      }
      const key = dedupeKey(event, m.kind, stamp);
      for (const userId of new Set(to.filter(Boolean))) {
        if (userId === actorId && !SELF_CONFIRMATIONS.has(m.kind)) continue;
        rows.push({
          userId,
          kind: m.kind,
          title: m.title,
          body: m.body,
          reportId: ctx.id,
          jobOrderId: m.jobOrderId ?? null,
          formId: m.formId ?? null,
          dedupeKey: key,
        });
      }
    }
    if (rows.length === 0) return;

    // only active accounts; explicit lists may hold deactivated users
    const active = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.userId))] }, isActive: true },
          select: { id: true },
        })
      ).map((u) => u.id),
    );
    const created = await this.prisma.notification.createManyAndReturn({
      data: rows.filter((r) => active.has(r.userId)),
      skipDuplicates: true,
    });

    for (const n of created) {
      this.events.notification(n.userId, n);
      void this.push
        .sendToUser(n.userId, {
          notificationId: n.id,
          title: n.title,
          body: n.body,
          kind: n.kind,
          reportId: n.reportId,
          jobOrderId: n.jobOrderId,
          formId: n.formId,
          url: n.formId ? `/forms/${n.formId}` : n.reportId ? `/reports/${n.reportId}` : '/',
        })
        .catch((e) => this.logger.warn(`Push failed: ${String(e)}`));
    }
  }

  // Coordinators are told when a report waits for a manual priority check;
  // once per set of review reasons.
  async checkPriorityReview(reportIds: string[]) {
    // a new report can also put the earlier report it resembles up for review
    const candidates = await this.prisma.duplicateFlag.findMany({
      where: { reportId: { in: reportIds } },
      select: { candidateId: true },
    });
    const ids = [...new Set([...reportIds, ...candidates.map((c) => c.candidateId)])];
    const reports = await this.prisma.report.findMany({
      where: { id: { in: ids }, needsReview: true },
      select: { id: true },
    });
    for (const r of reports) await this.deliver({ type: 'priority.review', reportId: r.id });
  }

  emitPriorityReview(reportIds: string[]) {
    void this.checkPriorityReview(reportIds).catch((e) =>
      this.logger.warn(`Could not check priority review: ${String(e)}`),
    );
  }

  private async coordinatorIds() {
    return (
      await this.prisma.user.findMany({
        where: { role: { in: [Role.COORDINATOR, Role.ADMIN] }, isActive: true },
        select: { id: true },
      })
    ).map((u) => u.id);
  }

  private async context(reportId: string): Promise<ReportContext | null> {
    const r = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        reporterId: true,
        priority: true,
        reviewFlags: true,
        reporter: { select: { fullName: true } },
        category: { select: { name: true } },
        location: { select: { building: true, floor: true, room: true } },
        duplicates: { select: { reporterId: true } },
        jobOrder: {
          select: { jobOrderNo: true, technicianId: true, technician: { select: { fullName: true } } },
        },
        jobOrderForm: { select: { formNo: true } },
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      category: r.category.name,
      location: `${r.location.building}, ${r.location.floor}, ${r.location.room}`,
      reporterId: r.reporterId,
      reporterName: r.reporter.fullName,
      linkedReporterIds: r.duplicates.map((d) => d.reporterId).filter((id) => id !== r.reporterId),
      jobOrderNo: r.jobOrder?.jobOrderNo ?? null,
      technicianId: r.jobOrder?.technicianId ?? null,
      technicianName: r.jobOrder?.technician?.fullName ?? null,
      formNo: r.jobOrderForm?.formNo ?? null,
      priority: r.priority,
      reviewFlags: r.reviewFlags,
    };
  }

  // the id of the record this occurrence created, so a retry or a second
  // emit of the same change hits the unique (userId, dedupeKey) index
  private async stamp(e: NotifyEvent, ctx: ReportContext): Promise<string> {
    const lastLog = async () =>
      (
        await this.prisma.statusLog.findFirst({
          where: { reportId: e.reportId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      )?.id ?? 'none';
    const lastAssignment = async (jobOrderId: string) =>
      (
        await this.prisma.jobAssignment.findFirst({
          where: { jobOrderId },
          orderBy: { assignedAt: 'desc' },
          select: { id: true },
        })
      )?.id ?? 'none';

    switch (e.type) {
      case 'report.submitted':
        return 'created';
      case 'job.created':
        return `${e.jobOrderId}:${await lastAssignment(e.jobOrderId)}`;
      case 'job.reassigned':
        return await lastAssignment(e.jobOrderId);
      case 'job.answered':
        return `${await lastAssignment(e.jobOrderId)}:${e.accepted ? 'yes' : 'no'}`;
      case 'form.submitted': {
        const f = await this.prisma.jobOrderForm.findUnique({ where: { id: e.formId }, select: { revision: true } });
        return `${e.formId}:r${f?.revision ?? 1}`;
      }
      case 'form.decided':
        return `${e.formId}:${e.action}:${await lastLog()}`;
      case 'priority.review':
        return [...ctx.reviewFlags].sort().join(',') || 'review';
      default:
        return await lastLog();
    }
  }

  // ---------- the signed-in user's own list ----------

  async list(userId: string, limit = 30, before?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          reportId: true,
          jobOrderId: true,
          formId: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.unreadCount(userId),
    ]);
    return { items, unread, hasMore: items.length === take };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    // scoped to the owner: someone else's id simply matches nothing
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const mine = await this.prisma.notification.count({ where: { id, userId } });
      if (!mine) throw new NotFoundException('Notification not found');
    }
    return { unread: await this.unreadCount(userId) };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { unread: 0 };
  }

  // ---------- push devices ----------

  // A token belongs to whoever registered it last: when someone else signs in
  // on the same phone or browser, pushes follow the new account only.
  async registerDevice(userId: string, d: DeviceInput) {
    if (d.platform === PushPlatform.WEB) {
      let ok = false;
      try {
        ok = new URL(d.token).protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok || !d.p256dh || !d.auth) {
        throw new BadRequestException('A browser subscription needs an https endpoint and its keys');
      }
    } else {
      d = { ...d, p256dh: undefined, auth: undefined };
    }
    await this.prisma.pushDevice.upsert({
      where: { token: d.token },
      create: { userId, ...d },
      update: { userId, platform: d.platform, p256dh: d.p256dh, auth: d.auth, userAgent: d.userAgent, lastSeenAt: new Date() },
    });
    return { ok: true, push: this.push.status };
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
    return { ok: true };
  }

  // used when every session of a user ends (password change, sign out
  // everywhere, deactivation, role change)
  forgetDevicesOf(userId: string) {
    return this.prisma.pushDevice.deleteMany({ where: { userId } });
  }

  pushConfig() {
    return { webPushPublicKey: this.push.vapidPublicKey, ...this.push.status };
  }
}
