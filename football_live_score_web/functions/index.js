const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.database();

// ============================================================
// API KEY ROTATION SYSTEM
// ضع مفاتيحك الحقيقية هنا (ارجع إلى هذا الملف وعدّل المصفوفة)
// ============================================================
const API_KEYS = [
  "YOUR_RAPIDAPI_KEY_1",   // المفتاح الأول
  "YOUR_RAPIDAPI_KEY_2",   // المفتاح الثاني (احتياطي)
  "YOUR_RAPIDAPI_KEY_3",   // المفتاح الثالث (احتياطي)
];

const API_HOST = "sportapi7.p.rapidapi.com";

// الدوريات التي نريد جلب بياناتها
const IMPORTANT_LEAGUE_IDS = [17, 8, 23, 35, 34, 7, 808, 52, 96, 1460, 676, 668, 18, 131];

// ============================================================
// دالة تجرب المفاتيح بالترتيب، إذا أعطى 429 تنتقل للتالي
// ============================================================
async function fetchWithKeyRotation(url, params = {}) {
  for (let i = 0; i < API_KEYS.length; i++) {
    const key = API_KEYS[i];
    if (!key || key.startsWith("YOUR_")) {
      console.warn(`Key ${i + 1} is a placeholder, skipping.`);
      continue;
    }
    try {
      console.log(`Trying API key ${i + 1}...`);
      const response = await axios.get(url, {
        headers: {
          "x-rapidapi-host": API_HOST,
          "x-rapidapi-key": key,
        },
        params,
        timeout: 10000,
      });
      console.log(`Success with key ${i + 1}`);
      return response.data;
    } catch (error) {
      const status = error.response ? error.response.status : null;
      if (status === 429) {
        console.warn(`Key ${i + 1} hit rate limit (429), switching to next key...`);
        continue; // جرب المفتاح التالي
      } else if (status === 401 || status === 403) {
        console.warn(`Key ${i + 1} is invalid (${status}), switching...`);
        continue;
      } else {
        console.error(`Key ${i + 1} failed with error: ${error.message}`);
        throw error; // خطأ غير متوقع، وقف
      }
    }
  }
  throw new Error("All API keys exhausted or invalid. Please update your keys.");
}

// ============================================================
// الوظيفة المجدولة: تعمل كل 5 دقائق
// تجلب المباريات المباشرة وتحفظها في Realtime Database
// ============================================================
exports.fetchLiveMatches = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("every 5 minutes")
  .onRun(async (context) => {
    console.log("=== Kora Live: Fetching live matches ===");

    const today = new Date().toISOString().split("T")[0]; // مثلاً: 2026-03-09
    const url = `https://${API_HOST}/api/v1/sport/football/events/live`;

    try {
      const data = await fetchWithKeyRotation(url);

      if (!data || !data.events) {
        console.log("No live events data returned.");
        // احفظ حالة فارغة مع وقت التحديث
        await db.ref("/live_matches").set({
          events: [],
          lastUpdated: Date.now(),
          error: null,
        });
        return null;
      }

      // فلتر المباريات بالدوريات المهمة فقط
      const filteredEvents = data.events.filter((event) => {
        const leagueId = event.tournament ? event.tournament.uniqueTournament?.id : null;
        return IMPORTANT_LEAGUE_IDS.includes(leagueId);
      });

      console.log(`Fetched ${data.events.length} total events, ${filteredEvents.length} after filter.`);

      // احفظ البيانات في Realtime Database
      await db.ref("/live_matches").set({
        events: filteredEvents,
        totalEvents: data.events.length,
        filteredCount: filteredEvents.length,
        lastUpdated: Date.now(),
        lastUpdatedReadable: new Date().toISOString(),
        error: null,
      });

      // أيضاً احفظ نسخة من نتائج اليوم
      await db.ref(`/today_matches/${today}`).set({
        events: filteredEvents,
        savedAt: Date.now(),
      });

      console.log("Live matches saved to Realtime Database successfully!");
    } catch (error) {
      console.error("fetchLiveMatches failed:", error.message);
      // احفظ رسالة الخطأ في قاعدة البيانات ليعرفها الأدمن
      await db.ref("/live_matches/error").set({
        message: error.message,
        time: Date.now(),
      });
    }

    return null;
  });

// ============================================================
// وظيفة يدوية (HTTP Trigger) لاختبار الجلب فوراً بدون انتظار
// الرابط: /triggerFetch (للاختبار فقط - يُفضل تعطيلها في الإنتاج)
// ============================================================
exports.triggerFetch = functions.https.onRequest(async (req, res) => {
  // حماية بسيطة: يجب تمرير secret في الـ query
  const secret = req.query.secret;
  if (secret !== "kora-live-secret-2026") {
    return res.status(403).json({ error: "Forbidden" });
  }

  console.log("Manual trigger: fetching live matches now...");
  const url = `https://${API_HOST}/api/v1/sport/football/events/live`;

  try {
    const data = await fetchWithKeyRotation(url);
    const events = data.events || [];

    await db.ref("/live_matches").set({
      events,
      totalEvents: events.length,
      lastUpdated: Date.now(),
      lastUpdatedReadable: new Date().toISOString(),
      manualTrigger: true,
      error: null,
    });

    return res.status(200).json({
      success: true,
      eventCount: events.length,
      message: "Live matches fetched and saved!",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
