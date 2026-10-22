/* Ledgerly service worker — displays Web Push price alerts. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "Ledgerly alert";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "Open Ledgerly for details.",
    icon: "/icon.png",
    badge: "/icon.png",
    // Re-use the tag so a repeated alert for the same asset replaces the old one.
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    renotify: Boolean(payload.tag),
    data: { url: typeof payload.url === "string" ? payload.url : "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      const existing = windows.find((client) => "focus" in client);
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) return existing.navigate(target);
        return undefined;
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })(),
  );
});
