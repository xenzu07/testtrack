// FACILITRACK service worker: shows browser push notifications for the
// coordinator dashboard, also when no FACILITRACK tab is open.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'FACILITRACK', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // a visible dashboard tab already shows the new notification in its
      // bell, so the system pop-up is only needed when the user is elsewhere
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (tabs.some((c) => c.visibilityState === 'visible' && c.focused)) return;
      await self.registration.showNotification(data.title || 'FACILITRACK', {
        body: data.body || '',
        tag: data.tag, // one pop-up per notification, even if pushed twice
        data: { url: data.url || '/' },
        icon: '/favicon.svg',
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        return tab.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
