/* ============================================================================
   بوابة المصلّي — اتجاه القبلة + البوصلة الحية
   منطق مطابق تمامًا للنسخة السابقة — فقط أُعيد تنظيمه في ملف مستقل
   ============================================================================ */

let qiblaComputed = false;
const KAABA_LAT = 21.4225, KAABA_LNG = 39.8262;
let qiblaBearing = null;
let compassWatching = false;
let orientationHandler = null;

function computeQibla() {
    qiblaComputed = true;
    const box = document.getElementById('qibla-content');
    if (!navigator.geolocation) {
        box.innerHTML = '<div class="qibla-note">⚠️ متصفحك لا يدعم تحديد الموقع الجغرافي.</div>';
        return;
    }
    stopLiveCompass();
    box.innerHTML = '<div class="qibla-note">⏳ جارٍ تحديد موقعك... (يعمل من أي دولة أو مدينة)</div>';
    navigator.geolocation.getCurrentPosition(function(pos) {
        const lat1 = pos.coords.latitude * Math.PI / 180;
        const lng1 = pos.coords.longitude * Math.PI / 180;
        const lat2 = KAABA_LAT * Math.PI / 180;
        const lng2 = KAABA_LNG * Math.PI / 180;
        const dLng = lng2 - lng1;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360;
        qiblaBearing = bearing;

        const dirs = ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'];
        const dirName = dirs[Math.round(bearing / 45) % 8];

        box.innerHTML = `
            <div class="qibla-result">
                <div class="qibla-degree num">${Math.round(bearing)}°</div>
                <div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-top:4px;">من الشمال، نحو ${dirName}</div>
                <div class="qibla-compass">
                    <svg viewBox="0 0 140 140" width="140" height="140">
                        <circle cx="70" cy="70" r="65" fill="none" stroke="var(--color-border)" stroke-width="2"/>
                        <polygon points="70,1 63,17 77,17" fill="var(--color-text-faint)"/>
                        <g id="qibla-disc" style="transform-origin:70px 70px; transform: rotate(0deg); transition: transform 0.12s ease-out;">
                            <text x="70" y="17" text-anchor="middle" font-size="11" fill="var(--color-text-faint)" font-weight="bold">ش</text>
                            <text x="70" y="129" text-anchor="middle" font-size="10" fill="var(--color-text-faint)">ج</text>
                            <text x="11" y="74" text-anchor="middle" font-size="10" fill="var(--color-text-faint)">غ</text>
                            <text x="129" y="74" text-anchor="middle" font-size="10" fill="var(--color-text-faint)">ق</text>
                            <g style="transform-origin:70px 70px; transform: rotate(${bearing}deg);">
                                <line x1="70" y1="70" x2="70" y2="28" stroke="var(--color-primary)" stroke-width="3" stroke-linecap="round"/>
                                <circle cx="70" cy="24" r="10" fill="var(--color-primary)"/>
                                <text x="70" y="28" text-anchor="middle" font-size="11">🕋</text>
                            </g>
                        </g>
                        <circle cx="70" cy="70" r="4" fill="var(--color-text-faint)"/>
                    </svg>
                </div>
                <button class="btn btn-primary btn-block" id="qibla-compass-btn" onclick="toggleLiveCompass()">🧭 تفعيل البوصلة الحية</button>
                <div class="qibla-note" id="qibla-compass-status"></div>
                <div class="qibla-note">وجّه أعلى جوالك (السهم الرمادي) نحو رمز الكعبة 🕋 داخل الدائرة، وعند تفعيل البوصلة الحية سيتحرك السهم تلقائيًا مع دوران جوالك ليدلّك على اتجاه القبلة الحقيقي أينما كنت.</div>
            </div>
        `;
    }, function(err) {
        box.innerHTML = `<div class="qibla-note">⚠️ تعذّر الوصول للموقع الجغرافي (${err.message}). تأكد من منح الإذن للمتصفح.</div>`;
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

// البوصلة الحية: تربط دوران دائرة القبلة باتجاه الجوال الفعلي عبر حساس device orientation
function toggleLiveCompass() {
    if (compassWatching) { stopLiveCompass(); return; }

    const status = document.getElementById('qibla-compass-status');
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ يتطلب إذنًا صريحًا من المستخدم قبل قراءة حساسات الاتجاه
        DeviceOrientationEvent.requestPermission().then(function(response) {
            if (response === 'granted') startLiveCompass();
            else if (status) status.innerHTML = '⚠️ تم رفض إذن الوصول لحساس الاتجاه، فلن تعمل البوصلة الحية.';
        }).catch(function(e) {
            if (status) status.innerHTML = '⚠️ تعذّر تفعيل البوصلة الحية: ' + e.message;
        });
    } else if ('DeviceOrientationEvent' in window) {
        startLiveCompass();
    } else if (status) {
        status.innerHTML = '⚠️ جهازك أو متصفحك لا يدعم حساس البوصلة. جرّب من جوال بمتصفح حديث (Chrome أو Safari).';
    }
}

function startLiveCompass() {
    compassWatching = true;
    const btn = document.getElementById('qibla-compass-btn');
    const status = document.getElementById('qibla-compass-status');
    if (btn) btn.textContent = '⏹ إيقاف البوصلة الحية';
    if (status) status.innerHTML = '🧭 البوصلة نشطة — حرّك جوالك ببطء ليتحرك السهم مع الاتجاه الحقيقي';

    orientationHandler = function(event) {
        let heading = null;
        if (typeof event.webkitCompassHeading === 'number') {
            heading = event.webkitCompassHeading; // سفاري iOS: زاوية دقيقة من الشمال الحقيقي مباشرة
        } else if (event.alpha !== null && event.alpha !== undefined) {
            heading = 360 - event.alpha; // أندرويد/كروم
        }
        if (heading === null || isNaN(heading)) return;
        const disc = document.getElementById('qibla-disc');
        if (disc) disc.style.transform = `rotate(${(-heading + 360) % 360}deg)`;
    };

    const eventName = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(eventName, orientationHandler, true);
}

function stopLiveCompass() {
    if (!compassWatching) return;
    compassWatching = false;
    const btn = document.getElementById('qibla-compass-btn');
    const status = document.getElementById('qibla-compass-status');
    if (btn) btn.textContent = '🧭 تفعيل البوصلة الحية';
    if (status) status.innerHTML = '';
    const eventName = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    if (orientationHandler) window.removeEventListener(eventName, orientationHandler, true);
    const disc = document.getElementById('qibla-disc');
    if (disc) disc.style.transform = 'rotate(0deg)';
}
