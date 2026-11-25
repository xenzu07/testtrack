import PDFDocument from 'pdfkit';
import type { JobOrderFull } from './job-orders.service';

const GREEN = '#1b5e20';
const GREY = '#667568';
const LINE = '#bdbdbd';

const titleCase = (s: string) =>
  s
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

// target dates are stored as UTC midnight
const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'UTC' })
    : 'Not set';

const fmtDateTime = (d: Date) =>
  d.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });

export function buildJobOrderPdf(
  job: JobOrderFull,
  preparedBy: string | null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const r = job.report;

    const rule = (y: number, color = LINE) =>
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(color).stroke();

    const section = (title: string) => {
      doc.moveDown(0.9);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(GREEN)
        .text(title.toUpperCase(), left, doc.y, { width });
      const y = doc.y + 2;
      rule(y);
      doc.y = y + 6;
    };

    const row = (k: string, v: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(GREY).text(k, left, y, { width: 120 });
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#000000')
        .text(v, left + 125, y, { width: width - 125 });
      doc.y = Math.max(doc.y, y + 14) + 2;
    };

    // ---- header ----
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text('Cavite State University – Imus Campus', left, 50, { width, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('General Services Office', left, doc.y, { width, align: 'center' });
    doc.moveDown(0.6);
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(GREEN)
      .text('JOB ORDER', left, doc.y, { width, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text(job.jobOrderNo, left, doc.y, { width, align: 'center' });

    // ---- details ----
    section('Job order details');
    row('Date issued', fmtDateTime(job.createdAt));
    row('Status', titleCase(job.status));
    row('Trade unit', job.tradeUnit.name);
    row('Assigned technician', job.technician?.fullName ?? 'Not yet assigned');
    row('Target completion', fmtDate(job.targetDate));

    section('Reported issue');
    row('Category', r.category.name);
    row('Location', `${r.location.building}, ${r.location.floor}, ${r.location.room}`);
    // urgency and priority are one system-set level
    row('Priority', titleCase(r.urgency));
    row(
      'Reported by',
      r.reporter.fullName + (r.reporter.userType ? ` (${r.reporter.userType})` : ''),
    );
    row('Date reported', fmtDateTime(r.createdAt));
    row('Description', r.description);

    section('Materials needed');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#000000')
      .text(job.materialsNote ?? 'Not specified', left, doc.y, { width });

    section('Work done / remarks');
    for (let i = 0; i < 4; i++) {
      const y = doc.y + 18;
      rule(y);
      doc.y = y;
    }

    // ---- sign-off ----
    if (doc.y > doc.page.height - 220) doc.addPage();
    section('Sign-off');

    const gap = 20;
    const colW = (width - gap * 2) / 3;
    const top = doc.y + 38;
    const blocks = [
      { name: preparedBy ?? '', title: 'Prepared by (GSO Coordinator)' },
      { name: job.technician?.fullName ?? '', title: 'Work done by (Technician)' },
      { name: r.reporter.fullName, title: 'Accepted by (Requesting party)' },
    ];
    blocks.forEach((b, i) => {
      const x = left + i * (colW + gap);
      doc.moveTo(x, top).lineTo(x + colW, top).lineWidth(0.7).strokeColor('#000000').stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#000000')
        .text(b.name || ' ', x, top + 4, { width: colW, align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(GREY)
        .text(b.title, x, top + 17, { width: colW, align: 'center' });
      doc.text('Signature over printed name', x, top + 29, { width: colW, align: 'center' });
      doc.text('Date: ____________________', x, top + 46, { width: colW, align: 'center' });
    });
    doc.y = top + 66;

    if (job.verifiedBy && job.verifiedAt) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor(GREY)
        .text(
          `Completion verified in FACILITRACK by ${job.verifiedBy.fullName} on ${fmtDateTime(job.verifiedAt)}`,
          left,
          doc.y,
          { width },
        );
    }

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text(`Printed ${fmtDateTime(new Date())} · FACILITRACK`, left, doc.page.height - 70, {
        width,
        align: 'center',
      });

    doc.end();
  });
}