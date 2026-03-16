const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();
const fsMod = require('fs');

// ============================================================
// CONFIGURATION V23.0 - DUAL UPDATE STRATEGY
// ============================================================
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL"];
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";

// ESPN league slug mapping
const LEAGUE_MAPPING_ESPN = {
  "PL":  "eng.1",
  "PD":  "esp.1",
  "BL1": "ger.1",
  "SA":  "ita.1",
  "FL1": "fra.1",
  "CL":  "uefa.champions"
};

// Use service-account.json from root
const serviceAccount = require('./service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();
const fs = admin.firestore();

// ─────────────────────────────────────────────────────────────
// FUZZY MATCHING (FOR ESPN LINEUP MAPPING)
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
  if (a.includes(b) || b.includes(a)) return true;
  for (let len = Math.min(a.length, b.length); len >= 4; len--) {
    for (let i = 0; i <= a.length - len; i++) {
        if (b.includes(a.substring(i, i + len))) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// ESPN LINEUP & STATS FETCHER
// ─────────────────────────────────────────────────────────────
async function fetchESPNStats(leagueCode, dateStr, homeTeamName, awayTeamName) {
  const espnLeague = LEAGUE_MAPPING_ESPN[leagueCode];
  if (!espnLeague) return null;

  try {
    const yyyymmdd = dateStr.replace(/-/g, '');
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/scoreboard?dates=${yyyymmdd}`;
    const sbRes = await axios.get(scoreboardUrl, { timeout: 8000 });
    const events = sbRes.data.events || [];

    let matchId = null;
    for (const e of events) {
      const comp = e.competitions?.[0];
      if (!comp) continue;
      const hComp = comp.competitors?.find(c => c.homeAway === 'home');
      const aComp = comp.competitors?.find(c => c.homeAway === 'away');
      if (fuzzyMatch(homeTeamName, hComp?.team?.name) && fuzzyMatch(awayTeamName, aComp?.team?.name)) {
        matchId = e.id;
        break;
      }
    }

    if (!matchId) return null;

    const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/summary?event=${matchId}`;
    const sumRes = await axios.get(summaryUrl, { timeout: 8000 });
    const sData = sumRes.data;

    // Map Stats
    let stats = [];
    if (sData.boxscore?.teams) {
      const wanted = ['possessionPct', 'shotsSummary', 'shotsOnTarget', 'foulsCommitted', 'wonCorners'];
      const hTeams = sData.boxscore.teams[0].statistics || [];
      const aTeams = sData.boxscore.teams[1].statistics || [];
      wanted.forEach(k => {
        const h = hTeams.find(s => s.name === k);
        const a = aTeams.find(s => s.name === k);
        if (h || a) stats.push({ name: h?.label || k, home: h?.displayValue || "0", away: a?.displayValue || "0" });
      });
    }

    // Map Lineups
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

    return { stats, lineups };
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// FOOTBALL-DATA BASIC FETCHER
// ─────────────────────────────────────────────────────────────
async function fetchMatchesForRange(dateFrom, dateTo) {
  try {
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom, dateTo },
      timeout: 15000
    });

    let matches = res.data.matches || [];
    
    // Filter by supported competitions in-memory
    matches = matches.filter(m => SUPPORTED_COMPETITIONS.includes(m.competition.code));

    return matches.map(m => {
      const homeName = m.homeTeam.shortName || m.homeTeam.name || '';
      const awayName = m.awayTeam.shortName || m.awayTeam.name || '';
      const isFinished = ["FINISHED", "AWARDED"].includes(m.status);

      let highlightsUrl = isFinished 
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${homeName} vs ${awayName} highlights`)}`
        : null;

      return {
        fixture: {
          id: m.id,
          status: { short: m.status, elapsed: m.minute || null },
          date: m.utcDate
        },
        league: { name: m.competition.name, id: m.competition.code, logo: m.competition.emblem },
        teams: {
          home: { name: homeName, logo: m.homeTeam.crest },
          away: { name: awayName, logo: m.awayTeam.crest }
        },
        goals: { home: m.score.fullTime.home, away: m.score.fullTime.away },
        score: { fullTime: m.score.fullTime },
        highlights: highlightsUrl ? { url: highlightsUrl, isFallback: true } : null,
        broadcasters: isFinished ? null : "beIN Sports HD" 
      };
    });
  } catch (e) {
    if (e.response) {
      console.error(`Fetch Error: Status ${e.response.status} | Data: ${JSON.stringify(e.response.data)}`);
    } else {
      console.error(`Fetch Error: ${e.message}`);
    }
    return null; 
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────
async function run() {
  const now = new Date();
  const minutes = now.getMinutes();
  const shouldFetchLineups = [0, 20, 40].includes(minutes);
  
  console.log(`🚀 Kora Live Engine V23 | Time: ${now.toISOString()} | Lineup Sync: ${shouldFetchLineups}`);

  const dateStr = now.toISOString().split('T')[0];
  const newMatches = await fetchMatchesForRange(dateStr, dateStr);
  if (!newMatches) process.exit(1);

  // 1. Recover existing lineups from Firestore to avoid flickering
  const docRef = fs.collection('matches').doc('today');
  const oldDoc = await docRef.get();
  const oldMatches = oldDoc.exists ? oldDoc.data().events || [] : [];

  for (let m of newMatches) {
    const isLive = ["IN_PLAY", "PAUSED", "HALFTIME", "LIVE"].includes(m.fixture.status.short);
    
    // Find matching old records
    const oldMatch = oldMatches.find(om => String(om.fixture.id) === String(m.fixture.id));

    if (isLive && shouldFetchLineups) {
      console.log(`📡 Fetching Deep Stats for: ${m.teams.home.name} vs ${m.teams.away.name}`);
      const deepData = await fetchESPNStats(m.league.id, dateStr, m.teams.home.name, m.teams.away.name);
      if (deepData) {
        m.lineups = deepData.lineups || null;
        m.statistics = deepData.stats || [];
      } else if (oldMatch) {
         // Fallback to old if ESPN fails
         m.lineups = oldMatch.lineups || null;
         m.statistics = oldMatch.statistics || [];
      }
    } else if (oldMatch) {
      // Preserve lineups during 2-min "score only" updates
      m.lineups = oldMatch.lineups || null;
      m.statistics = oldMatch.statistics || [];
    }
  }

  // 2. Update Firestore and Realtime Database
  await docRef.set({ 
    events: newMatches, 
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    version: "23.0"
  });

  await db.ref("/live_matches").set({ 
    events: newMatches, 
    lastUpdated: Date.now() 
  });

  console.log(`✅ Successfully Updated ${newMatches.length} matches (Lineups: ${shouldFetchLineups}).`);
  process.exit(0);
}

run();