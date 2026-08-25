/* ============================================================================
   بوابة المصلّي — الإعدادات العامة + الربط بفايربيز + التنقل + التشغيل الرئيسي
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل، مع إضافة
   ربط بسيط لعناصر الواجهة الجديدة (ورقة الإعدادات، شريط التنقل السفلي)
   ============================================================================ */

/* ⚙️ إعدادات Firebase — يجب أن تكون مطابقة تمامًا لنفس القيم الموجودة في imam.html */
const FIREBASE_CONFIG = {
    databaseURL: "https://mosqa-app-default-rtdb.asia-southeast1.firebasedatabase.app",
    sermonPath: "sermon"
};

/* ⚙️ خدمة الترجمة الموثوقة (اختياري). اتركه فارغًا "" ليعمل التطبيق بالخدمات المجانية الاحتياطية فقط. */
const TRANSLATE_WORKER_URL = ""; // مثال: "https://mosque-translate.username.workers.dev"
const WORKER_SHARED_SECRET = ""; // يجب أن يطابق WORKER_SHARED_SECRET في الـ Worker — راجع PHASE0_SETUP.md

const FIREBASE_DB_URL = `${FIREBASE_CONFIG.databaseURL}/${FIREBASE_CONFIG.sermonPath}.json`;
let lastTimestamp = 0;
let lastText = "";

function listenToCloud() {
    setInterval(async () => {
        try {
            const response = await fetch(FIREBASE_DB_URL);
            const data = await response.json();
            lastFetchOkAt = Date.now();
            if(data && data.text && data.timestamp !== lastTimestamp) {
                lastTimestamp = data.timestamp;
                lastText = data.text;
                lastSermonUpdateAt = Date.now();
                runTranslation(lastText);
            }
        } catch (e) { console.log("Firebase connection standby."); }
    }, 700);
}

async function checkFirebaseConnection() {
    const statusEl = document.getElementById('fb-status');
    if (!statusEl) return;
    if (FIREBASE_CONFIG.databaseURL.includes('YOUR-PROJECT-ID')) {
        statusEl.textContent = '⚠️ لم يتم ربط Firebase بعد';
        statusEl.style.color = 'var(--color-danger)';
        return;
    }
    try {
        const res = await fetch(FIREBASE_DB_URL);
        lastFetchOkAt = res.ok ? Date.now() : lastFetchOkAt;
        statusEl.textContent = res.ok ? '✅ متصل' : '⚠️ تعذّر الاتصال';
        statusEl.style.color = res.ok ? 'var(--color-success)' : 'var(--color-danger)';
    } catch (e) {
        statusEl.textContent = '⚠️ تعذّر الاتصال';
        statusEl.style.color = 'var(--color-danger)';
    }
}

// ===== مؤشر صحة البث الحي — نتابع فعليًا وقت آخر تحديث حقيقي، لا نعرض "متصل" ثابتًا =====
let lastFetchOkAt = 0;
let lastSermonUpdateAt = 0;

function updateLiveHealthIndicator() {
    const dot = document.getElementById('live-pulse');
    const label = document.getElementById('live-status-text');
    if (!dot || !label) return;
    const now = Date.now();
    const sinceFetch = lastFetchOkAt ? now - lastFetchOkAt : Infinity;
    const sinceUpdate = lastSermonUpdateAt ? now - lastSermonUpdateAt : null;

    if (sinceFetch > 20000) {
        dot.style.background = 'var(--color-danger)';
        label.textContent = '🔴 انقطع الاتصال بالخادم';
        label.style.color = 'var(--color-danger)';
    } else if (sinceUpdate === null) {
        dot.style.background = 'var(--color-warning)';
        label.textContent = '🟡 في انتظار بدء الخطبة...';
        label.style.color = 'var(--color-warning)';
    } else if (sinceUpdate > 90000) {
        const mins = Math.floor(sinceUpdate / 60000);
        dot.style.background = 'var(--color-danger)';
        label.textContent = `🔴 لا يوجد تحديث منذ ${mins >= 1 ? mins + ' دقيقة' : 'أكثر من دقيقة'} — يبدو أن البث توقف`;
        label.style.color = 'var(--color-danger)';
    } else if (sinceUpdate > 25000) {
        dot.style.background = 'var(--color-warning)';
        label.textContent = '🟡 لا يوجد كلام جديد منذ لحظات...';
        label.style.color = 'var(--color-warning)';
    } else {
        dot.style.background = 'var(--color-live)';
        label.textContent = 'البث المباشر متصل فوريًا';
        label.style.color = 'var(--color-live)';
    }
}

// ===== التنقّل بين الشاشات =====
function navigateTo(targetPage) {
    ['home', 'knowledge', 'tools', 'calendar'].forEach(p => {
        document.getElementById('tab-' + p).classList.remove('active');
        const navEl = document.getElementById('nav-' + p);
        navEl.classList.remove('active');
        navEl.removeAttribute('aria-current');
    });

    const mainTitle = document.getElementById('app-main-title');
    const subTitle = document.getElementById('app-sub-title');
    document.getElementById('tab-' + targetPage).classList.add('active');
    const activeNav = document.getElementById('nav-' + targetPage);
    activeNav.classList.add('active');
    activeNav.setAttribute('aria-current', 'page');

    const titles = {
        home: ["🕌 بوابة المسجد الرقمية", "مرحباً بك في بيت الله • Welcome to the Mosque"],
        knowledge: ["📖 الموسوعة الإسلامية الرقمية", "بحث أسرع وأكثر استقراراً في القرآن الكريم والسنة النبوية"],
        tools: ["🧭 أدوات", "القبلة، الأذكار، العمرة، والصيام"],
        calendar: ["📅 التقويم", "الأحداث الإسلامية المهمة"]
    };
    mainTitle.innerText = titles[targetPage][0];
    subTitle.innerText = titles[targetPage][1];

    if (targetPage === 'tools' && !qiblaComputed) computeQibla();
    if (targetPage === 'calendar' && !calendarLoaded) loadIslamicEvents();
}

function toggleTool(name) {
    const panel = document.getElementById('tool-' + name);
    const isOpen = panel.style.display !== 'none';
    document.querySelectorAll('.tool-panel').forEach(p => p.style.display = 'none');
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen && name === 'fasting') computeFastingDays();
    if (isOpen && name === 'qibla' && typeof stopLiveCompass === 'function') stopLiveCompass();
}

function changeLanguage() {
    const select = document.getElementById('lang-select');
    const isRtl = select.options[select.selectedIndex].getAttribute('data-rtl') === 'true';
    document.getElementById('translation-output').className = isRtl ? "translation-display rtl" : "translation-display ltr";
    if(lastText) runTranslation(lastText);
}

function speak() {
    try {
        const text = document.getElementById('translation-output').innerText;
        const lang = document.getElementById('lang-select').value;
        window.speechSynthesis.cancel();
        if ('speechSynthesis' in window && text) {
            const speech = new SpeechSynthesisUtterance(text);
            speech.lang = lang;
            window.speechSynthesis.speak(speech);
        }
    } catch (e) { console.error(e); }
}

// ===== ورقة الإعدادات (جديدة) — وضع الثيم + حجم الخط + تقليل الحركة، تُبنى فوق ما هو موجود بدون كسره =====
function openSettingsSheet() {
    const overlay = document.getElementById('settings-overlay');
    if (overlay) overlay.style.display = 'flex';
}
function closeSettingsSheet() {
    const overlay = document.getElementById('settings-overlay');
    if (overlay) overlay.style.display = 'none';
}

// إضافة مستمعي أحداث الإدخال والتنقّل بلوحة المفاتيح
document.addEventListener('DOMContentLoaded', function() {
    const qInput = document.getElementById('quran-search-input');
    const hInput = document.getElementById('hadith-search-input');
    if (qInput) qInput.addEventListener('keypress', function(e) { if(e.key === 'Enter') searchQuranLibrary(); });
    if (hInput) hInput.addEventListener('keypress', function(e) { if(e.key === 'Enter') searchHadithLibrary(); });

    const overlay = document.getElementById('settings-overlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeSettingsSheet(); });
    }
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeSettingsSheet();
    });

    // مسجّل الـ Service Worker (PWA) — مسار نسبي حتى يعمل على GitHub Pages تحت أي مسار فرعي
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function(e) { console.log('SW registration skipped:', e); });
    }
});

window.onload = function() {
    loadDisplayPreferences();
    checkFirebaseConnection();
    loadLocalDatabases();
    listenToCloud();
    initCitySelect();
    loadPrayerTimes();
    updateClock();
    setInterval(updateClock, 30000);       // تحديث الساعة كل نصف دقيقة
    setInterval(updateNextPrayer, 1000);    // عد تنازلي حي كل ثانية
    setInterval(loadPrayerTimes, 3600000);  // إعادة جلب المواقيت كل ساعة
    setInterval(checkFirebaseConnection, 30000); // إعادة فحص الاتصال دوريًا
    setInterval(updateLiveHealthIndicator, 3000); // تحديث شارة "متصل" الحقيقية كل 3 ثوانٍ
};
