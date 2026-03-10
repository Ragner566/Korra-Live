const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const fs = admin.firestore();

// إعدادات الـ API
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";
const SUPPORTED_LEAGUES = ["PL", "PD", "BL1", "SA", "FL1", "CL"];

/**
 * تحويل بيانات المباراة للهيكل الاحترافي لموقعك
 */
function formatMatch(m) {
  return {
    fixture: {
      id: m.id,
      status: { short: m.status, elapsed: m.minute || null },
      date: m.utcDate
    },
    league: {
      name: m.competition.name,
      id: m.competition.code,
      logo: m.competition.emblem
    },
    teams: {
      home: { 
        name: m.homeTeam.shortName || m.homeTeam.name, 
        id: m.homeTeam.id, 
        logo: m.homeTeam.crest 
      },
      away: { 
        name: m.awayTeam.shortName || m.awayTeam.name, 
        id: m.awayTeam.id, 
        logo: m.awayTeam.crest 
      }
    },
    goals: {
      home: m.score.fullTime.home,
      away: m.score.fullTime.away
    },
    score: m.score,
    source: "cloud-automation-v2"
  };
}

/**
 * الدالة الأساسية للمزامنة
 */
async function syncFootballData() {
  console.log("=== بدء المزامنة السحابية لثلاثة أيام ===");
  
  const now = new Date();
  const dates = {
    yesterday: new Date(now.getTime() - 86400000).toISOString().split('T')[0],
    today: now.toISOString().split('T')[0],
    tomorrow: new Date(now.getTime() + 86400000).toISOString().split('T')[0]
  };

  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: dates.yesterday,
        dateTo: dates.tomorrow,
        competitions: SUPPORTED_LEAGUES.join(',')
      },
      timeout: 20000
    });

    const allMatches = res.data.matches || [];
    const batch = fs.batch();

    for (const [key, dateStr] of Object.entries(dates)) {
      const dayMatches = allMatches.filter(m => m.utcDate.startsWith(dateStr)).map(formatMatch);
      
      const payload = {
        events: dayMatches,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        date: dateStr
      };

      // تحديث الوثيقة النسبية (today/tomorrow) والوثيقة المؤرخة (2026-03-10)
      batch.set(fs.collection('matches').doc(key), payload);
      batch.set(fs.collection('matches').doc(dateStr), payload);
    }

    await batch.commit();
    console.log("✅ تم تحديث كافة الوثائق بنجاح.");
    return { success: true, count: allMatches.length };
  } catch (error) {
    console.error("❌ فشل التحديث السحابي: ", error.message);
    throw error;
  }
}

// 1. الوظيفة المجدولة (كل 10 دقائق)
exports.scheduledScoreSync = functions
  .pubsub.schedule("every 10 minutes")
  .onRun(async (context) => {
    return await syncFootballData();
  });

// 2. رابط يدوي للاختبار الفوري
exports.manualUpdate = functions.https.onRequest(async (req, res) => {
  try {
    const result = await syncFootballData();
    res.status(200).send(`✅ نجحت المزامنة! تم تحديث ${result.count} مباراة.`);
  } catch (error) {
    res.status(500).send(`❌ فشل: ${error.message}`);
  }
});
