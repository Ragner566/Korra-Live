const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

// ============================================================
// MULTI-API STRATEGY WITH SMART CACHING
// المرحلة 1: Football-Data.org (مجاني: بدون حد شهري، 10 req/min)
// المرحلة 2: API-Sports Football (100 req/day مجاناً)
// المرحلة 3: SportAPI7 (RapidAPI) - احتياطي أخير
// ============================================================
const APIS = {
  footballData: {
    name: "Football-Data.org",
    token: process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7",
    baseUrl: "https://api.football-data.org/v4",
    dailyLimit: 9999, // practically unlimited for fixtures
    fetch: fetchFromFootballData
  },
  apiSports: {
    name: "API-Sports Football",
    key: process.env.API_SPORTS_KEY || "YOUR_API_SPORTS_KEY",
    baseUrl: "https://v3.football.api-sports.io",
    dailyLimit: 100,
    fetch: fetchFromAPISports
  },
  rapidApi: {
    name: "SportAPI7 (RapidAPI)",
    keys: [
      process.env.RAPID_API_KEY_1 || "25603f0a6emsh854d8c40c5ed2adp15d8f1jsn5e59f1e42a5d",
      process.env.RAPID_API_KEY_2 || "YOUR_KEY_2",
    ],
    baseUrl: "https://sportapi7.p.rapidapi.com",
    fetch: fetchFromRapidAPI
  }
};

// Football-Data.org league IDs mapping
const FOOTBALL_DATA_COMPETITIONS = ["PL", "CL", "PD", "BL1", "SA", "FL1", "EL"];

// Firebase init
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountKey) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT");
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountKey)),
  databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
});
const db = admin.database();
const fs = admin.firestore();

// Fetch settings from Firestore to allow dynamic key updates from Admin Panel
async function loadSettingsFromFirestore() {
  try {
    const doc = await fs.collection('settings').doc('global').get();
    if (doc.exists) {
      const data = doc.data();
      if (data.footballDataToken) APIS.footballData.token = data.footballDataToken;
      if (data.apiSportsKey) APIS.apiSports.key = data.apiSportsKey;
      if (data.rapidApiKey1) APIS.rapidApi.keys[0] = data.rapidApiKey1;
      if (data.rapidApiKey2) APIS.rapidApi.keys[1] = data.rapidApiKey2;
      console.log("Settings loaded from Firestore successfully.");
    }
  } catch (e) {
    console.warn("Failed to load settings from Firestore, using env/defaults:", e.message);
  }
}

// ============================================================
// API FETCHERS
// ============================================================
async function fetchFromFootballData() {
  const token = APIS.footballData.token;
  if (!token || token.startsWith("YOUR_")) throw new Error("Football-Data token not configured");
  
  const today = new Date().toISOString().split("T")[0];
  const res = await axios.get(`${APIS.footballData.baseUrl}/matches`, {
    headers: { "X-Auth-Token": token },
    params: { dateFrom: today, dateTo: today },
    timeout: 12000
  });
  
  // Normalize to our format
  const matches = (res.data.matches || []).map(m => ({
    id: m.id,
    homeTeam: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id },
    awayTeam: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id },
    score: {
      home: m.score.fullTime.home,
      away: m.score.fullTime.away,
      halfHome: m.score.halfTime.home,
      halfAway: m.score.halfTime.away
    },
    status: m.status,
    utcDate: m.utcDate,
    competition: { name: m.competition.name, id: m.competition.code },
    minute: m.minute || null,
    source: "football-data.org"
  }));
  
  return { events: matches, source: "football-data.org" };
}

async function fetchFromAPISports() {
  const key = APIS.apiSports.key;
  if (!key || key.startsWith("YOUR_")) throw new Error("API-Sports key not configured");
  
  const today = new Date().toISOString().split("T")[0];
  const res = await axios.get(`${APIS.apiSports.baseUrl}/fixtures`, {
    headers: { "x-apisports-key": key },
    params: { date: today, season: new Date().getFullYear() },
    timeout: 12000
  });
  
  const fixtures = (res.data.response || []).map(f => ({
    id: f.fixture.id,
    homeTeam: { name: f.teams.home.name, id: f.teams.home.id },
    awayTeam: { name: f.teams.away.name, id: f.teams.away.id },
    score: {
      home: f.goals.home,
      away: f.goals.away,
    },
    status: f.fixture.status.short,
    utcDate: f.fixture.date,
    competition: { name: f.league.name, id: f.league.id },
    minute: f.fixture.status.elapsed || null,
    source: "api-sports.io"
  }));
  
  return { events: fixtures, source: "api-sports.io" };
}

async function fetchFromRapidAPI() {
  const keys = APIS.rapidApi.keys.filter(k => k && !k.startsWith("YOUR_"));
  if (!keys.length) throw new Error("No valid RapidAPI keys");
  
  for (const key of keys) {
    try {
      const res = await axios.get(`${APIS.rapidApi.baseUrl}/api/v1/sport/football/events/live`, {
        headers: { "x-rapidapi-host": "sportapi7.p.rapidapi.com", "x-rapidapi-key": key },
        timeout: 12000
      });
      return { events: res.data.events || [], source: "sportapi7" };
    } catch(e) {
      if (e.response?.status === 429) { console.warn("RapidAPI 429, trying next key..."); continue; }
      throw e;
    }
  }
  throw new Error("All RapidAPI keys hit rate limit (429)");
}

// ============================================================
// SMART SCHEDULING LOGIC
// ============================================================
function shouldFetchLive(existingData) {
  // No data yet — always fetch
  if (!existingData || !existingData.events) return true;
  
  const now = Date.now();
  const lastUpdate = existingData.lastUpdated || 0;
  const minsSinceUpdate = (now - lastUpdate) / 60000;
  
  const events = existingData.events || [];
  
  // Check if any match is currently in progress
  const hasLiveMatches = events.some(e => {
    const s = (e.status || "").toUpperCase();
    return ["1H", "2H", "ET", "P", "LIVE", "IN_PLAY", "PAUSED", "inprogress"].some(l => s.includes(l));
  });
  
  // Check if any match is starting within the next 30 minutes
  const nowMs = now;
  const hasUpcomingMatch = events.some(e => {
    if (!e.utcDate) return false;
    const matchTime = new Date(e.utcDate).getTime();
    const minsUntil = (matchTime - nowMs) / 60000;
    return minsUntil >= -5 && minsUntil <= 30;
  });
  
  if (hasLiveMatches) {
    // Refresh every 5 minutes during live matches
    return minsSinceUpdate >= 5;
  } else if (hasUpcomingMatch) {
    // Refresh every 15 minutes if match starting soon
    return minsSinceUpdate >= 15;
  } else {
    // Refresh every 60 minutes otherwise (to save quota)
    return minsSinceUpdate >= 60;
  }
}

// ============================================================
// MAIN RUN FUNCTION
// ============================================================
async function run() {
  console.log("=== Kora Live Smart Fetch ===");
  
  // Load dynamic settings first
  await loadSettingsFromFirestore();

  const today = new Date().toISOString().split("T")[0];
  
  // Check existing data first (Smart Cache)
  const existingSnap = await db.ref("/live_matches").once("value");
  const existingData = existingSnap.val();
  
  if (!shouldFetchLive(existingData)) {
    console.log("Smart cache: No fetch needed right now. Data is fresh or no live matches.");
    process.exit(0);
  }
  
  console.log("Fetching fresh data...");
  
  // Try each API in order
  const apiOrder = [APIS.footballData, APIS.apiSports, APIS.rapidApi];
  let result = null;
  let lastError = null;
  
  for (const api of apiOrder) {
    try {
      console.log(`Trying ${api.name}...`);
      result = await api.fetch();
      console.log(`Success from ${api.name}: ${result.events.length} matches`);
      break;
    } catch(e) {
      lastError = e;
      console.warn(`${api.name} failed: ${e.message}`);
    }
  }
  
  if (!result) {
    // All APIs failed — mark as quota exceeded, don't crash
    console.error("All APIs failed. Saving quota-exceeded state.");
    await db.ref("/live_matches").update({
      quotaExceeded: true,
      quotaMessage: "سيتم تحديث النتائج قريباً عند تجديد الحصة اليومية",
      lastAttempted: Date.now(),
      error: lastError?.message || "Unknown error"
    });
    process.exit(0); // Exit 0 so GitHub Action doesn't fail
  }
  
  // Save to Firebase
  await db.ref("/live_matches").set({
    events: result.events,
    totalEvents: result.events.length,
    source: result.source,
    lastUpdated: Date.now(),
    lastUpdatedReadable: new Date().toISOString(),
    quotaExceeded: false,
    error: null
  });
  
  // Also cache today's fixtures separately
  await db.ref(`/today_matches/${today}`).set({
    events: result.events,
    savedAt: Date.now(),
    source: result.source
  });
  
  console.log("Data saved successfully!");
  process.exit(0);
}

run().catch(e => {
  console.error("Unexpected error:", e.message);
  process.exit(0); // Never fail hard
});
