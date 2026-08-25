/* ============================================================================
   بوابة المسجد — Service Worker
   يخزّن غلاف التطبيق (HTML/CSS/JS/الأيقونات) للعمل دون اتصال، لكنه لا يخزّن أبدًا
   أي طلب متعلق بالبث الحي أو الترجمة أو مواقيت الصلاة — هذه دائمًا من الشبكة مباشرة
   حتى لا يرى المصلي نصًا قديمًا مخزّنًا يظنه بثًا حيًا.
   ============================================================================ */

const CACHE_VERSION = 'mosque-app-v1';
const APP_SHELL = [
    './musalli.html',
    './css/tokens.css',
    './css/base.css',
    './css/components.css',
    './css/musalli.css',
    './js/musalli-settings.js',
    './js/musalli-prayer.js',
    './js/musalli-qibla.js',
    './js/musalli-quran-hadith.js',
    './js/musalli-translation.js',
    './js/musalli-app.js',
    './manifest.json'
];

// نطاقات يجب ألا تُخزَّن أبدًا — بث حي، ترجمة، مواقيت صلاة، تقويم هجري
const NEVER_CACHE_HOSTS = [
    'firebasedatabase.app',
    'firebaseio.com',
    'translate.googleapis.com',
    'mymemory.translated.net',
    'api.aladhan.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return; // اترك POST/PUT (نشر الخطبة) للشبكة دائمًا بلا تدخل

    if (NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h))) {
        return; // اترك المتصفح يتعامل معها مباشرة من الشبكة (لا caches.match ولا respondWith)
    }

    // بيانات القرآن/الحديث كبيرة الحجم ونادرًا ما تتغيّر — نخزّنها بعد أول تحميل ناجح (stale-while-revalidate)
    if (url.pathname.endsWith('quran-data.json') || url.pathname.endsWith('hadith-data.json')) {
        event.respondWith(
            caches.open(CACHE_VERSION).then(async (cache) => {
                const cached = await cache.match(event.request);
                const networkFetch = fetch(event.request).then((res) => {
                    if (res.ok) cache.put(event.request, res.clone());
                    return res;
                }).catch(() => cached);
                return cached || networkFetch;
            })
        );
        return;
    }

    // غلاف التطبيق: من الكاش أولًا (سرعة + عمل دون اتصال)، ثم الشبكة كاحتياط، مع تحديث الكاش في الخلفية
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request).then((res) => {
                if (res.ok && url.origin === self.location.origin) {
                    caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, res.clone()));
                }
                return res;
            }).catch(() => cached);
            return cached || networkFetch;
        })
    );
});
