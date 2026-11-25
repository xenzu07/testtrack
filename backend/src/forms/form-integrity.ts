// Tamper evidence for signed forms. When a requester signs, we store
//   signatureHash = SHA-256 of the signature image
//   contentHash   = SHA-256 of the signed content (fields + signatureHash)
// Recomputing them later shows whether the form or signature changed since
// signing. Pure functions, no database access.
import { createHash } from 'crypto';

export interface SignedContent {
  formNo: string;
  revision: number;
  reportId: string;
  requesterId: string;
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
  certified: boolean;
  signedAt: Date;
  signatureHash: string;
}

export const sha256 = (data: Buffer | string) =>
  createHash('sha256').update(data).digest('hex');

// fixed key order, so the same content always gives the same hash
export function contentHash(c: SignedContent): string {
  return sha256(
    JSON.stringify([
      c.formNo,
      c.revision,
      c.reportId,
      c.requesterId,
      c.requesterName,
      c.requesterEmail,
      c.requesterType,
      c.department,
      c.contactNumber,
      c.workRequested,
      c.locationText,
      c.categoryName,
      c.urgency,
      c.preferredSchedule,
      c.notes,
      c.certified,
      c.signedAt.toISOString(),
      c.signatureHash,
    ]),
  );
}

// short, readable fingerprint printed on the PDF
export const fingerprint = (hash: string) =>
  hash
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim();
