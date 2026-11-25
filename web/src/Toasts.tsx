import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRealtime } from './socket';
import type { StatusChangedEvent } from './socket';

interface Toast {
  id: number;
  event: StatusChangedEvent;
}

// Pop-up notices for coordinators when a technician answers an assignment.
// Accepts disappear after a few seconds; declines stay until dismissed,
// because they need action (reassigning the job).
export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  useRealtime((e) => {
    if (e.kind !== 'assignment.accepted' && e.kind !== 'assignment.declined' && e.kind !== 'form.submitted') return;
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, event: e }]);
    if (e.kind !== 'assignment.declined') setTimeout(() => dismiss(id), 8000);
  });

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(({ id, event }) => (
        <div key={id} className={`toast ${event.kind === 'assignment.declined' ? 'toast-danger' : 'toast-ok'}`}>
          <div>
            <strong>
              {event.kind === 'assignment.declined'
                ? 'Assignment declined'
                : event.kind === 'form.submitted'
                  ? 'New Job Order Form'
                  : 'Assignment accepted'}
            </strong>
            <p>{event.message}</p>
            <Link to={`/reports/${event.reportId}`} onClick={() => dismiss(id)}>
              {event.kind === 'assignment.declined' ? 'Reassign now' : event.kind === 'form.submitted' ? 'Open the report' : 'Open'}
            </Link>
          </div>
          <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
