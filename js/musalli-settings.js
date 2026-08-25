/* ============================================================================
   بوابة المصلّي — الإعدادات: الثيم، حجم الخط، المدينة (تُحفظ محليًا على الجهاز)
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

const SAUDI_CITIES = [
    { ar: 'الرياض', en: 'Riyadh' }, { ar: 'جدة', en: 'Jeddah' },
    { ar: 'مكة المكرمة', en: 'Makkah' }, { ar: 'المدينة المنورة', en: 'Madinah' },
    { ar: 'الدمام', en: 'Dammam' }, { ar: 'الخبر', en: 'Khobar' },
    { ar: 'الطائف', en: 'Taif' }, { ar: 'أبها', en: 'Abha' },
    { ar: 'تبوك', en: 'Tabuk' }, { ar: 'بريدة', en: 'Buraydah' },
    { ar: 'حائل', en: 'Hail' }, { ar: 'نجران', en: 'Najran' },
    { ar: 'الجبيل', en: 'Jubail' }, { ar: 'ينبع', en: 'Yanbu' },
    { ar: 'خميس مشيط', en: 'Khamis Mushait' }
];
const PRAYER_CONFIG = {
    city: "Riyadh",
    country: "Saudi Arabia",
    method: 4 // أم القرى (مكة المكرمة)
};

function initCitySelect() {
    const select = document.getElementById('city-select');
    if (!select) return;
    SAUDI_CITIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.en;
        opt.textContent = c.ar;
        select.appendChild(opt);
    });
    let saved = 'Riyadh';
    try { saved = localStorage.getItem('mosque-app-city') || 'Riyadh'; } catch (e) {}
    select.value = saved;
    PRAYER_CONFIG.city = saved;
}

function onCityChange() {
    const select = document.getElementById('city-select');
    if (!select) return;
    PRAYER_CONFIG.city = select.value;
    try { localStorage.setItem('mosque-app-city', select.value); } catch (e) {}
    loadPrayerTimes();
}

// ===== الثيم (فاتح/داكن) — يدعم أيضًا خيار "تلقائي" (يتبع نظام الجهاز) عبر عدم ضبط data-theme إطلاقًا =====
const FONT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.5];
let fontScaleIndex = 1;

function applyTheme(theme) {
    // theme: 'light' | 'dark' | 'auto'
    if (theme === 'auto') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    document.querySelectorAll('[data-theme-label]').forEach(el => {
        const effectiveDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        el.textContent = effectiveDark ? '☀️ وضع نهاري' : '🌙 وضع ليلي';
    });
    document.querySelectorAll('[data-theme-select]').forEach(el => { el.value = theme; });
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const effectiveDark = current === 'dark' || (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = effectiveDark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('mosque-app-theme', next); } catch (e) {}
}

function setTheme(theme) {
    applyTheme(theme);
    try { localStorage.setItem('mosque-app-theme', theme); } catch (e) {}
}

function applyFontScale() {
    const scale = FONT_SCALE_STEPS[fontScaleIndex];
    document.documentElement.style.setProperty('--sermon-scale', scale);
}

function changeFontScale(direction) {
    const newIndex = fontScaleIndex + direction;
    if (newIndex < 0 || newIndex >= FONT_SCALE_STEPS.length) return;
    fontScaleIndex = newIndex;
    applyFontScale();
    try { localStorage.setItem('mosque-app-font-index', String(fontScaleIndex)); } catch (e) {}
}

function setReduceMotion(enabled) {
    document.documentElement.setAttribute('data-reduce-motion', enabled ? 'true' : 'false');
    try { localStorage.setItem('mosque-app-reduce-motion', enabled ? '1' : '0'); } catch (e) {}
}

function loadDisplayPreferences() {
    try {
        const savedTheme = localStorage.getItem('mosque-app-theme') || 'auto';
        applyTheme(savedTheme);

        const savedFontIndex = parseInt(localStorage.getItem('mosque-app-font-index'), 10);
        if (!isNaN(savedFontIndex) && savedFontIndex >= 0 && savedFontIndex < FONT_SCALE_STEPS.length) {
            fontScaleIndex = savedFontIndex;
        }
        applyFontScale();

        const savedReduceMotion = localStorage.getItem('mosque-app-reduce-motion') === '1';
        document.documentElement.setAttribute('data-reduce-motion', savedReduceMotion ? 'true' : 'false');
        document.querySelectorAll('[data-reduce-motion-toggle]').forEach(el => { el.checked = savedReduceMotion; });
    } catch (e) {
        applyTheme('light');
        applyFontScale();
    }
}
