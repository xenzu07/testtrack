// Who is told what, for every event that creates notifications. Pure
// functions (no database), so the wording and the recipients can be unit
// tested. NotificationsService loads the context and delivers the messages.

export type NotificationKind =
  // reporter
  | 'report.received'
  | 'report.status'
  | 'report.progress'
  | 'form.status'
  // technician
  | 'job.offered'
  | 'job.answer'
  | 'job.withdrawn'
  | 'job.verified'
  // coordinator
  | 'report.new'
  | 'form.new'
  | 'job.accepted'
  | 'job.declined'
  | 'job.status'
  | 'priority.review';

export type JobStatusChange = 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED' | 'RESUMED';

export type NotifyEvent =
  | { type: 'report.submitted'; reportId: string; actorId: string }
  | { type: 'report.routed'; reportId: string; actorId: string; note: string }
  | { type: 'job.created'; reportId: string; jobOrderId: string; actorId: string; technicianId?: string | null }
  | {
      type: 'job.reassigned';
      reportId: string;
      jobOrderId: string;
      actorId: string;
      technicianId: string;
      previousTechnicianId?: string | null;
    }
  | {
      type: 'job.answered';
      reportId: string;
      jobOrderId: string;
      technicianId: string;
      accepted: boolean;
      reason?: string | null;
    }
  | { type: 'job.status'; reportId: string; jobOrderId: string; actorId: string; status: JobStatusChange }
  | { type: 'job.progress'; reportId: string; jobOrderId: string; actorId: string; remarks?: string | null }
  | { type: 'job.verified'; reportId: string; jobOrderId: string; actorId: string; approved: boolean }
  | { type: 'form.submitted'; reportId: string; formId: string; actorId: string }
  | {
      type: 'form.decided';
      reportId: string;
      formId: string;
      actorId: string;
      action: 'receive' | 'approve' | 'return';
      note?: string | null;
    }
  | {
      type: 'report.linked';
      reportId: string;
      actorId: string;
      reporterIds: string[];
      cancelledJob?: { id: string; jobOrderNo: string; technicianId: string | null } | null;
      keptJobOrderNo?: string | null;
    }
  | { type: 'priority.review'; reportId: string };

// what the rules need to know about the report the event is about
export interface ReportContext {
  id: string;
  category: string;
  location: string;
  reporterId: string;
  reporterName: string;
  // reporters of other reports linked to this one as the same problem
  linkedReporterIds: string[];
  jobOrderNo: string | null;
  technicianId: string | null;
  technicianName: string | null;
  formNo: string | null;
  priority: string | null;
  reviewFlags: string[];
}

export const COORDINATORS = 'coordinators' as const;

export interface Message {
  to: string[] | typeof COORDINATORS;
  kind: NotificationKind;
  title: string;
  body: string;
  jobOrderId?: string;
  formId?: string;
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function messagesFor(e: NotifyEvent, r: ReportContext): Message[] {
  const what = `${r.category} at ${r.location}`;
  const reporters = [r.reporterId, ...r.linkedReporterIds];
  const job = r.jobOrderNo ?? 'The job order';

  switch (e.type) {
    case 'report.submitted':
      return [
        {
          to: [r.reporterId],
          kind: 'report.received',
          title: 'Report received',
          body: `Your ${what} report was sent to the GSO. You will be told when it is reviewed.`,
        },
        {
          to: COORDINATORS,
          kind: 'report.new',
          title: 'New report',
          body: `${what}, from ${r.reporterName}.`,
        },
      ];

    case 'report.routed':
      return [
        {
          to: reporters,
          kind: 'report.status',
          title: 'Report under review',
          body: clip(e.note || `Your ${r.category} report is being reviewed.`),
        },
      ];

    case 'job.created': {
      const out: Message[] = [
        {
          to: reporters,
          kind: 'report.status',
          title: 'Job order created',
          body: `${job} was created for your ${r.category} report.`,
          jobOrderId: e.jobOrderId,
        },
      ];
      if (e.technicianId) out.push(offer(e.technicianId, e.jobOrderId, job, what));
      return out;
    }

    case 'job.reassigned': {
      const out = [offer(e.technicianId, e.jobOrderId, job, what)];
      if (e.previousTechnicianId && e.previousTechnicianId !== e.technicianId) {
        out.push({
          to: [e.previousTechnicianId],
          kind: 'job.withdrawn',
          title: 'Job reassigned',
          body: `${job} (${what}) was given to another technician. It has left your list.`,
          jobOrderId: e.jobOrderId,
        });
      }
      return out;
    }

    case 'job.answered': {
      const name = r.technicianName ?? 'The technician';
      if (e.accepted) {
        return [
          {
            to: [e.technicianId],
            kind: 'job.answer',
            title: 'Job accepted',
            body: `You accepted ${job}. Start work when you are on site.`,
            jobOrderId: e.jobOrderId,
          },
          {
            to: COORDINATORS,
            kind: 'job.accepted',
            title: 'Technician accepted',
            body: `${name} accepted ${job} (${what}).`,
            jobOrderId: e.jobOrderId,
          },
          {
            to: reporters,
            kind: 'report.status',
            title: 'Technician confirmed',
            body: `${name} will handle your ${r.category} report.`,
            jobOrderId: e.jobOrderId,
          },
        ];
      }
      return [
        {
          to: [e.technicianId],
          kind: 'job.answer',
          title: 'Job declined',
          body: `You declined ${job}. The coordinator will reassign it.`,
          jobOrderId: e.jobOrderId,
        },
        {
          to: COORDINATORS,
          kind: 'job.declined',
          title: 'Technician declined: reassign',
          body: clip(`${name} declined ${job} (${what})${e.reason ? `: ${e.reason}` : ''}.`),
          jobOrderId: e.jobOrderId,
        },
      ];
    }

    case 'job.status': {
      const text: Record<JobStatusChange, [string, string, string]> = {
        // [reporter title, reporter body, coordinator body]
        IN_PROGRESS: ['Work started', `Work on your ${r.category} report has started.`, `${job} is now in progress (${what}).`],
        COMPLETED: [
          'Work completed',
          `The technician finished your ${r.category} report. The GSO will check the work.`,
          `${job} was completed and is ready to verify (${what}).`,
        ],
        DELAYED: ['Work delayed', `Work on your ${r.category} report is waiting for materials.`, `${job}: material delay recorded (${what}).`],
        RESUMED: ['Work resumed', `Work on your ${r.category} report has resumed.`, `${job}: delay resolved, work resumed (${what}).`],
      };
      const [title, body, coord] = text[e.status];
      return [
        { to: reporters, kind: 'report.status', title, body, jobOrderId: e.jobOrderId },
        {
          to: COORDINATORS,
          kind: 'job.status',
          title: { IN_PROGRESS: 'Work started', COMPLETED: 'Job completed', DELAYED: 'Job delayed', RESUMED: 'Work resumed' }[e.status],
          body: coord,
          jobOrderId: e.jobOrderId,
        },
      ];
    }

    case 'job.progress':
      return [
        {
          to: reporters,
          kind: 'report.progress',
          title: 'Progress update',
          body: clip(e.remarks?.trim() || `The technician posted an update on your ${r.category} report.`),
          jobOrderId: e.jobOrderId,
        },
      ];

    case 'job.verified': {
      const out: Message[] = [
        {
          to: reporters,
          kind: 'report.status',
          title: e.approved ? 'Repair verified' : 'Work reopened',
          body: e.approved
            ? `Your ${r.category} report is closed. Please rate the repair in the app.`
            : `The GSO asked for more work on your ${r.category} report.`,
          jobOrderId: e.jobOrderId,
        },
      ];
      if (r.technicianId) {
        out.push({
          to: [r.technicianId],
          kind: 'job.verified',
          title: e.approved ? 'Job verified and closed' : 'Job sent back for rework',
          body: e.approved ? `${job} was verified by the coordinator.` : `${job} needs more work. Check the job for details.`,
          jobOrderId: e.jobOrderId,
        });
      }
      return out;
    }

    case 'form.submitted':
      return [
        {
          to: [r.reporterId],
          kind: 'form.status',
          title: 'Job Order Form sent',
          body: `${r.formNo ?? 'Your form'} was sent to the GSO.`,
          formId: e.formId,
        },
        {
          to: COORDINATORS,
          kind: 'form.new',
          title: 'New Job Order Form',
          body: `${r.formNo ?? 'A form'} from ${r.reporterName} (${what}).`,
          formId: e.formId,
        },
      ];

    case 'form.decided': {
      const form = r.formNo ?? 'Your Job Order Form';
      const [title, body] =
        e.action === 'receive'
          ? ['Form received', `${form} was received by the GSO.`]
          : e.action === 'approve'
            ? ['Form approved', `${form} was approved.`]
            : ['Form needs changes', clip(`${form} was returned${e.note ? `: ${e.note}` : ''}. Edit and sign it again.`)];
      return [{ to: [r.reporterId], kind: 'form.status', title, body, formId: e.formId }];
    }

    case 'report.linked': {
      const out: Message[] = [
        {
          to: e.reporterIds,
          kind: 'report.status',
          title: 'Report linked',
          body: `Your ${r.category} report is the same problem as an earlier report and is handled with it.`,
        },
      ];
      if (e.cancelledJob?.technicianId) {
        out.push({
          to: [e.cancelledJob.technicianId],
          kind: 'job.withdrawn',
          title: 'Job merged',
          body: `${e.cancelledJob.jobOrderNo} was merged into ${e.keptJobOrderNo ?? 'another job order'}: same problem, no separate work needed.`,
          jobOrderId: e.cancelledJob.id,
        });
      }
      return out;
    }

    case 'priority.review':
      return [
        {
          to: COORDINATORS,
          kind: 'priority.review',
          title: 'Priority needs review',
          body: `${what}: the automatic priority (${r.priority ?? 'not scored'}) should be checked.`,
        },
      ];
  }
}

function offer(technicianId: string, jobOrderId: string, job: string, what: string): Message {
  return {
    to: [technicianId],
    kind: 'job.offered',
    title: 'New job assigned',
    body: `${job}: ${what}. Open the app to accept or decline.`,
    jobOrderId,
  };
}

// Identifies one occurrence of an event, so retries or double emits never
// notify twice. `stamp` is the id of the record the event created (status log,
// assignment, form revision) when there is one.
export function dedupeKey(e: NotifyEvent, kind: NotificationKind, stamp: string): string {
  return `${e.type}:${kind}:${e.reportId}:${stamp}`;
}
