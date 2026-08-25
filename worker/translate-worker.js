/**
 * بوابة المسجد — بروكسي ترجمة عبر Cloudflare Worker
 * ====================================================
 * هذا الملف هو كل الكود المطلوب لخدمة ترجمة موثوقة (بدل الخدمات المجانية غير المستقرة).
 * يستقبل نصًا عربيًا ولغة هدف، وينادي Azure Translator، ويرجّع الترجمة فقط —
 * مفتاح Azure السري يبقى محفوظًا هنا على الخادم ولا يظهر أبدًا في كود المتصفح.
 *
 * طريقة النشر: انسخ هذا الملف بالكامل والصقه في محرر Cloudflare Workers (خطوات في README_WORKER.md)
 */

// اسم متغيرات السر كما ستُضبط في إعدادات الـ Worker (Settings → Variables and Secrets)
// AZURE_TRANSLATOR_KEY    = مفتاح Azure Translator
// AZURE_TRANSLATOR_REGION = المنطقة (مثلاً: eastus, westeurope...)
// WORKER_SHARED_SECRET    = سلسلة عشوائية طويلة تولّدها بنفسك — يجب أن تطابق WORKER_SHARED_SECRET
//                           في musalli.html بالضبط. هذه ليست حماية تشفيرية حقيقية (أي زائر يقدر يقرأها
//                           من كود الصفحة العامة)، غرضها فقط منع الزحف الآلي العشوائي من إيجاد هذا الـ
//                           Worker واستهلاك حصة Azure/Cloudflare المجانية. الحماية الحقيقية من إساءة
//                           استخدام متعمّدة تأتي من قاعدة Rate Limiting على مستوى Cloudflare نفسه
//                           (Security → WAF → Rate limiting rules) — راجع README_WORKER.md.

const ALLOWED_LANGS = ['en', 'ur', 'tr', 'id', 'fr', 'fa', 'bn', 'ha', 'so'];

export default {
  async fetch(request, env) {
    // السماح بالوصول من أي صفحة (يمكن تضييقه لاحقًا لدومين GitHub Pages بتاعك فقط لو حبيت)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Secret',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // لو ضبطت WORKER_SHARED_SECRET، ارفض أي طلب لا يحمل نفس القيمة بالضبط في هذا الهيدر
    if (env.WORKER_SHARED_SECRET && request.headers.get('X-Worker-Secret') !== env.WORKER_SHARED_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    try {
      const { text, targetLang } = await request.json();

      if (!text || typeof text !== 'string' || !targetLang || !ALLOWED_LANGS.includes(targetLang)) {
        return new Response(JSON.stringify({ error: 'invalid request: text and a supported targetLang are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (!env.AZURE_TRANSLATOR_KEY || !env.AZURE_TRANSLATOR_REGION) {
        return new Response(JSON.stringify({ error: 'server missing AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const azureUrl = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=ar&to=${encodeURIComponent(targetLang)}`;

      const azureRes = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.AZURE_TRANSLATOR_KEY,
          'Ocp-Apim-Subscription-Region': env.AZURE_TRANSLATOR_REGION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ Text: text }]),
      });

      if (!azureRes.ok) {
        const errText = await azureRes.text();
        return new Response(JSON.stringify({ error: 'Azure Translator error', detail: errText }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = await azureRes.json();
      const translated = data && data[0] && data[0].translations && data[0].translations[0] && data[0].translations[0].text;

      if (!translated) {
        return new Response(JSON.stringify({ error: 'empty translation from Azure' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ translated }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'internal error', detail: String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
