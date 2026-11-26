import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { formatDateTime } from '../format';
import { useRealtime } from '../socket';
import { Breadcrumb, ErrorBox, Flag, FormStatusBadge, UrgencyAsPriority } from '../ui';
import type { JobOrderFormView } from '../types';

export default function FormDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<JobOrderFormView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'approve' | 'return' | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setForm((await api.get<JobOrderFormView>(`/job-order-forms/${id}`)).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (form && e.reportId === form.reportId) void load();
  });

  async function act(action: 'receive' | 'approve' | 'return') {
    setBusy(true);
    setActionError(null);
    try {
      const body = action === 'return' ? { reason: note } : action === 'approve' ? { note } : undefined;
      setForm((await api.post<JobOrderFormView>(`/job-order-forms/${id}/${action}`, body)).data);
      setMode(null);
      setNote('');
    } catch (e) {
      setActionError(errorMessage(e));
      void load();
    }
    setBusy(false);
  }

  async function downloadPdf() {
    setActionError(null);
    try {
      const res = await api.get<Blob>(`/job-order-forms/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form?.formNo ?? 'job-order-form'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!form) return <p className="muted">Loading...</p>;

  const open = form.status === 'SUBMITTED' || form.status === 'RECEIVED';
  const job = form.report?.jobOrder && form.report.jobOrder.status !== 'CANCELLED' ? form.report.jobOrder : null;

  return (
    <div>
      <Breadcrumb parent="Forms" to="/forms" current={form.formNo} />
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>
            {form.formNo}
            {form.revision > 1 && <span className="muted small"> revision {form.revision}</span>}
          </h1>
          <p className="muted subtitle">
            Job Order Form from {form.requesterName} · <Link to={`/reports/${form.reportId}`}>open the report</Link>
          </p>
        </div>
        <div className="head-badges">
          <FormStatusBadge status={form.status} />
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="card">
            <h2>Requesting party</h2>
            <dl className="kv" style={{ marginTop: 0 }}>
              <dt>Name</dt>
              <dd>{form.requesterName}</dd>
              <dt>Position</dt>
              <dd>{form.requesterType ?? 'Not specified'}</dd>
              <dt>Department / office</dt>
              <dd>{form.department}</dd>
              <dt>Contact number</dt>
              <dd>{form.contactNumber}</dd>
              <dt>Email</dt>
              <dd>{form.requesterEmail}</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Work requested</h2>
            <dl className="kv" style={{ marginTop: 0 }}>
              <dt>Category</dt>
              <dd>{form.categoryName}</dd>
              <dt>Location</dt>
              <dd>{form.locationText}</dd>
              <dt>Priority</dt>
              <dd>
                <UrgencyAsPriority urgency={form.urgency} long />
              </dd>
              <dt>Preferred schedule</dt>
              <dd>{form.preferredSchedule ?? 'Any time'}</dd>
              <dt>Description</dt>
              <dd>{form.workRequested}</dd>
              {form.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{form.notes}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="card">
            <h2>Signature</h2>
            {form.signatureUrl ? (
              <img className="signature" src={form.signatureUrl} alt={`Signature of ${form.requesterName}`} />
            ) : (
              <p className="muted">Signature unavailable right now. Reload to try again.</p>
            )}
            <div className="head-badges" style={{ justifyContent: 'flex-start' }}>
              {form.integrityOk ? (
                <Flag kind="ok">Unchanged since signing</Flag>
              ) : (
                <Flag kind="danger">Changed after signing: do not rely on this form</Flag>
              )}
              <span className="muted small">
                Signed by {form.requesterName} on {formatDateTime(form.signedAt)} · certified true and correct
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-head">
              <h2>Processing</h2>
              {open && <span className="action-tag">Action needed</span>}
            </div>
            <ol className="timeline">
              <li style={{ '--dot': 'var(--st-assigned)' } as CSSProperties}>
                <div className="tl-head">
                  <span className="tl-status">Submitted</span>
                  <span className="tl-time">{formatDateTime(form.submittedAt)}</span>
                </div>
                <p>Revision {form.revision}</p>
              </li>
              {form.receivedAt ? (
                <li style={{ '--dot': 'var(--st-review)' } as CSSProperties}>
                  <div className="tl-head">
                    <span className="tl-status">Received</span>
                    <span className="tl-time">{formatDateTime(form.receivedAt)}</span>
                  </div>
                  {form.receivedBy && <p>{form.receivedBy.fullName}</p>}
                </li>
              ) : (
                open && (
                  <li style={{ '--dot': 'var(--st-cancelled)' } as CSSProperties}>
                    <div className="tl-head">
                      <span className="tl-status" style={{ color: 'var(--muted)' }}>Received</span>
                      <span className="tl-time">Not yet</span>
                    </div>
                  </li>
                )
              )}
              {form.decidedAt && (
                <li
                  style={{ '--dot': form.status === 'APPROVED' ? 'var(--st-completed)' : 'var(--st-delayed)' } as CSSProperties}
                >
                  <div className="tl-head">
                    <span className="tl-status">{form.status === 'APPROVED' ? 'Approved' : 'Returned for changes'}</span>
                    <span className="tl-time">{formatDateTime(form.decidedAt)}</span>
                  </div>
                  {form.decidedBy && <p>{form.decidedBy.fullName}</p>}
                  {form.decisionNote && <p>“{form.decisionNote}”</p>}
                </li>
              )}
            </ol>
            <p className="small">
              Job order: {job ? <Link to={`/reports/${form.reportId}`}>{job.jobOrderNo}</Link> : 'not yet created'}
            </p>

            {open && !mode && (
              <div className="btn-row">
                <button className="btn btn-primary" disabled={busy} onClick={() => setMode('approve')}>
                  Approve
                </button>
                {form.status === 'SUBMITTED' && (
                  <button className="btn" disabled={busy} onClick={() => void act('receive')}>
                    Mark received
                  </button>
                )}
                <button className="btn btn-ghost" disabled={busy} onClick={() => setMode('return')}>
                  Return for changes
                </button>
              </div>
            )}
            {open && mode && (
              <div className="section">
                <label className="field">
                  {mode === 'return' ? 'What should the requester change? (required)' : 'Remarks (optional)'}
                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <div className="btn-row">
                  <button
                    className="btn btn-primary"
                    disabled={busy || (mode === 'return' && note.trim().length < 5)}
                    onClick={() => void act(mode)}
                  >
                    {mode === 'return' ? 'Return to requester' : 'Approve form'}
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setMode(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {form.status === 'RETURNED' && (
              <p className="notice">Waiting for the requester to correct and re-sign the form.</p>
            )}
            {actionError && <p className="error-text">{actionError}</p>}
          </div>

          <div className="card">
            <h2>Printable copy</h2>
            <p className="muted">The signed form with its fingerprint, ready to print for the GSO file.</p>
            <button type="button" className="btn" onClick={() => void downloadPdf()}>
              Download printable form (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
