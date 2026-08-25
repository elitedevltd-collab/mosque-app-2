/* ============================================================================
   بوابة المصلّي — خدمة الترجمة (Worker → Google → MyMemory) + ذاكرة تخزين مؤقت
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

// ذاكرة تخزين مؤقت للترجمات — لو نفس الجملة (زي آية شائعة) اتذكرت أكتر من مرة، منترجمهاش تاني
const translationCache = new Map();

async function translateViaWorker(text, targetLang) {
    if (!TRANSLATE_WORKER_URL) throw new Error('Worker not configured');
    const headers = { 'Content-Type': 'application/json' };
    if (WORKER_SHARED_SECRET) headers['X-Worker-Secret'] = WORKER_SHARED_SECRET;
    const response = await fetch(TRANSLATE_WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, targetLang })
    });
    if (!response.ok) throw new Error('Worker HTTP ' + response.status);
    const data = await response.json();
    const translated = (data && data.translated || '').trim();
    if (!translated) throw new Error('Worker returned an empty translation');
    return translated;
}

async function translateViaGoogle(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Google HTTP ' + response.status);
    const data = await response.json();
    let translated = "";
    data[0].forEach(s => { if (s[0]) translated += s[0]; });
    translated = translated.trim();
    if (!translated) throw new Error('Google returned an empty translation');
    return translated;
}

async function translateViaMyMemory(text, targetLang) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ar|${targetLang}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('MyMemory HTTP ' + response.status);
    const data = await response.json();
    const translated = (data && data.responseData && data.responseData.translatedText || '').trim();
    if (!translated) throw new Error('MyMemory returned an empty translation');
    return translated;
}

// بيجرّب خدمة، ولو فشلت ينتقل فورًا لخدمة مختلفة (مش نفس الخدمة تاني) — لو الخدمة الأساسية واقعة
// فعلاً (مش عطل عابر)، إعادة المحاولة عليها هي بتضاعف تأخير الترجمة اللي المصلي حاسس بيه من غير فايدة.
// بنرجع نجرب الخدمة الأولى تاني في الآخر فقط كفرصة أخيرة لو كل البدائل فشلت.
async function googleTranslate(text, targetLang) {
    const cacheKey = `${targetLang}::${text}`;
    if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

    const providers = TRANSLATE_WORKER_URL
        ? [translateViaWorker, translateViaGoogle, translateViaMyMemory, translateViaWorker]
        : [translateViaGoogle, translateViaMyMemory, translateViaGoogle];
    let lastError;
    for (const provider of providers) {
        try {
            const translated = await provider(text, targetLang);
            translationCache.set(cacheKey, translated);
            return translated;
        } catch (e) {
            lastError = e;
            await new Promise(r => setTimeout(r, 200));
        }
    }
    throw lastError;
}

// معرّف الطلب الحالي — يمنع استجابة قديمة بطيئة من الكتابة فوق نتيجة أحدث ظهرت بالفعل
let latestRequestId = 0;

async function runTranslation(text) {
    const myRequestId = ++latestRequestId;
    const targetLang = document.getElementById('lang-select').value;
    const outputBox = document.getElementById('translation-output');

    try {
        const translated = await googleTranslate(text, targetLang);
        if (myRequestId !== latestRequestId) return;
        outputBox.innerText = translated || '—';
        outputBox.classList.remove('flash');
        void outputBox.offsetWidth; // إعادة تشغيل الأنيميشن من الصفر
        outputBox.classList.add('flash');
    } catch (e) {
        if (myRequestId === latestRequestId) outputBox.innerText = '⚠️ تعذّرت الترجمة';
    }

    // مربع القرآن والحديث مستقل تمامًا عن مربع الترجمة — لا يبطئه ولا يتأثر به
    detectAndLogQuranHadith(text, targetLang);
}
