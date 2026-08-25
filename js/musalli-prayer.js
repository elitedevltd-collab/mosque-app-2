/* ============================================================================
   بوابة المصلّي — مواقيت الصلاة (Aladhan API) + الساعة + التقويم الهجري + الصيام
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

const PRAYER_ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const PRAYER_LABELS_AR = { Fajr: 'الفجر', Sunrise: 'الشروق', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
let todaysTimings = null;

function parseTimeToday(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
}

async function loadPrayerTimes() {
    const statusEl = document.getElementById('prayer-status');
    try {
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(PRAYER_CONFIG.city)}&country=${encodeURIComponent(PRAYER_CONFIG.country)}&method=${PRAYER_CONFIG.method}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.code !== 200) throw new Error('bad response');

        todaysTimings = data.data.timings;
        PRAYER_ORDER.forEach(key => {
            const row = document.querySelector(`.prayer-row[data-prayer="${key}"] .p-time`);
            if (row) row.textContent = (todaysTimings[key] || '--:--').split(' ')[0];
        });

        const g = data.data.date.gregorian;
        const hijriEl = document.getElementById('mf-date');
        if (hijriEl) hijriEl.textContent = `${g.weekday.ar} ${g.day} ${g.month.ar} ${g.year}`;

        if (statusEl) statusEl.textContent = '';
        updateNextPrayer();
    } catch (e) {
        if (statusEl) statusEl.textContent = '⚠️ تعذّر جلب مواقيت الصلاة — تحقق من الاتصال بالإنترنت';
    }
}

function updateNextPrayer() {
    if (!todaysTimings) return;
    const order = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']; // الشروق ليست وقت صلاة
    const now = new Date();
    let next = null;
    for (const key of order) {
        const t = (todaysTimings[key] || '').split(' ')[0];
        if (!t) continue;
        const d = parseTimeToday(t);
        if (d > now) { next = { key, date: d }; break; }
    }
    if (!next) {
        // بعد العشاء: القادمة فجر الغد
        const t = (todaysTimings.Fajr || '').split(' ')[0];
        const d = parseTimeToday(t);
        d.setDate(d.getDate() + 1);
        next = { key: 'Fajr', date: d };
    }

    document.querySelectorAll('.prayer-row').forEach(r => r.classList.toggle('is-next', r.dataset.prayer === next.key));
    const nameEl = document.getElementById('next-prayer-name');
    const cdEl = document.getElementById('next-prayer-countdown');
    if (nameEl) nameEl.textContent = PRAYER_LABELS_AR[next.key];

    const diffMs = next.date - now;
    const totalSec = Math.max(0, Math.floor(diffMs / 1000));
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    if (cdEl) cdEl.textContent = hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

function updateClock() {
    const el = document.getElementById('mf-clock');
    if (!el) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function showHadithOfDay() {
    if (!localDbReady || !hadithEntries.length) return;
    const dayIndex = Math.floor(Date.now() / 86400000); // نفس الحديث طوال اليوم، يتغيّر يوميًا
    const h = hadithEntries[dayIndex % hadithEntries.length];
    const box = document.getElementById('hadith-of-day');
    const textEl = document.getElementById('hod-text');
    const sourceEl = document.getElementById('hod-source');
    if (!box || !textEl || !sourceEl) return;
    const shortSource = h.bn.replace('صحيح ', '');
    textEl.textContent = `"${h.a}"`;
    sourceEl.textContent = `رواه ${shortSource}`;
    box.style.display = 'block';
}

// أيام الصيام المستحبة: الإثنين والخميس القادمين + الأيام البيض (13-14-15 من الشهر الهجري الحالي)
function nextWeekday(targetDow) { // 0=الأحد ... 1=الإثنين ... 4=الخميس
    const d = new Date();
    const diff = (targetDow - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
}
function formatGregorian(d) {
    return d.toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function computeFastingDays() {
    const box = document.getElementById('fasting-content');
    box.innerHTML = 'جارٍ الحساب...';
    try {
        const monday = nextWeekday(1);
        const thursday = nextWeekday(4);

        // نجيب التاريخ الهجري الحالي لحساب الأيام البيض (13-14-15) للشهر الهجري الجاري
        const todayStr = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
        const hRes = await fetch(`https://api.aladhan.com/v1/gToH/${todayStr}`);
        const hData = await hRes.json();
        const hMonth = hData.data.hijri.month.number;
        const hYear = hData.data.hijri.year;
        const hDay = parseInt(hData.data.hijri.day, 10);

        let targetMonth = hMonth, targetYear = hYear;
        if (hDay > 15) { // الأيام البيض فاتت لهذا الشهر — نحسب لشهر هجري قادم
            targetMonth = hMonth === 12 ? 1 : hMonth + 1;
            targetYear = hMonth === 12 ? hYear + 1 : hYear;
        }

        const whiteDaysPromises = [13, 14, 15].map(d =>
            fetch(`https://api.aladhan.com/v1/hToG/${String(d).padStart(2,'0')}-${String(targetMonth).padStart(2,'0')}-${targetYear}`).then(r => r.json())
        );
        const whiteDaysData = await Promise.all(whiteDaysPromises);
        const whiteDaysGregorian = whiteDaysData.map(d => {
            const g = d.data.gregorian;
            return `${g.day} ${g.month.ar}`;
        });

        box.innerHTML = `
            <div class="fasting-row"><span class="fname">الإثنين القادم</span><span class="fdate">${formatGregorian(monday)}</span></div>
            <div class="fasting-row"><span class="fname">الخميس القادم</span><span class="fdate">${formatGregorian(thursday)}</span></div>
            <div class="fasting-row"><span class="fname">الأيام البيض (13-15 ${hData.data.hijri.month.ar})</span><span class="fdate">${whiteDaysGregorian.join(' • ')}</span></div>
        `;
    } catch (e) {
        box.innerHTML = '⚠️ تعذّر حساب الأيام البيض (مشكلة اتصال) — إليك الإثنين والخميس القادمين فقط: ' +
            formatGregorian(nextWeekday(1)) + '، ' + formatGregorian(nextWeekday(4));
    }
}

// التقويم: الأحداث الإسلامية القادمة (رأس السنة، عاشوراء، رمضان، العشر الأواخر، عيد الفطر)
let calendarLoaded = false;
async function loadIslamicEvents() {
    calendarLoaded = true;
    const box = document.getElementById('events-content');
    box.innerHTML = 'جارٍ التحميل...';
    try {
        const todayStr = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
        const hRes = await fetch(`https://api.aladhan.com/v1/gToH/${todayStr}`);
        if (!hRes.ok) throw new Error('hijri-fetch-failed');
        const hData = await hRes.json();
        const curYear = hData.data.hijri.year;

        const EVENTS = [
            { name: 'رأس السنة الهجرية', day: 1, month: 1 },
            { name: 'يوم عاشوراء', day: 10, month: 1 },
            { name: 'بداية رمضان', day: 1, month: 9 },
            { name: 'العشر الأواخر من رمضان', day: 21, month: 9 },
            { name: 'عيد الفطر', day: 1, month: 10 }
        ];

        // نجلب كل حدث بشكل متتابع (لا بالتوازي) لتفادي حظر/تقييد الـ API عند إرسال طلبات كثيرة دفعة واحدة
        const results = [];
        for (const ev of EVENTS) {
            let found = null;
            for (const yearTry of [curYear, curYear + 1]) {
                try {
                    const res = await fetch(`https://api.aladhan.com/v1/hToG/${String(ev.day).padStart(2,'0')}-${String(ev.month).padStart(2,'0')}-${yearTry}`);
                    if (!res.ok) continue;
                    const data = await res.json();
                    const g = data.data.gregorian;
                    const gDate = new Date(`${g.year}-${g.month.number}-${g.day}`);
                    const now = new Date(); now.setHours(0,0,0,0);
                    if (gDate >= now) {
                        const daysLeft = Math.round((gDate - now) / 86400000);
                        found = { ...ev, daysLeft, gLabel: `${g.weekday.ar}، ${g.day} ${g.month.ar} ${g.year}`, hLabel: `${ev.day} ${data.data.hijri.month.ar} ${yearTry} هـ` };
                        break;
                    }
                } catch (innerErr) {
                    // تجاهل فشل هذا الحدث بالذات وجرّب السنة التالية أو الحدث التالي
                }
            }
            results.push(found);
        }

        const validResults = results.filter(Boolean);
        if (!validResults.length) {
            box.innerHTML = '⚠️ تعذّر تحميل الأحداث الإسلامية — تحقق من الاتصال بالإنترنت.';
            return;
        }

        box.innerHTML = validResults.map(r => `
            <div class="event-card">
                <div class="event-badge"><span class="num">${r.daysLeft}</span><span class="lbl">يوم</span></div>
                <div class="event-info">
                    <div class="ename">${r.name}</div>
                    <div class="edate">${r.hLabel} • ${r.gLabel}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        box.innerHTML = '⚠️ تعذّر تحميل الأحداث الإسلامية — تحقق من الاتصال بالإنترنت.';
    }
}
