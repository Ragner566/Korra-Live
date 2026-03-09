const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

// ============================================================
// CONFIGURATION & API LIMITS
// supported competitions for Football-Data.org Free Tier:
// PL (Premier League), PD (La Liga), BL1 (Bundesliga), SA (Serie A), FL1 (Ligue 1), CL (Champions League)
// ============================================================
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL"];
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";

const fsMod = require('fs');
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./service-account.js')) {
  serviceAccount = require('./service-account.js');
}

if (!serviceAccount) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT or service-account.js");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
});

const db = admin.database();
const fs = admin.firestore();

// ============================================================
// DATA FETCHING HELPERS
// ============================================================

async function fetchMatchDetails(matchId) {
  console.log(`Fetching details for match ${matchId}...`);
  try {
    const res = await axios.get(`${BASE_URL}/matches/${matchId}`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      timeout: 10000
    });
    return res.data;
  } catch (e) {
    if (e.response && e.response.status === 429) {
      console.warn("Rate limit hit while fetching details. Skipping...");
      return "LIMIT";
    }
    console.error(`Error fetching details for match ${matchId}: ${e.message}`);
    return null;
  }
}

async function fetchMatchesForRange(dateFrom, dateTo) {
  console.log(`Fetching matches from ${dateFrom} to ${dateTo}...`);
  try {
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { 
        dateFrom, 
        dateTo,
        competitions: SUPPORTED_COMPETITIONS.join(',') 
      },
      timeout: 15000
    });
    
    let matches = res.data.matches || [];
    
    // ENHANCEMENT: Fetch details (lineups/goals) for LIVE or recently played matches
    // But limit to avoid hitting 10 req/min too hard
    const importantMatches = matches.filter(m => (m.status === "IN_PLAY" || m.status === "FINISHED" || m.status === "PAUSED")).slice(0, 8);
    
    console.log(`Deep fetching details for ${importantMatches.length} important matches...`);
    for (let i = 0; i < importantMatches.length; i++) {
        const m = importantMatches[i];
        const details = await fetchMatchDetails(m.id);
        if (details === "LIMIT") break; // Stop if rate limited
        if (details) {
            // Append details to the match object
            m.detailsFetched = true;
            m.lineups = details.lineups || null;
            m.statistics = details.statistics || [];
            m.goals_events = details.goals || [];
        }
        // Wait 6.5s to stay under 10req/min
        if (i < importantMatches.length - 1) await new Promise(r => setTimeout(r, 6500));
    }

    return matches.map(m => ({
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
        home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
        away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
      },
      goals: {
        home: m.score.fullTime.home,
        away: m.score.fullTime.away
      },
      score: m.score,
      lineups: m.lineups,
      statistics: m.statistics,
      events: m.goals_events,
      source: "football-data.org (enriched)"
    }));
  } catch (e) {
    console.error(`Error fetching matches: ${e.message}`);
    return null;
  }
}

async function fetchStandings(competitionCode) {
  console.log(`Fetching standings for ${competitionCode}...`);
  try {
    const res = await axios.get(`${BASE_URL}/competitions/${competitionCode}/standings`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      timeout: 15000
    });
    
    return res.data.standings || [];
  } catch (e) {
    console.error(`Error fetching standings for ${competitionCode}: ${e.message}`);
    return null;
  }
}

// ============================================================
// MAIN RUN FUNCTION
// ============================================================

async function run() {
  console.log("=== Kora Live Comprehensive Fix Script ===");
  
  // 1. Fetch & Store Matches (Yesterday, Today, Tomorrow)
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  
  const dStr = (d) => d.toISOString().split('T')[0];
  
  const matches = await fetchMatchesForRange(dStr(yesterday), dStr(tomorrow));
  
  if (matches) {
    // Group matches by date
    const grouped = {};
    matches.forEach(m => {
      const date = m.fixture.date.split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(m);
    });
    
    // Save to Firestore & Realtime DB
    for (const [date, events] of Object.entries(grouped)) {
      // 1. Realtime DB (Legacy support)
      await db.ref(`/matches/${date}`).set({
        events,
        lastUpdated: Date.now(),
        source: "football-data.org"
      });
      console.log(`Saved ${events.length} matches for ${date} in RTDB`);
      
      // 2. Firestore (Primary)
      await fs.collection('matches').doc(date).set({
        events,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        source: "football-data.org"
      });
      console.log(`Saved ${events.length} matches for ${date} in Firestore`);

      // Special labels: today, yesterday, tomorrow
      if (date === dStr(now)) {
        await fs.collection('matches').doc('today').set({ events, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
        await db.ref("/live_matches").set({ events, lastUpdated: Date.now(), quotaExceeded: false });
      } else if (date === dStr(yesterday)) {
        await fs.collection('matches').doc('yesterday').set({ events, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
      } else if (date === dStr(tomorrow)) {
        await fs.collection('matches').doc('tomorrow').set({ events, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
      }
    }
  }

  // 2. Fetch & Store Standings for 6 Leagues in Firestore
  for (const code of SUPPORTED_COMPETITIONS) {
    const standings = await fetchStandings(code);
    if (standings) {
      await fs.collection('standings').doc(code).set({
        standings,
        lastUpdated: new Date().toISOString()
      });
      console.log(`Saved standings for ${code} in Firestore`);
    }
    // Respect rate limit (10 req/min)
    await new Promise(r => setTimeout(r, 6500)); 
  }

  // 3. Update Firestore 'korra' field
  try {
    await fs.collection('settings').doc('global').set({
      korra: FOOTBALL_DATA_TOKEN,
      footballDataToken: FOOTBALL_DATA_TOKEN,
      lastSmartUpdate: new Date().toISOString()
    }, { merge: true });
    console.log("Firestore updated with verified token.");
  } catch (e) {
    console.error("Firestore update failed:", e.message);
  }

  console.log("=== Run Completed Successfully ===");
  process.exit(0);
}

run().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
