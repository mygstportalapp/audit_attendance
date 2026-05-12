self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // 🔥 THE FIX: Do not intercept POST requests! 
    // Let all API calls to Google Apps Script pass through normally.
    if (e.request.method === 'POST') {
        return; 
    }

    // For normal page loads (GET requests), provide basic offline protection
    e.respondWith(
        fetch(e.request).catch(() => {
            return new Response("Offline Mode Active.");
        })
    );
});
