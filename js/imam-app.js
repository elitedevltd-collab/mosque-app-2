/* ============================================================================
   لوحة تحكم الإمام — التعرف الصوتي + الإرسال لفايربيز + الحارس + قفل الشاشة
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

let recognition; let isRecording = false; let lastTimestamp = 0;
let lastEventAt = Date.now();   // آخر وقت وصلنا فيه أي حدث من محرك التعرف الصوتي (نتيجة/خطأ/نهاية)
let lastSendOkAt = 0;           // آخر وقت نجح فيه الإرسال فعليًا لفايربيز
let sendFailStreak = 0;         // عدد محاولات الإرسال الفاشلة المتتالية
let lastInterimText = '';       // آخر نص "جزئي" (لسه ماوصلش isFinal)

async function checkFirebaseConnection() {
    const statusEl = document.getElementById('fb-status');
    if (FIREBASE_CONFIG.databaseURL.includes('YOUR-PROJECT-ID')) {
        statusEl.textContent = '⚠️ لم تربط مشروع Firebase الخاص بك بعد — عدّل FIREBASE_CONFIG أعلى الكود';
        statusEl.style.color = 'var(--color-danger)';
        return;
    }
    if (isRecording && sendFailStreak > 0) return;
    try {
        const res = await fetch(sermonUrl());
        if (res.ok) {
            statusEl.textContent = '✅ متصل بقاعدة بيانات Firebase';
            statusEl.style.color = 'var(--color-success)';
        } else {
            statusEl.textContent = '⚠️ تعذّر الاتصال — تحقق من الرابط وقواعد الأمان في Firebase';
            statusEl.style.color = 'var(--color-danger)';
        }
    } catch (e) {
        statusEl.textContent = '⚠️ تعذّر الاتصال — تحقق من الرابط وقواعد الأمان في Firebase';
        statusEl.style.color = 'var(--color-danger)';
    }
}

async function sendToCloud(text) {
    if(!text.trim()) return;
    if (!authState.idToken) { showLoginGate('يجب تسجيل الدخول أولاً قبل نشر أي نص.'); return; }
    const statusEl = document.getElementById('fb-status');
    try {
        const res = await fetch(sermonUrl(), { method: 'PUT', body: JSON.stringify({ text: text, timestamp: Date.now() }) });
        if (res.status === 401 || res.status === 403) {
            const refreshed = await refreshIdToken();
            if (refreshed) return sendToCloud(text);
            throw new Error('HTTP ' + res.status + ' — الجلسة غير صالحة');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        lastSendOkAt = Date.now();
        sendFailStreak = 0;
        if (statusEl) {
            statusEl.textContent = '✅ البث يصل الآن للمصلين';
            statusEl.style.color = 'var(--color-success)';
        }
    } catch (e) {
        sendFailStreak++;
        console.error('sendToCloud failed', e);
        if (statusEl) {
            statusEl.textContent = '🔴 فشل إرسال البث! تحقق من الإنترنت أو قواعد أمان Firebase (فشل ' + sendFailStreak + ' مرة متتالية)';
            statusEl.style.color = 'var(--color-danger)';
        }
    }
}
function publishText() { const txt = document.getElementById('admin-input').value; if(!txt.trim()) return; sendToCloud(txt); }

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'ar-SA';
    recognition.onresult = function(event) {
        lastEventAt = Date.now();
        let interimTranscript = ''; let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            else interimTranscript += event.results[i][0].transcript;
        }
        document.getElementById('live-arabic').innerText = interimTranscript || finalTranscript || '...';
        if (finalTranscript.trim()) {
            sendToCloud(finalTranscript.trim());
        }
        lastInterimText = interimTranscript;
    };
    recognition.onerror = function(event) {
        lastEventAt = Date.now();
        const fatalErrors = ['not-allowed', 'audio-capture', 'service-not-allowed'];
        if (fatalErrors.includes(event.error)) {
            stopRecording();
            document.getElementById('fb-status').textContent = '⚠️ تعذّر الوصول للميكروفون: ' + event.error;
            document.getElementById('fb-status').style.color = 'var(--color-danger)';
        }
        console.log('Speech recognition event:', event.error);
    };
    recognition.onend = function() {
        lastEventAt = Date.now();
        flushPendingInterim();
        if (isRecording) {
            setTimeout(() => {
                if (!isRecording) return;
                try { recognition.start(); }
                catch (e) { setTimeout(() => { if (isRecording) { try { recognition.start(); } catch (e2) {} } }, 500); }
            }, 250);
        }
    };
}

function flushPendingInterim() {
    const pending = (lastInterimText || '').trim();
    lastInterimText = '';
    if (pending) {
        console.warn('Flushing unfinished speech before engine restart to avoid dropping words:', pending);
        sendToCloud(pending);
    }
}
function toggleVoice() { if (isRecording) stopRecording(); else startRecording(); }

// ===== قفل الشاشة (Wake Lock) =====
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (e) { console.log('Wake lock not available:', e); }
}
document.addEventListener('visibilitychange', async () => {
    if (isRecording && document.visibilityState === 'visible' && !wakeLock) {
        await requestWakeLock();
    }
});

// ===== حارس البث (Watchdog) =====
const WATCHDOG_STALL_MS = 15000;
setInterval(() => {
    if (!isRecording) return;
    const silentFor = Date.now() - lastEventAt;
    if (silentFor > WATCHDOG_STALL_MS) {
        console.warn('Watchdog: recognition stalled for', silentFor, 'ms — forcing restart');
        const statusEl = document.getElementById('fb-status');
        if (statusEl) {
            statusEl.textContent = '⚠️ توقف التعرف الصوتي فجأة — جارٍ إعادة التشغيل تلقائيًا...';
            statusEl.style.color = 'var(--color-danger)';
        }
        lastEventAt = Date.now();
        flushPendingInterim();
        try { recognition.stop(); } catch (e) {}
        setTimeout(() => { if (isRecording) { try { recognition.start(); } catch (e) {} } }, 400);
    }
}, 5000);

function startRecording() {
    if(!recognition) return;
    lastEventAt = Date.now();
    recognition.start();
    isRecording = true;
    requestWakeLock();
    document.getElementById('voice-btn').innerText = "🛑 الميكروفون يرسل البث الآن...";
    document.getElementById('voice-btn').className = "btn btn-voice recording btn-block";
}
function stopRecording() {
    if(!recognition) return;
    recognition.stop();
    isRecording = false;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.getElementById('voice-btn').innerText = "🎙️ تشغيل الميكروفون والبث الفوري";
    document.getElementById('voice-btn').className = "btn btn-voice btn-block";
}

initAuth();
setInterval(checkFirebaseConnection, 30000);
