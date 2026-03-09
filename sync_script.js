const admin = require('firebase-admin');
const axios = require('axios');

// CONFIG
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";
const SUPPORTED_LEAGUES = ["PL", "PD", "BL1", "SA", "FL1", "CL"];

// GitHub Actions Secret loading for Service Account
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Local fallback for testing
    serviceAccount = require('./service-account.json');
  }
} catch (e) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT environment variable or service-account.json file");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}

const fs = admin.firestore();

/**
 * Formats match data to match the internal App Model
 */
function formatMatch(m) {
  return {
    fixture: {
      id: m.id,
      status: { 
        short: m.status, 
        elapsed: m.minute || null 
      },
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
    source: "github-actions-sync"
  };
}

async function startSync() {
  console.log("=== GitHub Actions: Starting Football Data Sync (3 Days) ===");
  
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
      timeout: 30000
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

      // Update both named docs (today/yesterday/tomorrow) and explicit date docs (2026-03-10)
      batch.set(fs.collection('matches').doc(key), payload);
      batch.set(fs.collection('matches').doc(dateStr), payload);
      
      console.log(`Updated ${key} (${dateStr}) with ${dayMatches.length} matches.`);
    }

    await batch.commit();
    console.log("✅ Success: Firestore updated.");
  } catch (error) {
    console.error("❌ Sync Failed:", error.message);
    process.exit(1);
  }
  process.exit(0);
}

startSync();
