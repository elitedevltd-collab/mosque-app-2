/* ============================================================================
   لوحة تحكم الإمام — المصادقة (Firebase Authentication عبر REST API)
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

/* ⚙️ إعدادات Firebase — راجع PHASE0_SETUP.md لخطوات الحصول على apiKey وإنشاء حساب الإمام.
   يجب أن تطابق databaseURL و sermonPath القيم الموجودة في musalli.html بالضبط. */
const FIREBASE_CONFIG = {
    databaseURL: "https://mosqa-app-default-rtdb.asia-southeast1.firebasedatabase.app",
    sermonPath: "sermon",
    apiKey: "REPLACE_WITH_FIREBASE_WEB_API_KEY"
};

// نخزّن حالة الدخول في sessionStorage (وليس localStorage) — تُفقد تلقائيًا عند إغلاق التبويب،
// وهذا مقصود لجهاز منبر يُستخدم من عدة أئمة أو يُترك بلا رقابة أحيانًا.
let authState = { idToken: null, refreshToken: null };

function saveAuthState() {
    try { sessionStorage.setItem('mosque-imam-auth', JSON.stringify(authState)); } catch (e) {}
}
function loadAuthState() {
    try {
        const raw = sessionStorage.getItem('mosque-imam-auth');
        if (raw) authState = JSON.parse(raw);
    } catch (e) {}
}
function clearAuthState() {
    authState = { idToken: null, refreshToken: null };
    try { sessionStorage.removeItem('mosque-imam-auth'); } catch (e) {}
}

function showLoginGate(message) {
    document.getElementById('login-gate').style.display = 'block';
    document.getElementById('app-controls').style.display = 'none';
    if (message) {
        const s = document.getElementById('login-status');
        s.textContent = message;
        s.style.color = 'var(--color-danger)';
    }
}
function showAppControls() {
    document.getElementById('login-gate').style.display = 'none';
    document.getElementById('app-controls').style.display = 'block';
    document.getElementById('login-status').textContent = '';
}

// تسجيل الدخول عبر Firebase Auth REST API (identitytoolkit) — لا حاجة لتحميل SDK فايربيز كامل
async function signIn() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const statusEl = document.getElementById('login-status');
    if (!email || !password) { statusEl.textContent = 'الرجاء إدخال البريد وكلمة المرور.'; statusEl.style.color = 'var(--color-danger)'; return; }
    if (FIREBASE_CONFIG.apiKey.includes('REPLACE_WITH')) {
        statusEl.textContent = '⚠️ لم يتم ضبط apiKey في الكود بعد — راجع PHASE0_SETUP.md';
        statusEl.style.color = 'var(--color-danger)';
        return;
    }
    btn.disabled = true; btn.textContent = 'جارٍ الدخول...';
    statusEl.textContent = '';
    try {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
        authState = { idToken: data.idToken, refreshToken: data.refreshToken };
        saveAuthState();
        document.getElementById('login-password').value = '';
        showAppControls();
        scheduleTokenRefresh();
        checkFirebaseConnection();
    } catch (e) {
        console.error('signIn failed', e);
        const friendly = /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(e.message)
            ? 'البريد أو كلمة المرور غير صحيحة.'
            : 'تعذّر تسجيل الدخول: ' + e.message;
        statusEl.textContent = friendly;
        statusEl.style.color = 'var(--color-danger)';
    } finally {
        btn.disabled = false; btn.textContent = 'دخول';
    }
}

function signOutImam() {
    clearAuthState();
    if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
    if (isRecording) stopRecording();
    showLoginGate();
}

// يجدّد idToken (صالح لمدة ساعة فقط) قبل أن ينتهي، حتى لا يفشل الإرسال بصمت في منتصف خطبة طويلة
let tokenRefreshTimer = null;
async function refreshIdToken() {
    if (!authState.refreshToken) return false;
    try {
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(authState.refreshToken)}`
        });
        const data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
        authState = { idToken: data.id_token, refreshToken: data.refresh_token };
        saveAuthState();
        document.getElementById('session-banner').style.display = 'none';
        return true;
    } catch (e) {
        console.error('refreshIdToken failed', e);
        const banner = document.getElementById('session-banner');
        banner.style.display = 'block';
        banner.textContent = '⚠️ انتهت صلاحية جلسة الدخول ولم نتمكن من تجديدها — سجّل الدخول مرة أخرى (البث الحالي قد يفشل حتى تفعل)';
        return false;
    }
}
function scheduleTokenRefresh() {
    if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
    // idToken صالح 60 دقيقة — نجدده كل 45 دقيقة لضمان عدم انتهائه أثناء خطبة طويلة
    tokenRefreshTimer = setInterval(refreshIdToken, 45 * 60 * 1000);
}

function sermonUrl() {
    const auth = authState.idToken ? `?auth=${authState.idToken}` : '';
    return `${FIREBASE_CONFIG.databaseURL}/${FIREBASE_CONFIG.sermonPath}.json${auth}`;
}

// ===== بدء التشغيل: نحاول استعادة جلسة دخول سابقة (من نفس التبويب) قبل عرض شاشة الدخول =====
async function initAuth() {
    loadAuthState();
    if (authState.refreshToken) {
        const ok = await refreshIdToken();
        if (ok) { showAppControls(); scheduleTokenRefresh(); }
        else { clearAuthState(); showLoginGate(); }
    } else {
        showLoginGate();
    }
    checkFirebaseConnection();
}
