const admin = require('firebase-admin');
const axios = require('axios');

// ============================================================
// CONFIGURATION
// Football-Data.org Free Tier:
// - 10 requests/minute rate limit
// - Basic match data available
// - Deep details (lineups/stats) available via /v4/matches/{id}
//   but content depends on competition tier in the plan
// ============================================================
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL", "ELC"]; 
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";

// Rate limit: 10 req/min = 1 req per 6.5s to be safe
const RATE_LIMIT_DELAY_MS = 6500;

const fsMod = require('fs');
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./football_live_score_web/functions/service-account.json.json')) {
  serviceAccount = require('./football_live_score_web/functions/service-account.json.json');
} else {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT or local service-account file.");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}

const db = admin.firestore();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ---- MAP raw API match to our internal format ----
function mapMatch(m, deep = null) {
  const d = deep || {};
  
  // Parse lineups from football-data.org format
  let lineups = null;
  if (d.lineups && d.lineups.length >= 2) {
    const homeLineup = d.lineups.find(l => l.team.id === m.homeTeam.id) || d.lineups[0];
    const awayLineup = d.lineups.find(l => l.team.id === m.awayTeam.id) || d.lineups[1];
    lineups = {
      home: {
        team: homeLineup.team,
        formation: homeLineup.formation,
        players: (homeLineup.startXI || []).map(p => ({ player: p.player || p, pos: p.position })),
        bench: (homeLineup.substitutes || []).map(p => ({ player: p.player || p, pos: p.position })),
        coach: homeLineup.coach
      },
      away: {
        team: awayLineup.team,
        formation: awayLineup.formation,
        players: (awayLineup.startXI || []).map(p => ({ player: p.player || p, pos: p.position })),
        bench: (awayLineup.substitutes || []).map(p => ({ player: p.player || p, pos: p.position })),
        coach: awayLineup.coach
      }
    };
  }

  // Parse statistics from football-data.org format
  let statistics = [];
  if (d.statistics && d.statistics.length > 0) {
    // football-data.org wraps stats per period: [{period:"ALL", groups:[...]}]
    statistics = d.statistics;
  }

  // Parse goals & events from goals array and bookings
  let events = [];
  const rawGoals = d.goals || m.goals_incidents || [];
  const rawBookings = d.bookings || [];
  const rawSubstitutions = d.substitutions || [];

  rawGoals.forEach(g => {
    events.push({
      type: g.type || 'GOAL',
      time: g.minute,
      playerName: g.scorer?.name || '',
      assist: g.assist?.name || null,
      teamId: g.team?.id,
      isHome: g.team?.id === m.homeTeam.id
    });
  });
  rawBookings.forEach(b => {
    events.push({
      type: b.card || 'YELLOW_CARD',
      time: b.minute,
      playerName: b.playerName || b.player?.name || '',
      teamId: b.team?.id,
      isHome: b.team?.id === m.homeTeam.id,
      incidentType: 'card',
      incidentClass: (b.card === 'RED_CARD') ? 'red' : 'yellow'
    });
  });
  rawSubstitutions.forEach(s => {
    events.push({
      type: 'SUBSTITUTION',
      time: s.minute,
      playerIn: s.replacedWith?.name || '',
      playerOut: s.playerName || s.player?.name || '',
      teamId: s.team?.id,
      isHome: s.team?.id === m.homeTeam.id
    });
  });

  return {
    fixture: {
      id: m.id,
      status: { 
        short: m.status || (d.status), 
        elapsed: d.minute || m.minute || null 
      },
      date: m.utcDate,
      venue: d.venue || null,
      referee: d.referees?.[0]?.name || null
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
    score: d.score || m.score,
    goals: {
      home: (d.score || m.score)?.fullTime?.home ?? null,
      away: (d.score || m.score)?.fullTime?.away ?? null
    },
    minute: d.minute || m.minute || null,
    events,
    statistics,
    lineups,
    deepFetched: deep !== null,
    utcDate: m.utcDate
  };
}

// ---- Deep-fetch a single match by ID ----
async function deepFetchMatch(matchId) {
  try {
    const res = await axios.get(`${BASE_URL}/matches/${matchId}`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      timeout: 10000
    });
    return res.data;
  } catch (e) {
    if (e.response?.status === 429) {
      console.warn(`  ⚠️  Rate limit hit for match ${matchId}. Skipping.`);
    } else {
      console.warn(`  ⚠️  Deep-fetch failed for match ${matchId}: ${e.message}`);
    }
    return null;
  }
}

async function sync() {
  console.log(`=== SYNC START: ${new Date().toISOString()} ===`);
  
  const dStr = (d) => d.toISOString().split('T')[0];
  const now = new Date();
  
  const yesterdayStr = dStr(new Date(now.getTime() - 86400000));
  const todayStr     = dStr(now);
  const tomorrowStr  = dStr(new Date(now.getTime() + 86400000));

  // Broad range: yesterday-1 to tomorrow+1 to safely cover all timezones
  const dateFrom = dStr(new Date(now.getTime() - 86400000 * 2));
  const dateTo   = dStr(new Date(now.getTime() + 86400000 * 2));
  
  try {
    // ─── STEP 1: Broad match list fetch ──────────────────────────────────────
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom, dateTo, competitions: SUPPORTED_COMPETITIONS.join(',') }
    });
    
    const rawMatches = res.data.matches || [];
    console.log(`✅ Broad fetch: ${rawMatches.length} matches (${dateFrom} → ${dateTo})`);

    // ─── STEP 2: Determine which matches need deep-fetching ───────────────────
    // Priority: 
    //  A) Currently LIVE / PAUSED → always deep-fetch (for minute, stats)
    //  B) FINISHED matches from yesterday and today → deep-fetch once for lineups+goals
    //  C) Skip upcoming (no details yet)
    
    const liveMatches      = rawMatches.filter(m => ['IN_PLAY', 'PAUSED', 'HALFTIME'].includes(m.status));
    const finishedMatches  = rawMatches.filter(m => ['FINISHED', 'FT', 'AET', 'PEN'].includes(m.status));

    console.log(`  → LIVE: ${liveMatches.length} | FINISHED: ${finishedMatches.length}`);

    // Check which finished matches already have deep data in Firestore (to avoid re-fetching)
    const alreadyDeepIds = new Set();
    // Read existing Firestore docs for yesterday and today to check deepFetched flag
    for (const docId of [yesterdayStr, todayStr]) {
      try {
        const snap = await db.collection('matches').doc(docId).get();
        if (snap.exists) {
          const existing = snap.data().events || [];
          existing.forEach(e => { if (e.deepFetched) alreadyDeepIds.add(e.fixture.id); });
        }
      } catch(e) { /* ignore */ }
    }

    const toDeepFetch = [
      ...liveMatches,  // Always re-fetch live
      ...finishedMatches.filter(m => !alreadyDeepIds.has(m.id))  // Only new finished
    ];

    console.log(`  → Needs deep-fetch: ${toDeepFetch.length} matches (${alreadyDeepIds.size} already cached)`);

    // ─── STEP 3: Deep-fetch with rate limiting ────────────────────────────────
    const deepDataMap = {}; // matchId -> deep API response
    let requestCount = 1;   // Already used 1 for the broad fetch

    for (let i = 0; i < toDeepFetch.length; i++) {
      const m = toDeepFetch[i];
      
      // Rate limit: pause every request to stay under 10/min
      if (requestCount > 0) {
        console.log(`  ⏳ Rate-limit pause (${RATE_LIMIT_DELAY_MS}ms) before match ${m.id}...`);
        await delay(RATE_LIMIT_DELAY_MS);
      }
      
      const deep = await deepFetchMatch(m.id);
      if (deep) {
        deepDataMap[m.id] = deep;
        const hasLineups = deep.lineups?.length > 0;
        const hasStats   = deep.statistics?.length > 0;
        const hasGoals   = deep.goals?.length > 0;
        console.log(`  ✅ Match ${m.id} (${deep.homeTeam?.name} vs ${deep.awayTeam?.name}): lineups=${hasLineups}, stats=${hasStats}, goals=${hasGoals}, min=${deep.minute || 'N/A'}`);
      }
      requestCount++;
    }

    // ─── STEP 4: Map all matches (merge with deep data) ──────────────────────
    const mappedTemp = rawMatches.map(m => {
      const deep = deepDataMap[m.id] || null;
      return mapMatch(m, deep);
    });

    // ─── STEP 5: Group by date ────────────────────────────────────────────────
    const grouped = {};
    // Initialize all dates (including empty days)
    for (let d = new Date(dateFrom); d <= new Date(dateTo); d.setDate(d.getDate() + 1)) {
      grouped[dStr(d)] = [];
    }
    
    mappedTemp.forEach(m => {
      const utcDate = m.utcDate.split('T')[0];
      if (!grouped[utcDate]) grouped[utcDate] = [];
      grouped[utcDate].push(m);
    });

    // ─── STEP 6: Write to Firestore ──────────────────────────────────────────
    // Firestore batch has a 500 ops limit, so split into multiple batches
    let batch = db.batch();
    let opCount = 0;
    const flushBatch = async () => {
      if (opCount > 0) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    };

    for (const [dateStr, events] of Object.entries(grouped)) {
      const payload = {
        events,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        date: dateStr,
        deepFetchedIds: events.filter(e => e.deepFetched).map(e => e.fixture.id)
      };
      
      batch.set(db.collection('matches').doc(dateStr), payload);
      opCount++;
      
      // Aliases for compatibility
      if (dateStr === todayStr) {
        batch.set(db.collection('matches').doc('today'), payload);
        opCount++;
      }
      if (dateStr === tomorrowStr) {
        batch.set(db.collection('matches').doc('tomorrow'), payload);
        opCount++;
      }
      if (dateStr === yesterdayStr) {
        batch.set(db.collection('matches').doc('yesterday'), payload);
        opCount++;
      }

      if (opCount >= 400) await flushBatch();
    }
    
    await flushBatch();
    
    const totalDeep = Object.keys(deepDataMap).length;
    console.log(`\n✅ Sync successful. Deep-fetched: ${totalDeep} matches. Total matches stored: ${mappedTemp.length}`);

  } catch (e) {
    console.error(`❌ Sync Failed: ${e.message}`);
    if (e.response) {
      console.error(`   API Response: ${e.response.status} - ${JSON.stringify(e.response.data)}`);
    }
  }
  process.exit(0);
}

sync();
