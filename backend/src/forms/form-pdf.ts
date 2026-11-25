import PDFDocument from 'pdfkit';
import { fingerprint } from './form-integrity';

const GREEN = '#1b5e20';
const GREY = '#667568';
const LINE = '#bdbdbd';

const titleCase = (s: string) =>
  s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

const fmtDateTime = (d: Date) =>
  d.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-PH', { dateStyle: 'long', timeZone: 'Asia/Manila' });

export interface FormForPdf {
  formNo: string;
  revision: number;
  status: string;
  requesterName: string;
  requesterEmail: string;
  requesterType: string | null;
  department: string;
  contactNumber: string;
  workRequested: string;
  locationText: string;
  categoryName: string;
  urgency: string;
  preferredSchedule: string | null;
  notes: string | null;
  signedAt: Date;
  submittedAt: Date;
  contentHash: string;
  receivedAt: Date | null;
  receivedBy: { fullName: string } | null;
  decidedAt: Date | null;
  decidedBy: { fullName: string } | null;
  decisionNote: string | null;
  report: { jobOrder: { jobOrderNo: string; status: string } | null } | null;
}

// Printable Job Order Form: same letterhead and style as the job order PDF.
export function buildFormPdf(
  f: FormForPdf,
  signaturePng: Buffer,
  integrity: { contentOk: boolean; signatureOk: boolean },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `Job Order Form ${f.formNo}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const rule = (y: number, color = LINE) =>
      doc
        .moveTo(left, y)
        .lineTo(left + width, y)
        .lineWidth(0.5)
        .strokeColor(color)
        .stroke();
    const section = (title: string) => {
      doc.moveDown(0.8);
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
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(GREY)
        .text(k, left, y, { width: 130 });
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#000000')
        .text(v, left + 135, y, { width: width - 135 });
      doc.y = Math.max(doc.y, y + 14) + 2;
    };

    // ---- letterhead ----
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text('Cavite State University – Imus Campus', left, 50, {
        width,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('General Services Office', left, doc.y, { width, align: 'center' });
    doc.moveDown(0.6);
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(GREEN)
      .text('JOB ORDER REQUEST FORM', left, doc.y, { width, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text(
        f.formNo + (f.revision > 1 ? `  (revision ${f.revision})` : ''),
        left,
        doc.y,
        { width, align: 'center' },
      );

    // ---- requester ----
    section('Requesting party');
    row('Name', f.requesterName);
    row(
      'Position',
      f.requesterType ? titleCase(f.requesterType) : 'Not specified',
    );
    row('Department / office', f.department);
    row('Contact number', f.contactNumber);
    row('Email', f.requesterEmail);
    row('Date of request', fmtDate(f.submittedAt));

    // ---- request ----
    section('Work requested');
    row('Category', f.categoryName);
    row('Location', f.locationText);
    // the system-set level at the time of signing (urgency = priority)
    row('Priority', titleCase(f.urgency));
    row('Preferred schedule', f.preferredSchedule ?? 'Any time');
    row('Description', f.workRequested);
    if (f.notes) row('Additional notes', f.notes);

    // ---- certification + signature ----
    if (doc.y > doc.page.height - 300) doc.addPage();
    section('Certification');
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000000')
      .text(
        'I certify that the information in this request is true and correct, and I request the ' +
          'General Services Office to carry out the work described above.',
        left,
        doc.y,
        { width },
      );
    const sigW = 200;
    const sigH = 70;
    const sigTop = doc.y + 10;
    try {
      doc.image(signaturePng, left, sigTop, {
        fit: [sigW, sigH],
        align: 'center',
        valign: 'bottom',
      });
    } catch {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(GREY)
        .text('(signature image unavailable)', left, sigTop + 30);
    }
    const lineY = sigTop + sigH + 4;
    doc
      .moveTo(left, lineY)
      .lineTo(left + sigW, lineY)
      .lineWidth(0.7)
      .strokeColor('#000000')
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#000000')
      .text(f.requesterName, left, lineY + 4, { width: sigW, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text('Signature of requesting party', left, doc.y, {
        width: sigW,
        align: 'center',
      })
      .text(`Signed electronically ${fmtDateTime(f.signedAt)}`, left, doc.y, {
        width: sigW,
        align: 'center',
      });

    // integrity statement to the right of the signature
    const ix = left + sigW + 30;
    const iw = width - sigW - 30;
    const ok = integrity.contentOk && integrity.signatureOk;
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(ok ? GREEN : '#b71c1c')
      .text(
        ok ? 'Electronic signature verified' : 'WARNING: changed after signing',
        ix,
        sigTop + 10,
        { width: iw },
      );
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text(
        ok
          ? 'The form content and signature match the fingerprint recorded when it was signed in FACILITRACK.'
          : 'The form or signature no longer matches what was signed. Do not rely on this copy.',
        ix,
        doc.y + 2,
        { width: iw },
      );
    doc
      .font('Courier')
      .fontSize(8)
      .fillColor('#000000')
      .text(`Fingerprint: ${fingerprint(f.contentHash)}`, ix, doc.y + 4, {
        width: iw,
      });
    doc.y = Math.max(doc.y, lineY + 40);

    // ---- GSO block ----
    section('For GSO use');
    row('Status', titleCase(f.status));
    row(
      'Received',
      f.receivedAt
        ? `${fmtDateTime(f.receivedAt)}${f.receivedBy ? ` by ${f.receivedBy.fullName}` : ''}`
        : 'Not yet received',
    );
    row(
      'Decision',
      f.decidedAt
        ? `${titleCase(f.status)} ${fmtDateTime(f.decidedAt)}${f.decidedBy ? ` by ${f.decidedBy.fullName}` : ''}`
        : 'Pending',
    );
    if (f.decisionNote) row('Remarks', f.decisionNote);
    const jo = f.report?.jobOrder;
    row(
      'Job order no.',
      jo && jo.status !== 'CANCELLED'
        ? `${jo.jobOrderNo} (${titleCase(jo.status)})`
        : 'Not yet issued',
    );

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text(
        `Printed ${fmtDateTime(new Date())} · FACILITRACK`,
        left,
        doc.page.height - 70,
        { width, align: 'center' },
      );
    doc.end();
  });
}
