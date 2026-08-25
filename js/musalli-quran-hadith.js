/* ============================================================================
   بوابة المصلّي — محرك كشف الآيات/الأحاديث + قاعدة البيانات المحلية + البحث
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

// ===== قاعدة بيانات القرآن والحديث المحلية (بدون أي API خارجي) =====
let quranVerses = [];
let quranSurahs = {};
let hadithEntries = [];
let quranBigramIndex = null;
let hadithBigramIndex = null;
let versesBySurahAyah = null;
let localDbReady = false;

// ===== محرك الكشف: مطابقة على مستوى الكلمات مع سماحية أخطاء التعرف الصوتي =====
// إزالة التشكيل وتوحيد صور الحروف حتى يتطابق النص المسموع (إملائي بلا تشكيل) مع نص المصحف (رسم عثماني كامل التشكيل)
// ملاحظة: كل نطاقات \uXXXX هنا مطابقة حرفيًا للنسخة الأصلية المُختبرة — لا تُستبدل بمحارف عربية حرفية
// لتفادي أي التباس مع محارف التحكم بالاتجاه (RTL/LTR marks) غير المرئية.
function normalizeArabic(text) {
    return (text || '')
        .replace(/[ۖ-ۭ࣓-ࣣ࣡-ࣿ]/g, '') // علامات الوقف القرآنية والرموز العلوية الخاصة
        .replace(/([ىي])ٰ/g, '$1') // الألف الخنجرية بعد ى/ي تُحذف (تولّىٰ → تولى)
        .replace(/ٰ/g, 'ا') // الألف الخنجرية الوسطية تُنطق ألفًا (للإنسٰن → للانسان، خٰلدين → خالدين)
        .replace(/الرحمان/g, 'الرحمن').replace(/الاه/g, 'اله') // مرادفات إملائية: التعرف الصوتي يكتبها بلا ألف وسطية
        .replace(/[ً-ٟؐ-ؚ]/g, '') // بقية علامات التشكيل
        .replace(/ـ/g, '') // التطويل
        .replace(/[،؛؟.!«»"'()\[\]{}:۔–—\-‏‎‪-‮﴾﴿۞]/g, ' ') // علامات الترقيم ومحارف الاتجاه الخفية
        .replace(/ء/g, 'ا') // الهمزة على السطر: أَفَرَءَيۡتَ → افرايت، ءامنوا → اامنوا (تُدمج لاحقًا)
        .replace(/[إأآاٱ]/g, 'ا') // توحيد كل صور الألف (بما فيها ألف الوصل ٱ)
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/اا+/g, 'ا') // ألفان متتاليتان نتجتا عن التطبيع → واحدة
        .replace(/يا\s+اي/g, 'يااي') // نداء "يا أيها" موصولة/مفصولة
        .replace(/\s+/g, ' ')
        .trim();
}

// تقسيم النص المطبّع لكلمات (نتجاهل كلمات الحرف الواحد)
function tokenizeWords(normText) {
    return normText.split(' ').filter(function(w) { return w.length >= 2; });
}

// فهرس عكسي: كل كلمتين متتاليتين (bigram) ← قائمة الآيات/الأحاديث التي تحتويهما — يجعل الكشف فوريًا (مللي ثوانٍ)
function buildBigramIndex(entries) {
    const index = new Map();
    entries.forEach(function(e, idx) {
        const words = e.words;
        for (let i = 0; i < words.length - 1; i++) {
            const bg = words[i] + ' ' + words[i + 1];
            let list = index.get(bg);
            if (!list) { list = []; index.set(bg, list); }
            if (list[list.length - 1] !== idx) list.push(idx);
        }
    });
    return index;
}

async function loadLocalDatabases() {
    const statusEl = document.getElementById('db-status');
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '⏳ جارٍ تحميل قاعدة بيانات القرآن والحديث محليًا (~24 ميجابايت، مرة واحدة فقط)...'; statusEl.style.color = 'var(--color-text-faint)'; }
    try {
        const [qRes, hRes] = await Promise.all([
            fetch('./quran-data.json'),
            fetch('./hadith-data.json')
        ]);
        const qData = await qRes.json();
        const hData = await hRes.json();

        quranSurahs = qData.surahs;
        quranVerses = qData.verses.map(v => { const norm = normalizeArabic(v.ar); return { ...v, norm, words: tokenizeWords(norm) }; });
        hadithEntries = hData.map(h => { const norm = normalizeArabic(h.a); return { ...h, norm, words: tokenizeWords(norm) }; });
        quranBigramIndex = buildBigramIndex(quranVerses);
        hadithBigramIndex = buildBigramIndex(hadithEntries);
        versesBySurahAyah = new Map(quranVerses.map(v => [v.s + ':' + v.a, v]));

        localDbReady = true;
        showVerseOfTheDay();
        showHadithOfDay();
        if (statusEl) {
            statusEl.textContent = '✅ قاعدة القرآن والحديث جاهزة محليًا — بحث بدون إنترنت';
            statusEl.style.color = 'var(--color-success)';
            setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
        }
    } catch (e) {
        console.error('Local DB load failed', e);
        if (statusEl) {
            statusEl.textContent = '⚠️ تعذّر تحميل قاعدة البيانات المحلية — تأكد أن ملفي quran-data.json و hadith-data.json بجانب هذا الملف';
            statusEl.style.color = 'var(--color-danger)';
        }
    }
}

// 🌟 البحث القرآني — محليًا بالكامل، بدون أي اتصال خارجي
async function searchQuranLibrary() {
    const rawInput = document.getElementById('quran-search-input').value.trim();
    const resBox = document.getElementById('quran-search-result');
    const loadingBox = document.getElementById('quran-loading');

    if(!rawInput) {
        resBox.innerHTML = "⚠️ الرجاء إدخال كلمة أو آية للبحث.";
        resBox.classList.add('active');
        return;
    }
    if (!localDbReady) {
        resBox.innerHTML = "⏳ قاعدة البيانات المحلية لسه بتحمّل، حاول بعد لحظات.";
        resBox.classList.add('active');
        return;
    }

    loadingBox.classList.add('active');
    resBox.classList.remove('active');
    resBox.innerHTML = "";

    const norm = normalizeArabic(rawInput);
    const matches = quranVerses.filter(v => v.norm.includes(norm)).slice(0, 20);

    if (matches.length > 0) {
        let resultsHTML = `<div class="result-count">✅ وجدنا ${matches.length} نتيجة</div>`;
        matches.forEach((m) => {
            const surahName = (quranSurahs[m.s] && quranSurahs[m.s].ar) || '';
            resultsHTML += `
                <div class="result-item">
                    <div class="result-text">﴿ ${m.ar} ﴾</div>
                    <div class="result-source">📖 سورة ${surahName} - الآية ${m.a}</div>
                </div>
            `;
        });
        resBox.innerHTML = resultsHTML;
    } else {
        resBox.innerHTML = "ℹ️ لم نجد نتائج دقيقة. جرب كتابة كلمة أو عبارة عربية أخرى.";
    }
    resBox.classList.add('active');
    loadingBox.classList.remove('active');
}

// 🌟 البحث في الأحاديث — محليًا بالكامل (صحيح البخاري ومسلم)، بدون أي اتصال خارجي
async function searchHadithLibrary() {
    const rawInput = document.getElementById('hadith-search-input').value.trim();
    const resBox = document.getElementById('hadith-search-result');
    const loadingBox = document.getElementById('hadith-loading');

    if(!rawInput) {
        resBox.innerHTML = "⚠️ الرجاء إدخال كلمة أو جملة للبحث.";
        resBox.classList.add('active');
        return;
    }
    if (!localDbReady) {
        resBox.innerHTML = "⏳ قاعدة البيانات المحلية لسه بتحمّل، حاول بعد لحظات.";
        resBox.classList.add('active');
        return;
    }

    loadingBox.classList.add('active');
    resBox.classList.remove('active');
    resBox.innerHTML = "";

    const norm = normalizeArabic(rawInput);
    const matches = hadithEntries.filter(h => h.norm.includes(norm)).slice(0, 20);

    if (matches.length > 0) {
        let resultsHTML = `<div class="result-count">✅ وجدنا ${matches.length} حديث</div>`;
        matches.forEach((h) => {
            resultsHTML += `
                <div class="result-item">
                    <div class="result-text">« ${h.a} »</div>
                    <div class="result-source">📜 ${h.bn} — حديث رقم ${h.i}</div>
                </div>
            `;
        });
        resBox.innerHTML = resultsHTML;
    } else {
        resBox.innerHTML = "ℹ️ لم نجد أحاديث مطابقة. جرب كلمة عربية أقصر أو أدق.";
    }
    resBox.classList.add('active');
    loadingBox.classList.remove('active');
}

// تشابه كلمتين (خطأ تعرف صوتي بسيط): احتواء أو مسافة تحرير ≤ 2 للكلمات الطويلة
function wordsSimilar(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 2) return false;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (shorter.length < 3) return false;
    if (longer.includes(shorter)) return true; // قطع/انقطع، يري/يراه
    const maxDist = longer.length >= 5 ? 2 : 1;
    return editDistanceAtMost(a, b, maxDist);
}
function editDistanceAtMost(a, b, k) {
    if (Math.abs(a.length - b.length) > k) return false;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > k) return false;
        prev = cur;
    }
    return prev[n] <= k;
}

// محاذاة كلمات الخطيب مع كلمات آية/حديث بدءًا من موضع معين، مع سماحية أخطاء متناسبة
function alignSpan(spokenWords, si, entryWords, vi, maxErrRatio) {
    let matched = 0, errors = 0;
    let i = si, j = vi;
    let lastMatchI = si - 1, lastMatchJ = vi - 1;
    while (i < spokenWords.length && j < entryWords.length) {
        if (spokenWords[i] === entryWords[j]) {
            matched++; lastMatchI = i; lastMatchJ = j; i++; j++;
        } else if (wordsSimilar(spokenWords[i], entryWords[j])) {
            matched += 0.75; errors += 0.25; lastMatchI = i; lastMatchJ = j; i++; j++;
        } else if (i + 1 < spokenWords.length && spokenWords[i + 1] === entryWords[j]) { errors++; i++; }
        else if (j + 1 < entryWords.length && spokenWords[i] === entryWords[j + 1]) { errors++; j++; }
        else if (i + 1 < spokenWords.length && j + 1 < entryWords.length && spokenWords[i + 1] === entryWords[j + 1]) { errors++; i++; j++; }
        else break;
        if (errors > Math.max(2, (matched + errors) * maxErrRatio)) break;
    }
    return { matched, errors, spokenEnd: lastMatchI, entryEnd: lastMatchJ };
}

// المسح الرئيسي: نافذة منزلقة على كلمات الخطيب — كل كلمتين متتاليتين تُبحثان في الفهرس،
// وأفضل محاذاة تُسجّل ثم نواصل المسح بعد نهايتها (فيكتشف عدة اقتباسات متتالية)
function detectQuotes(spokenWords, entries, index, opts) {
    const minWords = opts.minWords, maxErrRatio = opts.maxErrRatio || 0.34;
    const results = [];
    let si = 0;
    while (si < spokenWords.length - 1) {
        const bg = spokenWords[si] + ' ' + spokenWords[si + 1];
        const candidates = index.get(bg);
        let best = null;
        if (candidates) {
            for (const idx of candidates) {
                const e = entries[idx];
                for (let j = 0; j < e.words.length - 1; j++) {
                    if (e.words[j] !== spokenWords[si] || e.words[j + 1] !== spokenWords[si + 1]) continue;
                    const span = alignSpan(spokenWords, si, e.words, j, maxErrRatio);
                    // الآيات القصيرة: نقبلها لو تغطت بالكامل تقريبًا (80%+ من كلماتها)
                    const effMinWords = Math.min(minWords, Math.max(2.5, e.words.length * 0.8));
                    if (span.matched >= effMinWords) {
                        const score = span.matched - span.errors * 0.5;
                        if (!best || score > best.score) best = { entryIdx: idx, score, span, startWord: si, entryStart: j };
                    }
                }
            }
        }
        if (best) { results.push(best); si = best.span.spokenEnd + 1; }
        else si++;
    }
    return results;
}

// ترجيح السياق: آية متكررة النص في أكثر من سورة (مثل "ولا تزر وازرة...") — نختار النسخة التي تواصل سياق التلاوة الجارية
function preferContextualVerses(matches) {
    return matches.map(function(m, k) {
        const v = quranVerses[m.entryIdx];
        const prev = k > 0 ? quranVerses[matches[k - 1].entryIdx] : null;
        const next = k < matches.length - 1 ? quranVerses[matches[k + 1].entryIdx] : null;
        const fitsContext = function(x) { return (prev && x.s === prev.s && x.a > prev.a && x.a - prev.a <= 4) || (next && x.s === next.s && x.a < next.a && next.a - x.a <= 4); };
        if (fitsContext(v)) return m;
        const vSet = new Set(v.words);
        for (let xi = 0; xi < quranVerses.length; xi++) {
            if (xi === m.entryIdx) continue;
            const x = quranVerses[xi];
            if (!fitsContext(x)) continue;
            let n = 0; for (const w of x.words) if (vSet.has(w)) n++;
            if (n >= Math.min(x.words.length, v.words.length) * 0.7) return { ...m, entryIdx: xi };
        }
        return m;
    });
}

// تمديد النطاق للخلف: لو التلاوة اكتُشفت من الآية 34، نفحص هل الآية 33 منطوقة قبلها أيضًا
// (أول كلمتين فيها قد تختلفان بسبب خطأ تعرف صوتي مثل "فرأيت" بدل "أفرأيت" فتفلت من الفهرس)
function extendRangesBackward(matches, spokenWords) {
    for (const m of matches) {
        let v = quranVerses[m.entryIdx];
        while (m.startWord > 0 && v.a > 1) {
            const prevVerse = versesBySurahAyah.get(v.s + ':' + (v.a - 1));
            if (!prevVerse) break;
            const pw = prevVerse.words;
            const from = Math.max(0, m.startWord - pw.length - 2);
            const windowWords = spokenWords.slice(from, m.startWord);
            let matched = 0;
            for (const w of pw) if (windowWords.some(function(x) { return x === w || wordsSimilar(x, w); })) matched++;
            if (matched >= Math.max(2, pw.length * 0.6)) { m.extraFromAyah = prevVerse.a; m.startWord = from; v = prevVerse; }
            else break;
        }
    }
    return matches;
}

// دمج الآيات المتتالية من نفس السورة في نطاق واحد (النجم 33-42 بطاقة واحدة بدل 10 بطاقات)
function mergeVerseRanges(matches) {
    if (!matches.length) return [];
    const sorted = matches.slice().sort(function(a, b) { return a.startWord - b.startWord; });
    const ranges = [];
    for (const m of sorted) {
        const v = quranVerses[m.entryIdx];
        const fromAyah = m.extraFromAyah != null ? Math.min(m.extraFromAyah, v.a) : v.a;
        const last = ranges[ranges.length - 1];
        if (last && last.surah === v.s && fromAyah >= last.ayahFrom && fromAyah <= last.ayahTo + 3) {
            last.ayahTo = Math.max(last.ayahTo, v.a);
        } else {
            ranges.push({ surah: v.s, ayahFrom: fromAyah, ayahTo: v.a });
        }
    }
    return ranges;
}

// إزالة عبارات الإسناد المطبّعة قبل مطابقة الأحاديث — حتى لا يطابق الإسناد وحده حديثًا كاملًا
const ISNAD_PHRASES_NORM = [
    'قال رسول الله صلي الله عليه وسلم', 'قال النبي صلي الله عليه وسلم',
    'رسول الله صلي الله عليه وسلم', 'صلي الله عليه وسلم',
    'رضي الله عنهما', 'رضي الله عنها', 'رضي الله عنهم', 'رضي الله عنه'
];
function stripIsnadNorm(normText) {
    let out = ' ' + normText + ' ';
    for (const p of ISNAD_PHRASES_NORM) out = out.split(' ' + p + ' ').join(' ');
    return out.replace(/\s+/g, ' ').trim();
}

// ذاكرة الجلسة: ما عُرض بالفعل خلال الخطبة الحالية
const shownQuranRanges = new Map(); // surah -> {ayahFrom, ayahTo, el}
const shownHadiths = new Set();     // "collection#id"

async function detectAndLogQuranHadith(text, targetLang) {
    if (!localDbReady) return;
    const spokenWords = tokenizeWords(normalizeArabic(text));
    if (spokenWords.length < 2) return;

    // ---- القرآن: مسح + ترجيح سياقي + تمديد للخلف + دمج نطاقات ----
    let qMatches = detectQuotes(spokenWords, quranVerses, quranBigramIndex, { minWords: 3.5, maxErrRatio: 0.34 });
    qMatches = preferContextualVerses(qMatches);
    qMatches = extendRangesBackward(qMatches, spokenWords);
    const ranges = mergeVerseRanges(qMatches);

    // ---- الحديث: نزيل الإسناد من كلام الخطيب ثم نطابق ----
    const strippedWords = tokenizeWords(stripIsnadNorm(normalizeArabic(text)));
    const hMatches = detectQuotes(strippedWords, hadithEntries, hadithBigramIndex, { minWords: 5, maxErrRatio: 0.34 });

    const tasks = [];

    for (const r of ranges) {
        const existing = shownQuranRanges.get(r.surah);
        if (existing && r.ayahFrom >= existing.ayahFrom - 3 && r.ayahFrom <= existing.ayahTo + 3) {
            const newFrom = Math.min(existing.ayahFrom, r.ayahFrom);
            const newTo = Math.max(existing.ayahTo, r.ayahTo);
            if (newFrom !== existing.ayahFrom || newTo !== existing.ayahTo) {
                existing.ayahFrom = newFrom; existing.ayahTo = newTo;
                tasks.push(renderQuranRange(r.surah, newFrom, newTo, targetLang, existing));
            }
        } else {
            const state = { ayahFrom: r.ayahFrom, ayahTo: r.ayahTo, el: null };
            shownQuranRanges.set(r.surah, state);
            tasks.push(renderQuranRange(r.surah, r.ayahFrom, r.ayahTo, targetLang, state));
        }
    }

    const seenNow = new Set();
    for (const m of hMatches) {
        const h = hadithEntries[m.entryIdx];
        const hKey = h.bn + '#' + h.i;
        if (shownHadiths.has(hKey) || seenNow.has(hKey)) continue;
        seenNow.add(hKey); shownHadiths.add(hKey);
        tasks.push(renderHadith(h, targetLang));
    }

    await Promise.all(tasks);
}

// يعرض (أو يحدّث) بطاقة نطاق آيات: آية واحدة أو تلاوة متتالية في بطاقة واحدة مرتبة
async function renderQuranRange(surah, ayahFrom, ayahTo, targetLang, state) {
    try {
        const surahName = (quranSurahs[surah] && quranSurahs[surah].ar) || '';
        const versesInRange = [];
        for (let a = ayahFrom; a <= ayahTo; a++) {
            const v = versesBySurahAyah.get(surah + ':' + a);
            if (v) versesInRange.push(v);
        }
        if (!versesInRange.length) return;

        const arabicFull = versesInRange.map(v => `${v.ar} （${v.a}）`).join(' ');
        let translated, verified;
        try {
            if (targetLang === 'en' && versesInRange.every(v => v.en)) {
                translated = versesInRange.map(v => `(${v.a}) ${v.en}`).join(' ');
                verified = true; // ترجمة معتمدة من قاعدة البيانات المحلية
            } else {
                translated = await googleTranslate(versesInRange.map(v => v.ar).join(' ● '), targetLang);
                verified = false;
            }
        } catch (e) {
            translated = '⚠️ تعذّرت الترجمة الآن (النص العربي أعلاه مؤكد وصحيح)';
            verified = false;
        }

        const sourceLabel = ayahFrom === ayahTo
            ? `سورة ${surahName} : الآية ${ayahFrom}`
            : `سورة ${surahName} : الآيات ${ayahFrom}–${ayahTo}`;
        const note = verified ? 'ترجمة معتمدة (من قاعدة البيانات المحلية)' : 'ترجمة آلية — لا نسخة معتمدة محليًا بهذه اللغة';

        if (state.el && state.el.isConnected) {
            state.el.querySelector('.qh-badge').textContent = `📖 آية قرآنية — ${sourceLabel}`;
            state.el.querySelector('.qh-arabic').textContent = `﴾ ${arabicFull} ﴿`;
            state.el.querySelector('.qh-translation').textContent = translated || '—';
            const noteEl = state.el.querySelector('.qh-note');
            if (noteEl) noteEl.textContent = note;
        } else {
            state.el = addQuranHadithEntry('quran', { arabic: arabicFull, source: sourceLabel, translated, note });
        }
    } catch (e) { console.error('Quran range render error:', e); }
}

async function renderHadith(h, targetLang) {
    try {
        let translated, verified;
        try {
            if (targetLang === 'en' && h.en) { translated = h.en; verified = true; }
            else { translated = await googleTranslate(h.a, targetLang); verified = false; }
        } catch (e) {
            translated = '⚠️ تعذّرت الترجمة الآن (النص العربي أعلاه مؤكد وصحيح)';
            verified = false;
        }
        addQuranHadithEntry('hadith', {
            arabic: h.a,
            source: `${h.bn} — حديث رقم ${h.i}`,
            translated,
            note: verified ? 'ترجمة معتمدة (من قاعدة البيانات المحلية)' : 'ترجمة آلية — يُرجى المراجعة'
        });
    } catch (e) { console.error('Hadith render error:', e); }
}

function addQuranHadithEntry(type, entry) {
    const log = document.getElementById('quran-hadith-log');
    const emptyMsg = document.getElementById('qh-empty');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'qh-item ' + type;
    const badgeLabel = type === 'quran' ? '📖 آية قرآنية' : '✨ حديث نبوي';
    // entry.source وentry.arabic وentry.note نصوص من قاعدة البيانات المحلية الموثوقة أو مبنية محليًا — آمنة كـ HTML.
    // entry.translated يأتي من خدمة ترجمة خارجية، فنكتبه كنص خام (textContent) لا HTML، تفاديًا لأي XSS.
    item.innerHTML = `
        <div class="qh-badge">${badgeLabel} — ${entry.source}</div>
        <div class="qh-arabic">﴾ ${entry.arabic} ﴿</div>
        <div class="qh-translation"></div>
        ${entry.note ? `<div class="qh-note">${entry.note}</div>` : ''}
    `;
    item.querySelector('.qh-translation').textContent = entry.translated || '—';
    log.insertBefore(item, log.firstChild);
    while (log.children.length > 10) log.removeChild(log.lastChild);
    return item;
}

function showVerseOfTheDay() {
    if (!localDbReady || quranVerses.length === 0) return;
    const v = quranVerses[Math.floor(Math.random() * quranVerses.length)];
    const surahName = (quranSurahs[v.s] && quranSurahs[v.s].ar) || '';
    document.getElementById('quran-text').innerText = `«${v.ar}»`;
    document.getElementById('quran-source').innerText = ` سورة ${surahName} - الآية ${v.a}`;
}
