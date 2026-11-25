import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from './api';
import { timeAgo } from './format';
import { useSocketEvent } from './socket';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  reportId: string | null;
  jobOrderId: string | null;
  formId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Page {
  items: AppNotification[];
  unread: number;
  hasMore: boolean;
}

export type PushState = 'unsupported' | 'unavailable' | 'ask' | 'denied' | 'on';

interface Ctx {
  items: AppNotification[];
  unread: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  open: (n: AppNotification) => void;
  markAllRead: () => Promise<void>;
  push: PushState;
  enablePush: () => Promise<void>;
}

const NotificationsContext = createContext<Ctx | null>(null);

export const linkFor = (n: AppNotification) =>
  n.formId ? `/forms/${n.formId}` : n.reportId ? `/reports/${n.reportId}` : '/notifications';

// ---------------- browser push (Web Push) ----------------

const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  window.isSecureContext;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Subscribes this browser (asking for permission only when `ask` is true,
// i.e. after a click) and registers the subscription for the signed-in user.
async function subscribeBrowser(publicKey: string, ask: boolean): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  let permission = Notification.permission;
  if (permission === 'default' && ask) permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'ask';

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // a subscription made with an older key would be rejected by the server
  const key = urlBase64ToUint8Array(publicKey);
  const current = sub?.options.applicationServerKey;
  if (sub && current && !sameKey(new Uint8Array(current), key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  await api.post('/notifications/devices', {
    platform: 'WEB',
    token: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    userAgent: navigator.userAgent.slice(0, 300),
  });
  return 'on';
}

function sameKey(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// On sign-out this browser stops receiving the account's pushes: the server
// forgets the subscription and the browser drops it.
// `token` is the session being closed (it is already removed from storage).
export async function unsubscribeBrowser(token: string | null) {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (token) {
      await api
        .delete('/notifications/devices', {
          data: { token: sub.endpoint },
          headers: { Authorization: `Bearer ${token}` },
        })
        .catch(() => undefined);
    }
    await sub.unsubscribe();
  } catch {
    // nothing else to do: the server also drops dead subscriptions on its own
  }
}

// ---------------- provider ----------------

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>('unavailable');
  const publicKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<Page>('/notifications', { params: { limit: 30 } });
      setItems(res.data.items);
      setUnread(res.data.unread);
      setHasMore(res.data.hasMore);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    // browser push: re-register silently when permission was already given
    void (async () => {
      try {
        const cfg = (await api.get<{ webPushPublicKey: string | null }>('/notifications/push-config')).data;
        publicKey.current = cfg.webPushPublicKey;
        if (!pushSupported()) setPush('unsupported');
        else if (!cfg.webPushPublicKey) setPush('unavailable');
        else setPush(await subscribeBrowser(cfg.webPushPublicKey, false));
      } catch {
        setPush('unavailable');
      }
    })();
  }, [refresh]);

  // a password change ends the other sessions and their push registrations;
  // this browser registers again with its new session
  useEffect(() => {
    const again = () => {
      if (publicKey.current) void subscribeBrowser(publicKey.current, false).then(setPush).catch(() => undefined);
    };
    window.addEventListener('facilitrack:session-renewed', again);
    return () => window.removeEventListener('facilitrack:session-renewed', again);
  }, []);

  // new notifications arrive over the live connection (own ones only)
  useSocketEvent<AppNotification>('notification.new', (n) => {
    setItems((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list]));
    setUnread((u) => u + 1);
  });

  // after a reconnect or coming back to the tab, catch up on missed ones
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!last) return;
    const res = await api.get<Page>('/notifications', { params: { limit: 30, before: last.createdAt } });
    setItems((list) => [...list, ...res.data.items.filter((n) => !list.some((x) => x.id === n.id))]);
    setHasMore(res.data.hasMore);
  }, [items]);

  const open = useCallback(
    (n: AppNotification) => {
      if (!n.readAt) {
        setItems((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
        setUnread((u) => Math.max(0, u - 1));
        void api
          .post<{ unread: number }>(`/notifications/${n.id}/read`)
          .then((r) => setUnread(r.data.unread))
          .catch(() => undefined);
      }
      navigate(linkFor(n));
    },
    [navigate],
  );

  const markAllRead = useCallback(async () => {
    await api.post('/notifications/read-all');
    const now = new Date().toISOString();
    setItems((list) => list.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    setUnread(0);
  }, []);

  const enablePush = useCallback(async () => {
    if (!publicKey.current) return;
    try {
      setPush(await subscribeBrowser(publicKey.current, true));
    } catch {
      setPush('unavailable');
    }
  }, []);

  const value = useMemo(
    () => ({ items, unread, hasMore, loading, error, loadMore, open, markAllRead, push, enablePush }),
    [items, unread, hasMore, loading, error, loadMore, open, markAllRead, push, enablePush],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}

// ---------------- UI ----------------

export function PushPrompt() {
  const { push, enablePush } = useNotifications();
  if (push === 'ask') {
    return (
      <div className="push-prompt">
        <span>Get desktop alerts even when this tab is closed.</span>
        <button className="btn btn-small" onClick={() => void enablePush()}>
          Turn on
        </button>
      </div>
    );
  }
  if (push === 'denied') {
    return (
      <p className="push-prompt muted small">
        Desktop alerts are blocked for this site. Allow notifications in the browser's site settings to
        turn them on.
      </p>
    );
  }
  return null;
}

export function NotificationList({ items, compact }: { items: AppNotification[]; compact?: boolean }) {
  const { open } = useNotifications();
  if (items.length === 0) {
    return <p className="empty center">You have no notifications yet.</p>;
  }
  return (
    <ul className={`notif-list${compact ? ' notif-compact' : ''}`}>
      {items.map((n) => (
        <li key={n.id}>
          <button className={`notif${n.readAt ? '' : ' notif-unread'}`} onClick={() => open(n)}>
            <span className="notif-dot" aria-hidden="true" />
            <span className="notif-text">
              <span className="notif-title">
                {n.title}
                {!n.readAt && <span className="sr-only"> (unread)</span>}
              </span>
              <span className="notif-body">{n.body}</span>
            </span>
            <span className="notif-time">{timeAgo(n.createdAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// bell with the unread count; opens the latest notifications in a panel
export function NotificationBell() {
  const { items, unread, markAllRead } = useNotifications();
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [show]);

  return (
    <div className="bell" ref={ref}>
      <button
        className="icon-btn bell-btn"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={show}
        onClick={() => setShow((s) => !s)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {show && (
        <div className="bell-panel" role="dialog" aria-label="Notifications" onClick={(e) => (e.target as HTMLElement).closest('.notif') && setShow(false)}>
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="btn btn-ghost btn-small" onClick={() => void markAllRead()}>
                Mark all as read
              </button>
            )}
          </div>
          <PushPrompt />
          <NotificationList items={items.slice(0, 8)} compact />
          <Link className="bell-all" to="/notifications" onClick={() => setShow(false)}>
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const { items, unread, hasMore, loading, error, loadMore, markAllRead } = useNotifications();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const shown = onlyUnread ? items.filter((n) => !n.readAt) : items;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="muted subtitle">{unread ? `${unread} unread` : 'All caught up'}</p>
        </div>
        {unread > 0 && (
          <button className="btn" onClick={() => void markAllRead()}>
            Mark all as read
          </button>
        )}
      </div>
      <div className="tabs" role="tablist" aria-label="Show">
        <button role="tab" aria-selected={!onlyUnread} className={`tab${!onlyUnread ? ' tab-active' : ''}`} onClick={() => setOnlyUnread(false)}>
          All
        </button>
        <button role="tab" aria-selected={onlyUnread} className={`tab${onlyUnread ? ' tab-active' : ''}`} onClick={() => setOnlyUnread(true)}>
          Unread <span className={`tab-count${unread ? ' tab-count-alert' : ''}`}>{unread}</span>
        </button>
      </div>
      <PushPrompt />
      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <div className="card table-wrap">
          <NotificationList items={shown} />
        </div>
      )}
      {hasMore && !onlyUnread && (
        <div className="btn-row">
          <button className="btn" onClick={() => void loadMore()}>
            Load older
          </button>
        </div>
      )}
    </div>
  );
}
