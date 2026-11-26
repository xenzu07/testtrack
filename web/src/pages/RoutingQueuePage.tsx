import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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
          <h1>Pending Reports</h1>
          <p className="muted subtitle">
            Reports waiting for a job order, highest priority first. Nothing is assigned until you
            confirm.
          </p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>

      {notice && <p className="notice" style={{ marginBottom: 16 }}>{notice}</p>}
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

      <div className="qlist">
        {items.map((r) => {
          const reasons = [
            ...(r.needsReview ? r.reviewFlags.map((f) => REVIEW_FLAG_LABEL[f] ?? f) : []),
            ...(r.openDuplicateFlags > 0 && !r.reviewFlags.includes('possible_duplicate')
              ? [REVIEW_FLAG_LABEL.possible_duplicate]
              : []),
          ];
          const why = impactTags(r);
          const tech = r.recommendedTechnician;
          return (
            <article key={r.id} className="card qcard">
              <div className="q-head">
                <div className="q-titlewrap">
                  <div className="q-title">
                    <PriorityBadge priority={r.priority} />
                    <Link to={`/reports/${r.id}`}>{r.category.name}</Link>
                  </div>
                  <p className="q-loc">
                    {locationText(r.location)} · {r.reporter.fullName} · {timeAgo(r.createdAt)}
                  </p>
                </div>
                <div className="q-act">
                  {r.canAutoConfirm ? (
                    <>
                      <Link className="btn btn-small" to={`/reports/${r.id}`}>
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={busyId !== null}
                        onClick={() => void confirm(r)}
                      >
                        {busyId === r.id ? 'Creating...' : 'Confirm and create job order'}
                      </button>
                    </>
                  ) : (
                    <Link className="btn btn-primary btn-small" to={`/reports/${r.id}`} title={reasons.join(' · ') || undefined}>
                      Review first
                    </Link>
                  )}
                </div>
              </div>

              <div className="q-body">
                {why.length > 0 && (
                  <div className="why">
                    {why.map((w) => (
                      <span key={w.label}>
                        <QIcon name={w.icon} size={15} />
                        {w.label}
                      </span>
                    ))}
                  </div>
                )}
                <p className="q-desc">{r.description}</p>
              </div>

              <div className="q-foot">
                <div className="q-cell">
                  <span className="q-ic">
                    <QIcon name="tool" size={16} />
                  </span>
                  <span>
                    <span className="q-k">Trade unit</span>
                    <strong>{r.proposedTradeUnit.name}</strong>
                  </span>
                </div>
                <div className="q-cell">
                  {tech ? (
                    <span className="q-av" aria-hidden="true">{initials(tech.fullName)}</span>
                  ) : (
                    <span className="q-av q-none" aria-hidden="true">?</span>
                  )}
                  <span>
                    <span className="q-k">Recommended technician</span>
                    {tech ? (
                      <>
                        <strong>{tech.fullName}</strong>
                        <span className="q-m">{tech.reasons.join(' · ')}</span>
                      </>
                    ) : (
                      <>
                        <strong className="muted">No qualified technician available</strong>
                        <span className="q-m">You can assign one later</span>
                      </>
                    )}
                  </span>
                </div>
                {(r.needsReview || r.openDuplicateFlags > 0 || r._count.duplicates > 0) && (
                  <div className="q-flags">
                    {r.needsReview && <Flag kind="warn">Needs review</Flag>}
                    {r.openDuplicateFlags > 0 && (
                      <Flag kind="danger">May be the same problem as another report</Flag>
                    )}
                    {r._count.duplicates > 0 && (
                      <Flag kind="info">
                        {r._count.duplicates} linked {r._count.duplicates === 1 ? 'report' : 'reports'}
                      </Flag>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !w.endsWith('.'))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

const PEOPLE_TAG = ['Just the reporter', '2–10 people affected', '11–50 people affected', 'More than 50 people affected'];

// neutral reason tags: what the reporter said about the impact
function impactTags(r: RoutingQueueItem): { icon: string; label: string }[] {
  const tags: { icon: string; label: string }[] = [];
  if (r.safetyHazard) tags.push({ icon: 'hazard', label: 'Safety hazard' });
  if (r.blocksUse === true) tags.push({ icon: 'blocked', label: 'Area unusable' });
  else if (r.blocksUse === false) tags.push({ icon: 'ok', label: 'Area still usable' });
  const people = PEOPLE_TAG[r.affectedPeople ?? -1];
  if (people) tags.push({ icon: 'people', label: people });
  return tags;
}

const Q_ICONS: Record<string, ReactNode> = {
  hazard: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  blocked: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  ok: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.8-1.7-5.1-4-5.8" /></>,
  tool: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />,
};

function QIcon({ name, size }: { name: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Q_ICONS[name]}
    </svg>
  );
}
