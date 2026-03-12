const admin = require('firebase-admin');
const axios = require('axios');
const fsMod = require('fs');

// ============================================================
// SYNC SCRIPT V11.1 — Multi-Source (Football-Data + ESPN)
// Coverage: Major Leagues + CL + EL + Conference League
// ============================================================

// Expanded to catch all available free-tier competitions + Conference League
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "EC", "ELC", "DED", "PPL", "BSA", "CLI"];
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";

// ESPN league slug mapping
const LEAGUE_MAPPING_ESPN = {
  "PL":  "eng.1",
  "PD":  "esp.1",
  "BL1": "ger.1",
  "SA":  "ita.1",
  "FL1": "fra.1",
  "CL":  "uefa.champions",
  "EL":  "uefa.europa",
  "EC":  "uefa.conf",
  "ELC": "eng.2",
  "DED": "ned.1",
  "PPL": "por.1",
  "BSA": "bra.1",
  "CLI": "conmebol.libertadores",
};

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./football_live_score_web/functions/service-account.json.json')) {
  serviceAccount = require('./football_live_score_web/functions/service-account.json.json');
} else {
  console.error("❌ Missing FIREBASE_SERVICE_ACCOUNT.");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// IMPROVED FUZZY NAME MATCHING  
// ─────────────────────────────────────────────────────────────
function normName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/\bfc\b|\bcf\b|\bafc\b|\bsc\b|\bac\b|\bss\b|\bas\b|\bfk\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function fuzzyMatch(nameA, nameB) {
  const a = normName(nameA);
  const b = normName(nameB);
  if (!a || !b) return false;
  // Direct containment
  if (a.includes(b) || b.includes(a)) return true;
  // Longest common substring ≥ 4 chars
  for (let len = Math.min(a.length, b.length); len >= 4; len--) {
    for (let i = 0; i <= a.length - len; i++) {
      if (b.includes(a.substring(i, i + len))) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// ESPN DATA FETCHER
// ─────────────────────────────────────────────────────────────
async function fetchESPNMatchDeep(espnLeague, espnMatchId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/summary?event=${espnMatchId}`;
    const res = await axios.get(url, { timeout: 8000 });
    const sData = res.data;

    // Stats
    let stats = [];
    if (sData.boxscore && sData.boxscore.teams && sData.boxscore.teams.length >= 2) {
      const homeStatsArr = sData.boxscore.teams[0].statistics || [];
      const awayStatsArr = sData.boxscore.teams[1].statistics || [];
      const wantedKeys = ['possessionPct', 'shotsSummary', 'shotsOnTarget', 'foulsCommitted', 'wonCorners', 'offsides', 'saves'];
      wantedKeys.forEach(k => {
        const h = homeStatsArr.find(s => s.name === k);
        const a = awayStatsArr.find(s => s.name === k);
        if (h || a) {
          stats.push({ name: h?.label || k, home: h?.displayValue || "0", away: a?.displayValue || "0" });
        }
      });
    }

    // Lineups from rosters
    let lineups = null;
    if (sData.rosters && sData.rosters.length >= 2) {
      const mapRoster = (r) => ({
        formation: r.formation || "N/A",
        players: (r.roster || []).filter(p => p.starter).map(p => ({
          player: { name: p.athlete?.displayName || "" },
          pos: p.position?.abbreviation || ""
        })),
        bench: (r.roster || []).filter(p => !p.starter).slice(0, 9).map(p => ({
          player: { name: p.athlete?.displayName || "" },
          pos: p.position?.abbreviation || ""
        }))
      });
      lineups = { home: mapRoster(sData.rosters[0]), away: mapRoster(sData.rosters[1]) };
    }

    return { stats, lineups, espnId: espnMatchId };
  } catch(e) {
    console.warn(`    ⚠️  ESPN deep fetch failed for event ${espnMatchId}: ${e.message}`);
    return null;
  }
}

async function fetchESPNStats(leagueCode, dateStr, homeTeamName, awayTeamName) {
  const espnLeague = LEAGUE_MAPPING_ESPN[leagueCode];
  if (!espnLeague) return null;

  try {
    const yyyymmdd = dateStr.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/scoreboard?dates=${yyyymmdd}`;
    const res = await axios.get(url, { timeout: 8000 });
    const events = res.data.events || [];

    let espnMatch = null;
    for (const e of events) {
      const comp = e.competitions?.[0];
      if (!comp) continue;
      const hComp = comp.competitors?.find(c => c.homeAway === 'home');
      const aComp = comp.competitors?.find(c => c.homeAway === 'away');
      const eHome = hComp?.team?.displayName || hComp?.team?.name || "";
      const eAway = aComp?.team?.displayName || aComp?.team?.name || "";
      if (fuzzyMatch(homeTeamName, eHome) && fuzzyMatch(awayTeamName, eAway)) {
        espnMatch = e;
        break;
      }
    }

    if (!espnMatch) return null;
    console.log(`    🎯 [ESPN] Match: ${espnMatch.name} (ID: ${espnMatch.id})`);
    return await fetchESPNMatchDeep(espnLeague, espnMatch.id);
  } catch(e) {
    console.warn(`    ⚠️  [ESPN] Scoreboard fetch failed for ${leagueCode}/${dateStr}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// MAP MATCH DATA
// ─────────────────────────────────────────────────────────────
function mapMatch(m, espnData = null) {
  const score = m.score || {};
  const events = [];

  // Goals
  (m.goals_incidents || []).forEach(g => {
    events.push({ type: 'GOAL', time: g.minute, playerName: g.scorer?.name || '', isHome: g.team?.id === m.homeTeam.id });
  });
  // Bookings
  (m.bookings || []).forEach(b => {
    events.push({ type: b.card || 'YELLOW_CARD', time: b.minute, playerName: b.player?.name || '', isHome: b.team?.id === m.homeTeam.id, cardColor: b.card === 'RED_CARD' ? 'red' : 'yellow' });
  });

  return {
    fixture: {
      id: m.id,
      status: { short: m.status, elapsed: m.minute || null },
      date: m.utcDate,
    },
    teams: {
      home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
      away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
    },
    score: { fullTime: score.fullTime || { home: null, away: null } },
    goals: { home: score.fullTime?.home ?? null, away: score.fullTime?.away ?? null },
    league: { name: m.competition.name, id: m.competition.code, logo: m.competition.emblem },
    events,
    statistics: espnData?.stats || [],
    lineups: espnData?.lineups || null,
    deepFetched: !!espnData,
    streamingLinks: []
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN SYNC
// ─────────────────────────────────────────────────────────────
async function sync() {
  console.log(`\n🚀 [V8.0] SYNC START: ${new Date().toISOString()}`);
  
  const dStr = (d) => d.toISOString().split('T')[0];
  const now = new Date();
  const todayStr     = dStr(now);
  const yesterdayStr = dStr(new Date(now.getTime() - 86400000));
  const tomorrowStr  = dStr(new Date(now.getTime() + 86400000));

  // Extend range to ensure we don't miss timezone-shifted matches
  const dateFrom = dStr(new Date(now.getTime() - 86400000 * 2));
  const dateTo   = dStr(new Date(now.getTime() + 86400000 * 2));

  try {
    // ── STEP 1: Fetch from Football-Data ──────────────────────
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom, dateTo } // No competition filter = get everything available
    });
    
    const rawMatches = res.data.matches || [];
    console.log(`✅ Football-Data returned ${rawMatches.length} matches (${dateFrom} → ${dateTo})`);
    
    // Group by our classification
    const byDate = { yesterday: [], today: [], tomorrow: [] };
    rawMatches.forEach(m => {
      const d = m.utcDate.split('T')[0];
      if (d === yesterdayStr) byDate.yesterday.push(m);
      else if (d === todayStr) byDate.today.push(m);
      else if (d === tomorrowStr) byDate.tomorrow.push(m);
    });
    console.log(`  📅 Yesterday: ${byDate.yesterday.length} | Today: ${byDate.today.length} | Tomorrow: ${byDate.tomorrow.length}`);

    // ── STEP 2: For finished/live, enrich with ESPN ───────────
    const processGroup = async (matches, label) => {
      console.log(`\n  🔄 Processing [${label}] – ${matches.length} matches`);
      const processed = [];
      for (const m of matches) {
        const needsDeep = ['FINISHED', 'IN_PLAY', 'PAUSED', 'HALFTIME'].includes(m.status);
        let espnData = null;
        if (needsDeep) {
          console.log(`  🔍 [ESPN] ${m.homeTeam.name} vs ${m.awayTeam.name}...`);
          espnData = await fetchESPNStats(
            m.competition.code,
            m.utcDate.split('T')[0],
            m.homeTeam.name,
            m.awayTeam.name
          );
          await delay(300); // small delay to be polite to ESPN
        }
        processed.push(mapMatch(m, espnData));
      }
      return processed;
    };

    const [yEvents, tEvents, tmEvents] = await Promise.all([
      processGroup(byDate.yesterday, "Yesterday"),
      processGroup(byDate.today,     "Today"),
      processGroup(byDate.tomorrow,  "Tomorrow")
    ]);

    // ── STEP 3: Write to Firestore ────────────────────────────
    const batch1 = db.batch();
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const setDoc = (key, events, dateStr) => {
      const payload = { events, lastUpdated: ts, source: "V8.0_AUTO" };
      batch1.set(db.collection('matches').doc(key), payload);
      batch1.set(db.collection('matches').doc(dateStr), payload);
      // Monthly Archive
      const month = dateStr.substring(0, 7);
      batch1.set(db.collection('archive').doc(month).collection('days').doc(dateStr), {
        events, createdAt: ts
      }, { merge: true });
    };

    setDoc('yesterday', yEvents, yesterdayStr);
    setDoc('today',     tEvents, todayStr);
    setDoc('tomorrow',  tmEvents, tomorrowStr);

    await batch1.commit();
    console.log(`\n✅ [V8.0] Sync Complete!`);
    console.log(`   Yesterday: ${yEvents.length} matches | ESPN deep: ${yEvents.filter(e=>e.deepFetched).length}`);
    console.log(`   Today:     ${tEvents.length} matches | ESPN deep: ${tEvents.filter(e=>e.deepFetched).length}`);
    console.log(`   Tomorrow:  ${tmEvents.length} matches`);

    // Verify stats on at least 1 match
    const withStats = [...yEvents, ...tEvents].find(e => e.statistics?.length > 0);
    if (withStats) {
      console.log(`\n📊 Sample Stats for: ${withStats.teams.home.name} vs ${withStats.teams.away.name}`);
      withStats.statistics.slice(0, 3).forEach(s => console.log(`   ${s.name}: ${s.home} - ${s.away}`));
    } else {
      console.log(`\n⚠️  No ESPN stats found (matches may not be in ESPN coverage)`);
    }

  } catch(e) {
    console.error(`❌ Sync Failed: ${e.message}`);
    if (e.response) console.error(`   HTTP ${e.response.status}:`, JSON.stringify(e.response.data).slice(0, 200));
    process.exit(1);
  }
  process.exit(0);
}

sync();
