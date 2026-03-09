const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

// ============================================================
// API KEY ROTATION SYSTEM
// ضغط هنا مفاتيحك الـ 3 الخاصة بـ RapidAPI الوهمية/الحقيقية
// ============================================================
const API_KEYS = [
  "25603f0a6emsh854d8c40c5ed2adp15d8f1jsn5e59f1e42a5d", // المفتاح الأساسي - غيره بمفتاح احتياطي إذا امتلكت واحداً
  "YOUR_RAPIDAPI_KEY_2", // مفتاح احتياطي 2 (اختياري)
  "YOUR_RAPIDAPI_KEY_3", // مفتاح احتياطي 3 (اختياري)
];

const API_HOST = "sportapi7.p.rapidapi.com";
const IMPORTANT_LEAGUE_IDS = [17, 8, 23, 35, 34, 7, 808, 52, 96, 1460, 676, 668, 18, 131];

// إعداد Firebase Admin باستخدام Service Account JSON من المتغيرات البيئية
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountKey) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT in environment variables.");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // ضع رابط قاعدة البيانات Realtime Database الخاص بمشروعك هنا
  databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
});

const db = admin.database();

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
        continue;
      } else if (status === 401 || status === 403) {
        console.warn(`Key ${i + 1} is invalid (${status}), switching...`);
        continue;
      } else {
        console.error(`Key ${i + 1} failed with error: ${error.message}`);
        throw error;
      }
    }
  }
  throw new Error("All API keys exhausted or invalid.");
}

async function run() {
  console.log("=== Kora Live (GitHub Actions): Fetching live matches ===");
  const today = new Date().toISOString().split("T")[0];
  const url = `https://${API_HOST}/api/v1/sport/football/events/live`;

  try {
    const data = await fetchWithKeyRotation(url);

    if (!data || !data.events) {
      console.log("No live events data returned.");
      await db.ref("/live_matches").set({
        events: [],
        lastUpdated: Date.now(),
        error: null,
      });
      process.exit(0);
    }

    const filteredEvents = data.events.filter((event) => {
      const leagueId = event.tournament ? event.tournament.uniqueTournament?.id : null;
      return IMPORTANT_LEAGUE_IDS.includes(leagueId);
    });

    console.log(`Fetched ${data.events.length} total events, ${filteredEvents.length} after filter.`);

    await db.ref("/live_matches").set({
      events: filteredEvents,
      totalEvents: data.events.length,
      filteredCount: filteredEvents.length,
      lastUpdated: Date.now(),
      lastUpdatedReadable: new Date().toISOString(),
      error: null,
    });

    await db.ref(`/today_matches/${today}`).set({
      events: filteredEvents,
      savedAt: Date.now(),
    });

    console.log("Live matches saved to Realtime Database successfully!");
    process.exit(0);

  } catch (error) {
    console.error("fetchLiveMatches failed:", error.message);
    await db.ref("/live_matches/error").set({
      message: error.message,
      time: Date.now(),
    });
    process.exit(1);
  }
}

run();
