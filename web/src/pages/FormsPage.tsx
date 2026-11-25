import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { formatDateTime, timeAgo } from '../format';
import { useRealtime } from '../socket';
import { ErrorBox, FilterTabs, RefreshButton, FormStatusBadge, UrgencyBadge } from '../ui';
import type { FormStatus, JobOrderFormView } from '../types';

const STATUSES: FormStatus[] = ['SUBMITTED', 'RECEIVED', 'RETURNED', 'APPROVED'];
const LABEL: Record<FormStatus, string> = {
  SUBMITTED: 'New',
  RECEIVED: 'Received',
  RETURNED: 'Returned',
  APPROVED: 'Approved',
};

// Job Order Forms signed and sent by reporters, newest first.
export default function FormsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as FormStatus | '';
  const [forms, setForms] = useState<JobOrderFormView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setForms((await api.get<JobOrderFormView[]>('/job-order-forms')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.kind === 'form.submitted' || e.kind === 'form.updated') void load();
  });

  const counts = useMemo(
    () => Object.fromEntries(STATUSES.map((s) => [s, forms.filter((f) => f.status === s).length])) as Record<FormStatus, number>,
    [forms],
  );
  const shown = status ? forms.filter((f) => f.status === status) : forms;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Job Order Forms</h1>
          <p className="muted subtitle">Signed requests from reporters. Receive, approve or return each one.</p>
        </div>
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>

      <FilterTabs
        label="Status"
        value={status}
        onChange={(v) => setParams(v ? { status: v } : {}, { replace: true })}
        items={[
          { value: '', label: 'All', count: forms.length },
          ...STATUSES.map((s) => ({ value: s, label: LABEL[s], count: counts[s], alert: s === 'SUBMITTED' })),
        ]}
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && (
        <div className="card table-wrap">
          <table className="table table-responsive table-clickable">
            <thead>
              <tr>
                <th>Form</th>
                <th>Requester</th>
                <th>Work requested</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Job order</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} onClick={() => navigate(`/forms/${f.id}`)}>
                  <td data-label="Form">
                    <Link to={`/forms/${f.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{f.formNo}</strong>
                    </Link>
                    {f.revision > 1 && <div className="cell-sub">revision {f.revision}</div>}
                  </td>
                  <td data-label="Requester">
                    {f.requesterName}
                    <div className="cell-sub">{f.department}</div>
                  </td>
                  <td data-label="Work requested">
                    {f.categoryName}
                    <div className="cell-sub">{f.locationText}</div>
                  </td>
                  <td data-label="Urgency">
                    <UrgencyBadge urgency={f.urgency} />
                  </td>
                  <td data-label="Status">
                    <FormStatusBadge status={f.status} />
                  </td>
                  <td data-label="Job order">
                    {f.report?.jobOrder && f.report.jobOrder.status !== 'CANCELLED' ? f.report.jobOrder.jobOrderNo : <span className="muted">Not yet</span>}
                  </td>
                  <td data-label="Submitted" title={formatDateTime(f.submittedAt)}>
                    {timeAgo(f.submittedAt)}
                  </td>
                </tr>
              ))}
              {!loading && shown.length === 0 && (
                <tr className="row-empty">
                  <td colSpan={7} className="muted center">
                    {forms.length === 0 ? 'No Job Order Forms yet.' : 'No forms with this status.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
