// One problem = one job order.
//
// When a coordinator confirms that two reports describe the same problem, one
// report becomes the MAIN report and the other a LINKED copy
// (copy.duplicateOfId = main.id). Rules:
//
//   - If both reports already have a job order, only one is kept. The other is
//     CANCELLED with mergedIntoId pointing at the kept one (kept for history,
//     never deleted); its technician offer is withdrawn.
//       default kept job: the one further along (in progress > accepted >
//       waiting for reply > no technician); on a tie, the older report's.
//       The coordinator may choose instead. A finished job (completed/closed)
//       is never the one cancelled.
//   - If only one report has a job order, that report is the main one.
//   - Linked copies follow the main report's status from then on: every
//     job status change is mirrored to them (and logged) so their reporters
//     see the progress and can rate the repair when it is verified.
//   - A linked copy can never get its own job order (checked on creation).

import { BadRequestException } from '@nestjs/common';
import { AssignmentStatus, Prisma, Status } from '@prisma/client';

type Tx = Prisma.TransactionClient;

const statusText = (s: Status) =>
  s
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

export interface JobLike {
  id: string;
  jobOrderNo: string;
  status: Status;
  assignmentStatus: AssignmentStatus | null;
  technicianId: string | null;
}

const FINISHED: Status[] = [Status.COMPLETED, Status.CLOSED];

// how far a job order has got; higher = keep this one
export function jobProgress(job: JobLike): number {
  if (job.status === Status.CANCELLED) return -1;
  if (FINISHED.includes(job.status)) return 5;
  if (job.status === Status.IN_PROGRESS || job.status === Status.DELAYED)
    return 4;
  if (job.technicianId && job.assignmentStatus === AssignmentStatus.ACCEPTED)
    return 3;
  if (job.technicianId && job.assignmentStatus === AssignmentStatus.PENDING)
    return 2;
  return 1;
}

// Which job order continues the work. `older` wins ties.
export function chooseKeptJob(
  older: JobLike,
  newer: JobLike,
  requestedId?: string,
): { keep: JobLike; drop: JobLike } {
  const pair = [older, newer];
  if (requestedId) {
    const keep = pair.find((j) => j.id === requestedId);
    if (!keep)
      throw new BadRequestException(
        'The job order to keep must be one of the two linked reports',
      );
    const drop = keep === older ? newer : older;
    if (FINISHED.includes(drop.status)) {
      throw new BadRequestException(
        `${drop.jobOrderNo} is already ${statusText(drop.status).toLowerCase()} and cannot be cancelled. Keep it instead.`,
      );
    }
    return { keep, drop };
  }
  if (FINISHED.includes(older.status) && FINISHED.includes(newer.status)) {
    throw new BadRequestException(
      `Both job orders (${older.jobOrderNo}, ${newer.jobOrderNo}) are already finished; there is nothing to merge.`,
    );
  }
  const keep = jobProgress(newer) > jobProgress(older) ? newer : older;
  return { keep, drop: keep === older ? newer : older };
}

export interface LinkOutcome {
  mainReportId: string;
  copyReportId: string;
  keptJobOrderNo: string | null;
  cancelledJob: {
    id: string;
    jobOrderNo: string;
    technicianId: string | null;
    reportId: string;
  } | null;
  // reporters whose report changed, for live updates
  reporterIds: string[];
}

// The reporters of a main report's linked copies, to tell them about a step
// in the repair. (Copies used to mirror the main status; they are now closed
// when linked, so nothing is written here.)
export async function syncLinkedCopies(
  tx: Tx,
  mainReportId: string,
  _status: Status,
  _userId: string,
  _note: string,
): Promise<string[]> {
  // Linked copies are closed when linked and keep that status: the repair is
  // followed on the main report. Their reporters are still told about every
  // step, so they are returned for the live updates.
  const copies = await tx.report.findMany({
    where: { duplicateOfId: mainReportId },
    select: { reporterId: true },
  });
  return copies.map((c) => c.reporterId);
}

// Links two reports as the same problem, leaving one job order.
// `olderId`/`newerId`: the earlier and later report (by creation time).
export async function linkSameProblem(
  tx: Tx,
  olderId: string,
  newerId: string,
  userId: string,
  keepJobOrderId?: string,
  // relink: the reports are already linked (repairing older data); do not
  // write a second \"linked\" history entry
  opts: { relink?: boolean } = {},
): Promise<LinkOutcome> {
  const select = {
    id: true,
    status: true,
    reporterId: true,
    duplicateOfId: true,
    jobOrder: {
      select: {
        id: true,
        jobOrderNo: true,
        status: true,
        assignmentStatus: true,
        technicianId: true,
      },
    },
  } satisfies Prisma.ReportSelect;
  const older = await tx.report.findUnique({ where: { id: olderId }, select });
  const newer = await tx.report.findUnique({ where: { id: newerId }, select });
  if (!older || !newer) throw new BadRequestException('Report not found');

  const oj =
    older.jobOrder && older.jobOrder.status !== Status.CANCELLED
      ? older.jobOrder
      : null;
  const nj =
    newer.jobOrder && newer.jobOrder.status !== Status.CANCELLED
      ? newer.jobOrder
      : null;

  let main = older;
  let copy = newer;
  let keep: JobLike | null = oj;
  let drop: JobLike | null = null;

  if (oj && nj) {
    const choice = chooseKeptJob(oj, nj, keepJobOrderId);
    keep = choice.keep;
    drop = choice.drop;
    if (keep.id === nj.id) {
      main = newer;
      copy = older;
    }
  } else if (nj && !oj) {
    // the report already being handled is the main one
    main = newer;
    copy = older;
    keep = nj;
  } else if (keepJobOrderId && keepJobOrderId !== oj?.id) {
    throw new BadRequestException('Only one of these reports has a job order');
  }

  // a main report must itself be an original (no chains)
  if (main.duplicateOfId) {
    throw new BadRequestException(
      'That report is itself linked to another report; link to the original instead',
    );
  }

  const reporterIds = new Set<string>([copy.reporterId]);
  let cancelledJob: LinkOutcome['cancelledJob'] = null;

  if (drop && keep) {
    const now = new Date();
    const reason = `Same problem as ${keep.jobOrderNo}; the work continues there (merged by a coordinator)`;
    await tx.jobOrder.update({
      where: { id: drop.id },
      data: {
        status: Status.CANCELLED,
        mergedIntoId: keep.id,
        cancelledAt: now,
        cancelReason: reason,
        assignmentStatus:
          drop.assignmentStatus === AssignmentStatus.PENDING ||
          drop.assignmentStatus === AssignmentStatus.ACCEPTED
            ? AssignmentStatus.CANCELLED
            : drop.assignmentStatus,
      },
    });
    await tx.jobAssignment.updateMany({
      where: {
        jobOrderId: drop.id,
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
    });
    await tx.materialDelay.updateMany({
      where: { jobOrderId: drop.id, resolvedAt: null },
      data: { resolvedAt: now, resolvedById: userId },
    });
    await tx.statusLog.create({
      data: {
        reportId: copy.id,
        oldStatus: copy.status,
        newStatus: copy.status,
        remarks: `Job order ${drop.jobOrderNo} cancelled: ${reason}`,
        changedById: userId,
      },
    });
    cancelledJob = {
      id: drop.id,
      jobOrderNo: drop.jobOrderNo,
      technicianId: drop.technicianId,
      reportId: copy.id,
    };
  }

  // link and close it: the work continues under the main report, so the copy
  // needs nothing more (its reporter still gets the repair's updates, see
  // linkedReporterIds in the notification rules). Then move any reports
  // already linked to the copy onto the main report.
  await tx.report.update({
    where: { id: copy.id },
    // its priority is no longer reviewed: the main report's is the one that counts
    data: { duplicateOfId: main.id, needsReview: false, status: Status.CLOSED },
  });
  const moved = await tx.report.findMany({
    where: { duplicateOfId: copy.id },
    select: { reporterId: true },
  });
  moved.forEach((m) => reporterIds.add(m.reporterId));
  await tx.report.updateMany({
    where: { duplicateOfId: copy.id },
    data: { duplicateOfId: main.id },
  });
  await moveOpenFlagsToMain(tx, copy.id, main.id);

  if (!opts.relink) {
    // the date only: a reporter never learns who else reported it
    const reported = await tx.report.findUnique({ where: { id: main.id }, select: { createdAt: true } });
    const day = reported?.createdAt ? reported.createdAt.toISOString().slice(0, 10) : null;
    await tx.statusLog.create({
      data: {
        reportId: copy.id,
        oldStatus: copy.status,
        newStatus: Status.CLOSED,
        remarks:
          `Linked to an earlier report of the same problem${day ? ` (reported ${day})` : ''}. ` +
          (keep ? `Work continues there under job order ${keep.jobOrderNo}.` : 'Work continues there.'),
        changedById: userId,
      },
    });
  }

  // every reporter of the problem hears about the link
  (await syncLinkedCopies(tx, main.id, Status.CLOSED, userId, '')).forEach((r) =>
    reporterIds.add(r),
  );

  return {
    mainReportId: main.id,
    copyReportId: copy.id,
    keptJobOrderNo: keep?.jobOrderNo ?? null,
    cancelledJob,
    reporterIds: [...reporterIds],
  };
}

// Open duplicate suggestions about a report that is now a linked copy are
// about its problem, so they move to the main report: decisions are only made
// there (a copy can be neither decided on nor linked to). A suggestion the
// main report already has, or one pairing the main report with itself, is
// dropped. Decided flags stay as they are, for the record.
export async function moveOpenFlagsToMain(tx: Tx, copyId: string, mainId: string) {
  const open = await tx.duplicateFlag.findMany({
    where: {
      status: 'OPEN',
      OR: [{ reportId: copyId }, { candidateId: copyId }],
    },
  });
  for (const f of open) {
    const other = f.reportId === copyId ? f.candidateId : f.reportId;
    const exists =
      other === mainId ||
      (await tx.duplicateFlag.count({
        where: {
          OR: [
            { reportId: mainId, candidateId: other },
            { reportId: other, candidateId: mainId },
          ],
        },
      })) > 0;
    if (exists) {
      await tx.duplicateFlag.delete({ where: { id: f.id } });
    } else {
      await tx.duplicateFlag.update({
        where: { id: f.id },
        data: f.reportId === copyId ? { reportId: mainId } : { candidateId: mainId },
      });
    }
  }
}

// Undo a link. A job order that was cancelled by the merge is reopened
// without a technician, so the report can be handled on its own again.
export async function unlinkReport(tx: Tx, copyId: string, userId: string) {
  const copy = await tx.report.findUnique({
    where: { id: copyId },
    select: { id: true, status: true, duplicateOfId: true, jobOrder: true },
  });
  if (!copy?.duplicateOfId)
    throw new BadRequestException(
      'This report is not linked to another report',
    );

  await tx.report.update({
    where: { id: copyId },
    data: { duplicateOfId: null },
  });

  const job = copy.jobOrder;
  let status: Status;
  let remark: string;
  if (job && job.status === Status.CANCELLED) {
    await tx.jobOrder.update({
      where: { id: job.id },
      data: {
        status: Status.ASSIGNED,
        technicianId: null,
        assignmentStatus: null,
        mergedIntoId: null,
        cancelledAt: null,
        cancelReason: null,
      },
    });
    status = Status.ASSIGNED;
    remark = `Unlinked from the other report; job order ${job.jobOrderNo} reopened and waits for a technician`;
  } else if (job) {
    status = job.status;
    remark = 'Unlinked from the other report; it is handled on its own';
  } else {
    status = Status.UNDER_REVIEW;
    remark = 'Unlinked from the other report; it will get its own job order';
  }
  await tx.report.update({ where: { id: copyId }, data: { status } });
  await tx.statusLog.create({
    data: {
      reportId: copyId,
      oldStatus: copy.status,
      newStatus: status,
      remarks: remark,
      changedById: userId,
    },
  });
  return copy.duplicateOfId;
}
