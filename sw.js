const SW_VERSION = 'lagertool-todo-push-2026-09-29';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'LagerTool';
  const priority = Number(data.priority) || 0;
  const body = data.body || '';
  const todoId = data.todoId || '';
  const url = new URL(data.url || (todoId ? ('?todo=' + encodeURIComponent(todoId)) : './'), self.registration.scope).href;
  const options = {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: todoId ? ('lagertool-todo-' + todoId) : undefined,
    renotify: priority === 1,
    requireInteraction: priority === 1,
    data: { url, todoId, priority },
    actions: [{ action: 'open', title: 'Öffnen' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification?.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const u = new URL(client.url);
        const t = new URL(target);
        if (u.origin === t.origin && u.pathname === t.pathname) {
          if ('navigate' in client) await client.navigate(target);
          return client.focus();
        }
      } catch (_) {}
    }
    return clients.openWindow(target);
  })());
});
