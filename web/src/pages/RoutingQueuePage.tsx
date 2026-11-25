import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { REVIEW_FLAG_LABEL, locationText, timeAgo } from '../format';
import { useRealtime } from '../socket';
import { ErrorBox, RefreshButton, Flag, PriorityBadge } from '../ui';
import type { RoutingQueue, RoutingQueueItem } from '../types';

// Reports waiting for a job order, most important first, each with the
// recommended trade unit and technician. One click creates the job order,
// but only when nothing needs a coordinator's judgement first.
export default function RoutingQueuePage() {
  const [queue, setQueue] = useState<RoutingQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQueue((await api.get<RoutingQueue>('/routing/queue')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(() => {
    void load();
  });

  async function confirm(item: RoutingQueueItem) {
    const tech = item.recommendedTechnician!;
    const ok = window.confirm(
      `Create a job order for "${item.category.name}" (${locationText(item.location)})?\n\n` +
        `Trade unit: ${item.proposedTradeUnit.name}\nTechnician: ${tech.fullName}\n\n` +
        `The technician will be asked to accept it.`,
    );
    if (!ok) return;
    setBusyId(item.id);
    setNotice(null);
    try {
      const res = await api.post<{ jobOrderNo: string }>('/job-orders', {
        reportId: item.id,
        tradeUnitId: item.proposedTradeUnit.id,
        technicianId: tech.id,
        routingRemarks: 'Confirmed from the routing queue recommendation',
      });
      setNotice(`${res.data.jobOrderNo} created and offered to ${tech.fullName}.`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusyId(null);
  }

  const items = queue?.items ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Routing queue</h1>
          <p className="muted subtitle">
            Reports waiting for a job order, highest priority first. Nothing is assigned until you
            confirm.
          </p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {queue && queue.linkedDuplicatesWaiting > 0 && (
        <p className="muted">
          {queue.linkedDuplicatesWaiting === 1 ? '1 report linked as a duplicate is' : `${queue.linkedDuplicatesWaiting} reports linked as duplicates are`} not listed: they are
          handled with their original report.
        </p>
      )}

      {queue && items.length === 0 && (
        <div className="card">
          <p className="muted center">Nothing waiting. Every report has a job order.</p>
        </div>
      )}

      <div className="queue">
        {items.map((r, i) => {
          const reasons = [
            ...(r.needsReview ? r.reviewFlags.map((f) => REVIEW_FLAG_LABEL[f] ?? f) : []),
            ...(r.openDuplicateFlags > 0 && !r.reviewFlags.includes('possible_duplicate')
              ? [REVIEW_FLAG_LABEL.possible_duplicate]
              : []),
          ];
          return (
            <div key={r.id} className={`card queue-item ${r.priority === 'P1' ? 'queue-p1' : ''}`}>
              <div className="queue-rank">{i + 1}</div>
              <div className="queue-main">
                <div className="queue-title">
                  <PriorityBadge priority={r.priority} />
                  <Link to={`/reports/${r.id}`}>
                    <strong>{r.category.name}</strong>
                  </Link>
                </div>
                <div className="muted small">
                  {locationText(r.location)} · {r.reporter.fullName} · {timeAgo(r.createdAt)}
                </div>
                <p className="queue-desc">{r.description}</p>
                <div className="head-badges queue-badges">
                  {r.needsReview && <Flag kind="warn">Needs review</Flag>}
                  {r.openDuplicateFlags > 0 && <Flag kind="danger">Possible duplicate</Flag>}
                  {r._count.duplicates > 0 && <Flag kind="info">{r._count.duplicates} linked {r._count.duplicates === 1 ? 'report' : 'reports'}</Flag>}
                </div>
              </div>
              <div className="queue-side">
                <span className="small muted">Trade unit</span>
                <strong>{r.proposedTradeUnit.name}</strong>
                <span className="small muted">Recommended technician</span>
                {r.recommendedTechnician ? (
                  <span>
                    <strong>{r.recommendedTechnician.fullName}</strong>
                    <span className="small muted block">{r.recommendedTechnician.reasons.join(' · ')}</span>
                  </span>
                ) : (
                  <span className="muted">No qualified technician available</span>
                )}
                <div className="btn-row">
                  {r.canAutoConfirm ? (
                    <button className="btn btn-primary btn-small" disabled={busyId !== null} onClick={() => void confirm(r)}>
                      {busyId === r.id ? 'Creating...' : 'Confirm and create job order'}
                    </button>
                  ) : (
                    <Link className="btn btn-primary btn-small" to={`/reports/${r.id}`}>
                      Review first
                    </Link>
                  )}
                  {r.canAutoConfirm && (
                    <Link className="btn btn-small" to={`/reports/${r.id}`}>
                      Open
                    </Link>
                  )}
                </div>
                {!r.canAutoConfirm && reasons.length > 0 && (
                  <ul className="flag-list small">
                    {reasons.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
