const admin = require('firebase-admin');
const axios = require('axios');
const fsMod = require('fs');

// ============================================================
// CONFIGURATION V7.0
// ============================================================
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL", "ELC"]; 
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";
const RATE_LIMIT_DELAY_MS = 6500; 

const LEAGUE_MAPPING_ESPN = {
    "PL": "eng.1",
    "PD": "esp.1",
    "BL1": "ger.1",
    "SA": "ita.1",
    "FL1": "fra.1",
    "CL": "uefa.champions",
    "ELC": "eng.2"
};

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./football_live_score_web/functions/service-account.json.json')) {
  serviceAccount = require('./football_live_score_web/functions/service-account.json.json');
} else {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT.");
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

// ============================================
// FUZZY MATCHING & ESPN DATA FETCHING
// ============================================

function cleanName(name) {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/fc|cf|afc|real|athletic|united|city|atletico|de|stade|olympique/g, '')
        .trim()
        .replace(/\s+/g, '');
}

async function fetchESPNStats(leagueCode, dateStr, matchData) {
    const espnLeague = LEAGUE_MAPPING_ESPN[leagueCode];
    if (!espnLeague) return null;

    try {
        console.log(`  🔍 [ESPN] Searching for stats for ${matchData.homeTeam.name} vs ${matchData.awayTeam.name}...`);
        const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/scoreboard?dates=${dateStr.replace(/-/g, '')}`;
        const res = await axios.get(scoreboardUrl, { timeout: 8000 });
        
        const events = res.data.events || [];
        const homeClean = cleanName(matchData.homeTeam.name);
        const awayClean = cleanName(matchData.awayTeam.name);

        const espnMatch = events.find(e => {
            const hComp = e.competitions[0].competitors.find(c => c.homeAway === 'home');
            const aComp = e.competitions[0].competitors.find(c => c.homeAway === 'away');
            const eHome = cleanName(hComp.team.displayName);
            const eAway = cleanName(aComp.team.displayName);
            return (eHome.includes(homeClean) || homeClean.includes(eHome)) && 
                   (eAway.includes(awayClean) || awayClean.includes(eAway));
        });

        if (espnMatch) {
            console.log(`  🎯 [ESPN] Match Found: ID ${espnMatch.id}. Fetching deep details...`);
            const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/summary?event=${espnMatch.id}`;
            const summaryRes = await axios.get(summaryUrl, { timeout: 8000 });
            const sData = summaryRes.data;

            let stats = [];
            if (sData.boxscore && sData.boxscore.teams) {
                const homeStats = sData.boxscore.teams[0];
                const awayStats = sData.boxscore.teams[1];
                const statKeys = ['possessionPct', 'shotsSummary', 'shotsOnTarget', 'foulsCommitted', 'wonCorners'];
                stats = statKeys.map(k => {
                    const hVal = homeStats.statistics?.find(s => s.name === k);
                    const aVal = awayStats.statistics?.find(s => s.name === k);
                    if (!hVal && !aVal) return null;
                    return { name: hVal?.label || k, home: hVal?.displayValue || "0", away: aVal?.displayValue || "0" };
                }).filter(s => s !== null);
            }

            let lineups = null;
            if (sData.rosters && sData.rosters.length >= 2) {
                lineups = {
                    home: {
                        formation: sData.rosters[0].formation || "N/A",
                        players: (sData.rosters[0].roster || []).map(r => ({ player: { name: r.athlete.displayName }, pos: r.position.name }))
                    },
                    away: {
                        formation: sData.rosters[1].formation || "N/A",
                        players: (sData.rosters[1].roster || []).map(r => ({ player: { name: r.athlete.displayName }, pos: r.position.name }))
                    }
                };
            }

            return { stats, lineups, espnId: espnMatch.id };
        }
    } catch (e) {
        console.warn(`  ⚠️  [ESPN] Search failed: ${e.message}`);
    }
    return null;
}

// ============================================
// CORE SYNC LOGIC
// ============================================

function mapMatch(m, deep = null, espnData = null) {
  const d = deep || {};
  const e = espnData || {};
  
  let events = [];
  const rawGoals = d.goals || m.goals_incidents || [];
  const rawBookings = d.bookings || [];
  rawGoals.forEach(g => {
    events.push({ type: 'GOAL', time: g.minute, playerName: g.scorer?.name || '', isHome: g.team?.id === m.homeTeam.id });
  });
  rawBookings.forEach(b => {
    events.push({ type: 'CARD', time: b.minute, playerName: b.player?.name || '', isHome: b.team?.id === m.homeTeam.id, cardColor: (b.card === 'RED_CARD') ? 'red' : 'yellow' });
  });

  return {
    fixture: {
      id: m.id,
      status: { short: m.status, elapsed: d.minute || m.minute || null },
      date: m.utcDate
    },
    teams: {
      home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
      away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
    },
    score: d.score || m.score,
    league: { name: m.competition.name, id: m.competition.code, logo: m.competition.emblem },
    events,
    statistics: e.stats || d.statistics || [],
    lineups: e.lineups || d.lineups || null,
    deepFetched: (deep !== null || espnData !== null),
    streamingLinks: [] 
  };
}

async function sync() {
  console.log(`🚀 [V7.0] SYNC START: ${new Date().toISOString()}`);
  
  const dStr = (d) => d.toISOString().split('T')[0];
  const now = new Date();
  const todayStr = dStr(now);
  const yesterdayStr = dStr(new Date(now.getTime() - 86400000));
  const tomorrowStr = dStr(new Date(now.getTime() + 86400000));

  try {
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom: yesterdayStr, dateTo: tomorrowStr, competitions: SUPPORTED_COMPETITIONS.join(',') }
    });
    
    const rawMatches = res.data.matches || [];
    console.log(`✅ Loaded ${rawMatches.length} matches from Football-Data.`);

    const processedMatches = [];

    for (const m of rawMatches) {
        let deepResult = null;
        let espnResult = null;
        const shouldDeep = ['IN_PLAY', 'PAUSED', 'HALFTIME', 'FINISHED'].includes(m.status);

        if (shouldDeep) {
            espnResult = await fetchESPNStats(m.competition.code, m.utcDate.split('T')[0], m);
        }
        processedMatches.push(mapMatch(m, deepResult, espnResult));
    }

    const groups = { yesterday: [], today: [], tomorrow: [] };
    processedMatches.forEach(pm => {
        const matchDate = pm.fixture.date.split('T')[0];
        if (matchDate === yesterdayStr) groups.yesterday.push(pm);
        else if (matchDate === todayStr) groups.today.push(pm);
        else if (matchDate === tomorrowStr) groups.tomorrow.push(pm);
    });

    const batch = db.batch();
    for (const [key, events] of Object.entries(groups)) {
        const payload = { events, lastUpdated: admin.firestore.FieldValue.serverTimestamp(), source: "V7.0_MULTI_SOURCE" };
        batch.set(db.collection('matches').doc(key), payload);
        
        const dateKey = (key === 'today' ? todayStr : (key === 'yesterday' ? yesterdayStr : tomorrowStr));
        batch.set(db.collection('matches').doc(dateKey), payload);
        
        const monthKey = dateKey.substring(0, 7);
        batch.set(db.collection('archive').doc(monthKey).collection('days').doc(dateKey), { events, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    await batch.commit();
    console.log("🔥 [V7.0] Sync Complete. Firestore Updated & Archived.");

  } catch (e) {
    console.error(`❌ V7.0 Sync Failed: ${e.message}`);
  }
  process.exit(0);
}

sync();
