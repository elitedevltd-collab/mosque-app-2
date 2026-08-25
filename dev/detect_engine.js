// ===== محرك كشف الآيات والأحاديث الجديد (نموذج أولي للاختبار في Node) =====
// الفكرة: مطابقة على مستوى الكلمات بدل substring صارم
// 1. فهرس عكسي bigram (كل كلمتين متتاليتين) → قائمة الآيات/الأحاديث التي تحتويهما
// 2. مسح كلام الخطيب بنافذة منزلقة، وإيجاد أفضل محاذاة مع سماحية أخطاء التعرف الصوتي
// 3. دمج الآيات المتتالية من نفس السورة في نطاق واحد

const fs = require('fs');

// ---- التطبيع المحسّن (يعالج الرسم العثماني) ----
function normalizeArabic(text) {
    return (text || '')
        // علامات الوقف القرآنية والرموز الخاصة
        .replace(/[\u06D6-\u06ED\u08D3-\u08E1\u08E3-\u08FF]/g, '')
        // السكون العثماني الصغير ۡ والحروف الصغيرة العلوية
        .replace(/[\u06E1\u06E2\u06E3\u06E4\u06E5\u06E6\u06E7\u06E8]/g, '')
        // الألف الخنجرية ٰ بعد ى أو ي: تُحذف (تولّىٰ → تولى → تولي)
        .replace(/([\u0649\u064A])\u0670/g, '$1')
        // الألف الخنجرية في وسط الكلمة: تصبح ألفاً كاملة لأنها تُنطق ألفاً
        // (للإنسٰن → للانسان، إبرٰهيم → ابراهيم، أبوٰب → ابواب، خٰلدين → خالدين)
        // استثناء: كلمات مثل الرحمٰن وإلٰه ولٰكن تُكتب إملائياً بدون ألف — نعالجها كمرادفات بعد التطبيع
        .replace(/\u0670/g, 'ا')
        // مرادفات إملائية شائعة: التعرف الصوتي يكتبها بلا ألف وسطية
        .replace(/الرحمان/g, 'الرحمن')
        .replace(/الاه/g, 'اله')
        // بقية التشكيل
        .replace(/[\u064B-\u065F\u0610-\u061A]/g, '')
        .replace(/\u0640/g, '') // التطويل
        // علامات الترقيم
        .replace(/[،؛؟.!«»"'()\[\]{}:۔–—\-\u200f\u200e\u202a-\u202e]/g, ' ')
        // الهمزة على السطر داخل كلمة: ءَيۡ → اي (أَفَرَءَيۡتَ → افرايت)، ءَا → ا (ءَامَنُوا → امنوا)
        .replace(/\u0621/g, 'ا')
        // توحيد صور الألف والهمزات
        .replace(/[إأآاٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        // ألفان متتاليتان نتجتا عن التطبيع → واحدة
        .replace(/اا+/g, 'ا')
        // نداء يا أيها موصولة/مفصولة
        .replace(/يا\s+اي/g, 'يااي')
        .replace(/\s+/g, ' ')
        .trim();
}

// تقسيم لكلمات مع استبعاد كلمات قصيرة جداً لا تفيد الفهرسة (حرف واحد)
function tokenize(normText) {
    return normText.split(' ').filter(w => w.length >= 2);
}

// ---- بناء الفهرس العكسي ----
// bigramIndex: Map<"كلمة1 كلمة2", Set<verseIdx>>
function buildIndex(entries) {
    const index = new Map();
    entries.forEach((e, idx) => {
        const words = e.words;
        for (let i = 0; i < words.length - 1; i++) {
            const bg = words[i] + ' ' + words[i + 1];
            let set = index.get(bg);
            if (!set) { set = []; index.set(bg, set); }
            if (set[set.length - 1] !== idx) set.push(idx);
        }
    });
    return index;
}

// ---- محاذاة كلمات المتحدث مع كلمات آية/حديث مع سماحية ----
// نحسب: أطول امتداد محاذاة يبدأ من (si, vi) مع السماح بعدد أخطاء متناسب
// خطأ = كلمة مستبدلة (سمعها الميكروفون غلط) أو كلمة محذوفة/مضافة من أحد الجانبين
function alignSpan(spokenWords, si, entryWords, vi, maxErrRatio) {
    let matched = 0, errors = 0;
    let i = si, j = vi;
    let lastMatchI = si - 1, lastMatchJ = vi - 1;
    while (i < spokenWords.length && j < entryWords.length) {
        if (spokenWords[i] === entryWords[j]) {
            matched++; lastMatchI = i; lastMatchJ = j; i++; j++;
        } else if (similar(spokenWords[i], entryWords[j])) {
            // كلمة مشابهة (خطأ تعرف صوتي بسيط) — نحسبها نصف تطابق
            matched += 0.75; errors += 0.25; lastMatchI = i; lastMatchJ = j; i++; j++;
        } else {
            // نجرب تخطي كلمة من المتحدث، أو من الآية، أو من الاثنين
            if (i + 1 < spokenWords.length && spokenWords[i + 1] === entryWords[j]) { errors++; i++; }
            else if (j + 1 < entryWords.length && spokenWords[i] === entryWords[j + 1]) { errors++; j++; }
            else if (i + 1 < spokenWords.length && j + 1 < entryWords.length && spokenWords[i + 1] === entryWords[j + 1]) { errors++; i++; j++; }
            else break;
        }
        // لو الأخطاء عدّت النسبة المسموحة، نقف
        if (errors > Math.max(2, (matched + errors) * maxErrRatio)) break;
    }
    return { matched, errors, spokenEnd: lastMatchI, entryEnd: lastMatchJ };
}

// تشابه كلمتين: نفس الجذر تقريباً (فرق حرف أو حرفين في كلمة طويلة)
function similar(a, b) {
    if (Math.abs(a.length - b.length) > 2) return false;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (shorter.length < 3) return false;
    // إحدى الكلمتين تحتوي الأخرى (قطع/انقطع، يري/يراه)
    if (longer.includes(shorter)) return true;
    // مسافة تحرير مبسطة (حد أقصى 2 للكلمات >= 5 حروف، 1 لغير ذلك)
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
            rowMin = Math.min(rowMin, cur[j]);
        }
        if (rowMin > k) return false;
        prev = cur;
    }
    return prev[n] <= k;
}

// ---- المحرك الرئيسي: كشف كل الاقتباسات في نص خطبة ----
// entries: [{words, ...meta}], index: bigram index
// إرجاع: قائمة تطابقات مع مواضعها في كلام المتحدث
function detectQuotes(spokenText, entries, index, opts) {
    const { minWords = 4, maxErrRatio = 0.34, minCoverage = 0 } = opts || {};
    const spokenWords = tokenize(normalizeArabic(spokenText));
    const results = [];
    let si = 0;
    while (si < spokenWords.length - 1) {
        const bg = spokenWords[si] + ' ' + spokenWords[si + 1];
        const candidates = index.get(bg);
        let best = null;
        if (candidates) {
            for (const idx of candidates) {
                const e = entries[idx];
                // جرّب المحاذاة من كل مواضع الـ bigram داخل هذا المدخل
                for (let j = 0; j < e.words.length - 1; j++) {
                    if (e.words[j] !== spokenWords[si] || e.words[j + 1] !== spokenWords[si + 1]) continue;
                    const span = alignSpan(spokenWords, si, e.words, j, maxErrRatio);
                    // الآيات القصيرة (أقل من minWords كلمات كلها): نقبلها لو تغطت بالكامل تقريباً
                    const effMinWords = Math.min(minWords, Math.max(2.5, e.words.length * 0.8));
                    if (span.matched >= effMinWords) {
                        const coverage = span.matched / e.words.length;
                        if (coverage >= minCoverage) {
                            const score = span.matched - span.errors * 0.5;
                            if (!best || score > best.score) {
                                best = { entryIdx: idx, score, span, startWord: si, entryStart: j, coverage };
                            }
                        }
                    }
                }
            }
        }
        if (best) {
            results.push(best);
            si = best.span.spokenEnd + 1; // نكمل بعد نهاية التطابق
        } else {
            si++;
        }
    }
    return results;
}

// إعادة ترجيح السياق: لو تطابقٌ ما له بديل مكافئ في سورة يقرأ منها الخطيب حالياً (آية متكررة النص في أكثر من سورة،
// مثل "ولا تزر وازرة وزر أخرى" في فاطر/النجم/الإسراء...) — نختار النسخة التي تواصل سياق التلاوة الجارية
function preferContextualVerses(matches, verses) {
    return matches.map((m, k) => {
        const v = verses[m.entryIdx];
        const prev = k > 0 ? verses[matches[k - 1].entryIdx] : null;
        const next = k < matches.length - 1 ? verses[matches[k + 1].entryIdx] : null;
        const fitsContext = (x) => (prev && x.s === prev.s && x.a > prev.a && x.a - prev.a <= 4) || (next && x.s === next.s && x.a < next.a && next.a - x.a <= 4);
        if (fitsContext(v)) return m;
        // هل توجد آية أخرى بنفس النص تقريباً تناسب السياق؟
        const alt = verses.findIndex((x, xi) => xi !== m.entryIdx && fitsContext(x) && overlapWords(x.words, v.words) >= Math.min(x.words.length, v.words.length) * 0.7);
        if (alt >= 0) return { ...m, entryIdx: alt };
        return m;
    });
}
function overlapWords(a, b) {
    const setB = new Set(b);
    let n = 0;
    for (const w of a) if (setB.has(w)) n++;
    return n;
}

// إزالة عبارات الإسناد الشائعة قبل مطابقة الأحاديث — حتى لا يطابق الإسناد وحده حديثاً كاملاً
// (مثل "قال رسول الله صلى الله عليه وسلم" — 7 كلمات موجودة حرفياً في آلاف الأحاديث)
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

// تمديد النطاق للخلف: لو التلاوة اكتُشفت من الآية 34 مثلاً، نفحص هل الآية 33 أيضاً منطوقة قبلها مباشرة
// (أول bigram فيها قد يختلف بسبب خطأ تعرف صوتي مثل "فرأيت" بدل "أفرأيت" فيفلت من الفهرس)
function extendRangesBackward(matches, verses, spokenWords, versesBySurahAyah) {
    for (const m of matches) {
        let v = verses[m.entryIdx];
        while (m.startWord > 0 && v.a > 1) {
            const prevVerse = versesBySurahAyah.get(v.s + ':' + (v.a - 1));
            if (!prevVerse) break;
            const pw = prevVerse.words;
            const from = Math.max(0, m.startWord - pw.length - 2);
            const windowWords = spokenWords.slice(from, m.startWord);
            let matched = 0;
            for (const w of pw) if (windowWords.some(x => x === w || similar(x, w))) matched++;
            if (matched >= Math.max(2, pw.length * 0.6)) {
                m.extraFromAyah = prevVerse.a;
                m.startWord = from;
                v = prevVerse;
            } else break;
        }
    }
    return matches;
}

// ---- دمج الآيات المتتالية في نطاقات ----
function mergeVerseRanges(matches, verses) {
    if (!matches.length) return [];
    const sorted = matches.slice().sort((a, b) => a.startWord - b.startWord);
    const ranges = [];
    for (const m of sorted) {
        const v = verses[m.entryIdx];
        const fromAyah = m.extraFromAyah != null ? Math.min(m.extraFromAyah, v.a) : v.a;
        const last = ranges[ranges.length - 1];
        if (last && last.surah === v.s && fromAyah >= last.ayahFrom && fromAyah <= last.ayahTo + 3) {
            last.ayahTo = Math.max(last.ayahTo, v.a);
            last.matches.push(m);
        } else {
            ranges.push({ surah: v.s, ayahFrom: fromAyah, ayahTo: v.a, matches: [m] });
        }
    }
    return ranges;
}

// ===== الاختبار =====
function main() {
    console.log('تحميل قواعد البيانات...');
    const qData = JSON.parse(fs.readFileSync('/home/ubuntu/mosque-app/quran-data.json', 'utf8'));
    const hData = JSON.parse(fs.readFileSync('/home/ubuntu/mosque-app/hadith-data.json', 'utf8'));

    const t0 = Date.now();
    const verses = qData.verses.map(v => ({ ...v, words: tokenize(normalizeArabic(v.ar)) }));
    const qIndex = buildIndex(verses);
    const versesBySurahAyah = new Map(verses.map(v => [v.s + ':' + v.a, v]));
    const hadiths = hData.map(h => ({ ...h, words: tokenize(normalizeArabic(h.a)) }));
    const hIndex = buildIndex(hadiths);
    console.log('بناء الفهارس:', Date.now() - t0, 'ms | آيات:', verses.length, '| أحاديث:', hadiths.length, '| bigrams قرآن:', qIndex.size, '| bigrams حديث:', hIndex.size);

    const testCases = [
        { name: 'حالة 1: حديث انقطع عمله (بأخطاء صوتية)', text: 'وقال صلى الله عليه وسلم إذا مات الإنسان قطع عمله إلا من ثلاث صدقة جارية أو علم ينتفع به ولد صالح يدعو له الإسلام إلا سماء بنيان أركان ايه الشهادة والصلاة والزكاة والصيام وحج بيت الله الحرام' },
        { name: 'حالة 2: النحل 26-27 وسط كلام', text: 'ومن منه العمل أقام على حيضان ايه فخر عليه فخر عليهم السقف من فوقهم واتهم العذاب من حيث لا يشعرون ثم يوم القيامة يخزيهم ويقول أين شرك الذين كنتم تشاون فيهم قال الذين اوتوا العلم إن الخزي اليوم والسوء على الكافرين' },
        { name: 'حالة 3: النحل 28-29', text: 'الذين تتوفهم الملائكة ظالمين أنفسهم فالقوا ما كنا نعمل من سوء بلا إن الله عليم بما كنا يعملون فدخلوا أبواب جهنم خالدين فيها المتكبرين ولا تكون النجاة من الخسران' },
        { name: 'حالة 4: النجم 33-42 تلاوة متتالية', text: 'فرأيت الذي تولى وأعطى قليلا وأبدي أعين عنده علم الغيب فهو يراه أم لم ينبئ بما في صحفي موسى وإبراهيم الذي وفى أن لا تزر وازرة وزراء أخرى وأن ليس للإنسان إلا ما سعي وأن سعيه سوف يرى ثم يجزاه الجزاء الوفاء وأن إلى ربك المنتهى' },
        { name: 'حالة 5: الكهف 107-108', text: 'الحمد لله رب العالمين والعاقبة للمتقين والصلاة والسلام على سيدنا محمد وعلى آله وصحبه أجمعين أما بعد فتق الله عباد الله وكونوا مع الصادقين واعلم أن الله تبارك وتعالى إن الذين آمنوا وعملوا الصالحات كانت لهم جنات الفردوس نزلا خالدين فيها لا يبغون عنها' },
        { name: 'سلبية: إسناد فقط', text: 'قال رسول الله صلى الله عليه وسلم' },
        { name: 'سلبية: كلام وعظي عام', text: 'أيها الإخوة الكرام علينا أن نتقي الله في أعمالنا وأن نحرص على الصلاة في جماعة وأن نكثر من ذكر الله' },
        { name: 'مختلطة: آيات من سور مختلفة كأمثلة', text: 'ومن الآيات التي تحث على الصبر قوله تعالى إن مع العسر يسرا وقوله سبحانه واصبر وما صبرك إلا بالله وقوله يا أيها الذين آمنوا استعينوا بالصبر والصلاة' },
    ];

    for (const tc of testCases) {
        console.log('\n========== ' + tc.name + ' ==========');
        const t1 = Date.now();
        let qMatches = detectQuotes(tc.text, verses, qIndex, { minWords: 3.5, maxErrRatio: 0.34 });
        qMatches = preferContextualVerses(qMatches, verses);
        qMatches = extendRangesBackward(qMatches, verses, tokenize(normalizeArabic(tc.text)), versesBySurahAyah);
        const ranges = mergeVerseRanges(qMatches, verses);
        for (const r of ranges) {
            const sName = qData.surahs[r.surah] ? qData.surahs[r.surah].ar : r.surah;
            const label = r.ayahFrom === r.ayahTo ? `${sName}:${r.ayahFrom}` : `${sName}:${r.ayahFrom}-${r.ayahTo}`;
            const totScore = r.matches.reduce((s, m) => s + m.score, 0).toFixed(1);
            console.log(`  📖 ${label} (نقاط ${totScore})`);
        }
        // للأحاديث: نزيل الإسناد من كلام الخطيب أولاً ثم نطابق — وندمج التطابقات المتداخلة لنفس الحديث
        const strippedText = stripIsnadNorm(normalizeArabic(tc.text));
        const hMatches = detectQuotes(strippedText, hadiths, hIndex, { minWords: 5, maxErrRatio: 0.34 });
        const seenHadith = new Set();
        for (const m of hMatches) {
            const h = hadiths[m.entryIdx];
            const hKey = h.bn + '#' + h.i;
            if (seenHadith.has(hKey)) continue;
            seenHadith.add(hKey);
            console.log(`  ✨ ${h.bn} #${h.i} (نقاط ${m.score.toFixed(1)}, كلمات ${m.span.matched})`);
        }
        if (!ranges.length && !hMatches.length) console.log('  (لا شيء)');
        console.log('  زمن الكشف:', Date.now() - t1, 'ms');
    }
}

main();
