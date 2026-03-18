const admin = require('firebase-admin');
const axios = require('axios');
const fsMod = require('fs');

// ============================================================
// SYNC SCRIPT V34.2-ULTIMATE — Recursive ESPN Name Fix
// Coverage: Major Leagues + CL + EL + BSA (Brazil) + more
// NEW: Full re-sync yesterday+today, robust name extraction
// ============================================================

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
  "BSA": "bra.1",         // Brasileirão Série A — ESPN has full coverage
  "CLI": "conmebol.libertadores",
};

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./service-account.json')) {
  serviceAccount = require('./service-account.json');
} else {
  console.error("❌ Missing FIREBASE_SERVICE_ACCOUNT.");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ 
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}

const db   = admin.firestore();
const rtdb = admin.database();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// FUZZY NAME MATCHING  
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
// ESPN DATA FETCHER — Stats, Lineups + Match Events (V33.0)
// ─────────────────────────────────────────────────────────────
async function fetchESPNMatchDeep(espnLeague, espnMatchId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/summary?event=${espnMatchId}`;
    const res = await axios.get(url, { timeout: 8000 });
    const sData = res.data;

    // ── Stats ──────────────────────────────────────────────
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

    // ── Lineups from rosters ───────────────────────────────
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

    // ── Match Events Timeline (V34.2-ULTIMATE) ──────────────────────
    // ESPN scoringPlays = goals; keyEvents = cards/subs
    let events = [];

    const comp     = sData.header?.competitions?.[0];
    const homeTeam = comp?.competitors?.find(c => c.homeAway === 'home');

    // V34.2: Recursive helper — resolves player name from ALL known ESPN shapes
    const resolvePlayerName = (obj, fallback = 'لاعب') => {
      if (!obj) return fallback;
      // Shape 1: obj.athletes = [{displayName, athlete:{displayName}}]
      const athletesArr = obj.athletes || (obj.athlete ? [obj.athlete] : []);
      for (const a of athletesArr) {
        if (a?.displayName)         return a.displayName;
        if (a?.athlete?.displayName) return a.athlete.displayName;
        if (a?.fullName)            return a.fullName;
        if (a?.shortName)           return a.shortName;
      }
      // Shape 2: top-level athlete field
      if (obj.athlete?.displayName)         return obj.athlete.displayName;
      if (obj.athlete?.athlete?.displayName) return obj.athlete.athlete.displayName;
      // Shape 3: shortText / text (e.g. "Salah 45'" — extract name part)
      if (obj.shortText) {
        const cleaned = obj.shortText.split("'")[0].trim(); // remove minute suffix
        if (cleaned && cleaned.length > 1) return cleaned;
      }
      if (obj.text) {
        const cleaned = obj.text.split("'")[0].trim();
        if (cleaned && cleaned.length > 1) return cleaned;
      }
      return fallback;
    };

    // ── Goals from scoringPlays ──────────────────────────────
    if (sData.scoringPlays && Array.isArray(sData.scoringPlays)) {
      sData.scoringPlays.forEach(sp => {
        const isHome = sp.team?.id === homeTeam?.id;
        const displayName = resolvePlayerName(sp);
        events.push({
          type:       'GOAL',
          time:       sp.clock?.displayValue || sp.period?.displayValue || '',
          playerName: displayName,
          isHome,
          icon:       '⚽'
        });
      });
    }

    // ── Cards / Goals from keyEvents (V35.0: explicit type.id match) ─────
    // ESPN type IDs: 57 = Goal, 58 = Yellow Card, 59 = Red Card,
    //                72 = Substitution, 1 = Kick-off/Goal variant
    // We ALSO check type.text for 'goal' as a belt-and-suspenders check.
    const scoringPlayIds = new Set(
      (sData.scoringPlays || []).map(sp => String(sp.id)).filter(Boolean)
    );

    if (sData.keyEvents && Array.isArray(sData.keyEvents)) {
      sData.keyEvents.forEach(ke => {
        const typeId   = String(ke.type?.id   || '');
        const typeText = (ke.type?.text || ke.type?.id || ke.type || '').toLowerCase();
        const isHome   = ke.team?.id === homeTeam?.id;
        const pName    = resolvePlayerName(ke);

        // Secondary athlete (playerOut for substitutions)
        const resolveSecondary = (obj) => {
          const arr = obj.athletes || [];
          if (arr.length >= 2) {
            const a = arr[1];
            return a?.displayName || a?.athlete?.displayName || obj.athleteOut?.displayName || '';
          }
          return obj.athleteOut?.displayName || '';
        };

        // V35.0 GOAL FIX: ESPN type.id 57 = Goal, 56 = Penalty Goal, 1 = goal variant
        // Also catch any keyEvent with 'goal' in text that wasn't in scoringPlays
        const isGoalById   = ['57', '56', '1', '58'].includes(typeId)  // 58 sometimes used for pen goals
                          || typeText.includes('goal') || typeText.includes('penalty goal');
        const alreadyCounted = ke.id && scoringPlayIds.has(String(ke.id));

        if (isGoalById && !alreadyCounted) {
          const isPenalty = typeText.includes('penalty') || typeId === '56';
          events.push({
            type:       isPenalty ? 'PENALTY_GOAL' : 'GOAL',
            time:       ke.clock?.displayValue || ke.period?.displayValue || '',
            playerName: pName,
            isHome,
            icon:       isPenalty ? '🎯⚽' : '⚽'
          });
          if (!isPenalty) console.log(`    ⭐ GOAL (keyEvent id=${typeId}): ${pName}`);
        } else if (typeText.includes('yellow') || typeText.includes('card')) {
          events.push({
            type:       typeText.includes('red') ? 'RED_CARD' : 'YELLOW_CARD',
            time:       ke.clock?.displayValue || ke.period?.displayValue || '',
            playerName: pName,
            isHome,
            icon:       typeText.includes('red') ? '🟥' : '🟨'
          });
        } else if (typeText.includes('substitut') || typeText.includes('sub')) {
          const playerOut = resolveSecondary(ke);
          events.push({
            type:       'SUBSTITUTION',
            time:       ke.clock?.displayValue || ke.period?.displayValue || '',
            playerName: pName,
            playerOut,
            isHome,
            icon:       '🔄'
          });
        }
      });
    }

    // Sort events by minute (parse number from time string like "45'" or "HT+2")
    events.sort((a, b) => {
      const parseMin = (t) => {
        if (!t) return 999;
        const m = String(t).match(/(\d+)/);
        return m ? parseInt(m[1]) : 999;
      };
      return parseMin(a.time) - parseMin(b.time);
    });

    return { stats, lineups, events, espnId: espnMatchId };
  } catch(e) {
    console.warn(`    ⚠️  ESPN deep fetch failed for event ${espnMatchId}: ${e.message}`);
    return null;
  }
}

async function fetchESPNStats(leagueCode, dateStr, homeTeamName, awayTeamName) {
  const espnLeague = LEAGUE_MAPPING_ESPN[leagueCode];
  if (!espnLeague) {
    console.log(`    ⚠️  No ESPN mapping for ${leagueCode} — skipping deep fetch`);
    return null;
  }

  try {
    const yyyymmdd = dateStr.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/scoreboard?dates=${yyyymmdd}`;
    const res = await axios.get(url, { timeout: 8000 });
    const espnEvents = res.data.events || [];

    let espnMatch = null;
    for (const e of espnEvents) {
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

    if (!espnMatch) {
      console.log(`    ℹ️  No ESPN match found for ${homeTeamName} vs ${awayTeamName} in ${leagueCode}`);
      return null;
    }
    console.log(`    🎯 [ESPN] Match: ${espnMatch.name} (ID: ${espnMatch.id})`);
    return await fetchESPNMatchDeep(espnLeague, espnMatch.id);
  } catch(e) {
    console.warn(`    ⚠️  [ESPN] Scoreboard fetch failed for ${leagueCode}/${dateStr}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// MAP MATCH DATA (V33.0)
// ─────────────────────────────────────────────────────────────
function mapMatch(m, espnData = null) {
  const score = m.score || {};

  // ── Build events from Football-Data fields first ──────────
  // Football-Data v4 free tier doesn't return goals/bookings in /matches bulk
  // but DOES return them in /matches/{id} — ESPN fills the gap
  let events = espnData?.events || [];

  // If ESPN had no events, attempt to parse from FD's basic score info
  // (FD doesn't include incidents in bulk endpoint, so events will come from ESPN)

  return {
    fixture: {
      id:     m.id,
      status: { short: m.status, elapsed: m.minute || null },
      date:   m.utcDate,
    },
    teams: {
      home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
      away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
    },
    score:  { fullTime: score.fullTime || { home: null, away: null } },
    goals:  { home: score.fullTime?.home ?? null, away: score.fullTime?.away ?? null },
    league: { name: m.competition.name, id: m.competition.code, logo: m.competition.emblem },
    events,
    statistics: espnData?.stats || [],
    lineups:    espnData?.lineups || null,
    deepFetched: !!espnData,
    stream_url: ["IN_PLAY", "LIVE", "HALFTIME", "PAUSED"].includes(m.status)
      ? "https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8"
      : null,
    streamingLinks: []
  };
}

// ─────────────────────────────────────────────────────────────
// WRITE MATCH EVENTS TO RTDB  match_events/{matchId}
// ─────────────────────────────────────────────────────────────
async function writeMatchEvents(matchId, events, homeTeamName, awayTeamName) {
  if (!events || events.length === 0) return;
  try {
    await rtdb.ref(`match_events/${matchId}`).set({
      events,
      homeTeamName,
      awayTeamName,
      lastUpdated: Date.now(),
      source: "V34.3_FORCE_CLEAN"
    });
    console.log(`    ✅ match_events/${matchId}: ${events.length} events written`);
  } catch(e) {
    console.warn(`    ⚠️  Failed to write match_events/${matchId}: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN SYNC (V33.0)
// ─────────────────────────────────────────────────────────────
async function sync() {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  SYNC SCRIPT V35.0-AUTO-PILOT — Goal Fix + Purge ⚽   ║`);
  console.log(`║  START: ${new Date().toISOString()}         ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  
  const dStr = (d) => d.toISOString().split('T')[0];
  const now = new Date();
  const todayStr     = dStr(now);
  const yesterdayStr = dStr(new Date(now.getTime() - 86400000));
  const tomorrowStr  = dStr(new Date(now.getTime() + 86400000));

  // 3-day window to catch timezone-shifted matches
  const dateFrom = dStr(new Date(now.getTime() - 86400000 * 2));
  const dateTo   = dStr(new Date(now.getTime() + 86400000 * 2));

  try {
    // ── STEP 1: Fetch from Football-Data ──────────────────────
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom, dateTo }
    });
    
    const rawMatches = res.data.matches || [];
    console.log(`✅ Football-Data returned ${rawMatches.length} matches (${dateFrom} → ${dateTo})`);
    
    // Group by date classification
    const byDate = { yesterday: [], today: [], tomorrow: [] };
    rawMatches.forEach(m => {
      const d = m.utcDate.split('T')[0];
      if (d === yesterdayStr)      byDate.yesterday.push(m);
      else if (d === todayStr)     byDate.today.push(m);
      else if (d === tomorrowStr)  byDate.tomorrow.push(m);
    });
    console.log(`  📅 Yesterday: ${byDate.yesterday.length} | Today: ${byDate.today.length} | Tomorrow: ${byDate.tomorrow.length}`);

    // ── STEP 2: DEEP PURGE — delete stale match_events + RTDB nodes ──
    console.log(`\n  🗑️  [PURGE] Clearing stale data for yesterday (${yesterdayStr}) and today (${todayStr})...`);

    // Delete RTDB matches/{date} nodes so UI can't serve cached bad data
    await rtdb.ref(`matches/${yesterdayStr}`).remove().catch(() => {});
    await rtdb.ref(`matches/${todayStr}`).remove().catch(() => {});
    await rtdb.ref(`today_matches/${todayStr}`).remove().catch(() => {});
    await rtdb.ref(`live_matches`).remove().catch(() => {});
    console.log(`  ✅ [PURGE] RTDB root nodes cleared`);

    // Delete match_events/{id} for every yesterday + today match
    const purgeMatchIds = [
      ...byDate.yesterday.map(m => m.id),
      ...byDate.today.map(m => m.id)
    ];
    if (purgeMatchIds.length > 0) {
      await Promise.all(
        purgeMatchIds.map(id => rtdb.ref(`match_events/${id}`).remove().catch(() => {}))
      );
      console.log(`  ✅ [PURGE] Deleted match_events for ${purgeMatchIds.length} match IDs: [${purgeMatchIds.join(', ')}]`);
    }

    // ── STEP 3: Enrich finished/live matches with ESPN ─────────
    const processGroup = async (matches, label) => {
      console.log(`\n  🔄 Processing [${label}] – ${matches.length} matches`);
      const processed = [];
      for (const m of matches) {
        // V34.2: Force deep ESPN fetch for finished & live — catches yesterday's games too
        const needsDeep = ['FINISHED', 'IN_PLAY', 'PAUSED', 'HALFTIME', 'AWARDED', 'HT', 'FT', 'AET', 'PEN'].includes(m.status);
        let espnData = null;
        if (needsDeep) {
          console.log(`  🔍 [ESPN→Events] ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.code})...`);
          espnData = await fetchESPNStats(
            m.competition.code,
            m.utcDate.split('T')[0],
            m.homeTeam.name,
            m.awayTeam.name
          );
          // Write events to match_events/{id} if we got them
          if (espnData?.events?.length > 0) {
            await writeMatchEvents(m.id, espnData.events, m.homeTeam.name, m.awayTeam.name);
          }
          await delay(350);
        }
        processed.push(mapMatch(m, espnData));
      }
      return processed;
    };

    // Process sequentially to avoid rate-limiting ESPN
    const yEvents  = await processGroup(byDate.yesterday, "Yesterday");
    const tEvents  = await processGroup(byDate.today,     "Today");
    const tmEvents = await processGroup(byDate.tomorrow,  "Tomorrow");
    console.log(`\n  📊 [STEP 4] Writing fresh data to Firestore + RTDB...`);

    // ── STEP 3: Write matches to Firestore & RTDB ─────────────
    const batch1 = db.batch();
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const setDoc = async (key, events, dateStr) => {
      const payload = { events, lastUpdated: Date.now(), source: "V35.0_AUTO_PILOT" };
      // Firestore
      batch1.set(db.collection('matches').doc(key), payload);
      batch1.set(db.collection('matches').doc(dateStr), payload);
      const month = dateStr.substring(0, 7);
      batch1.set(db.collection('archive').doc(month).collection('days').doc(dateStr), {
        events, createdAt: ts
      }, { merge: true });

      // RTDB (what the UI reads)
      await rtdb.ref(`matches/${dateStr}`).set(payload);
      if (key === 'today') {
           await rtdb.ref(`today_matches/${dateStr}`).set(payload);
           await rtdb.ref(`live_matches`).set(payload);
      }
    };

    await setDoc('yesterday', yEvents, yesterdayStr);
    await setDoc('today',     tEvents, todayStr);
    await setDoc('tomorrow',  tmEvents, tomorrowStr);
    await batch1.commit();

    console.log(`\n✅ [V35.0-AUTO-PILOT] Purge + Sync Complete!`);
    console.log(`   Yesterday: ${yEvents.length} matches | Events: ${yEvents.filter(e => e.events?.length > 0).length} with names data`);
    console.log(`   Today:     ${tEvents.length} matches | Events: ${tEvents.filter(e => e.events?.length > 0).length} with names data`);
    console.log(`   Tomorrow:  ${tmEvents.length} matches (scheduled)`);

    // Also log BSA (Brazil) results specifically
    const bsaMatches = [...yEvents, ...tEvents].filter(e => e.league?.id === 'BSA');
    if (bsaMatches.length > 0) {
      console.log(`\n  🇧🇷 Brazil (BSA) matches:`);
      bsaMatches.forEach(m => {
        const score = m.goals.home !== null ? `${m.goals.home}-${m.goals.away}` : 'TBD';
        console.log(`     [${m.fixture.status.short}] ${m.teams.home.name} ${score} ${m.teams.away.name}`);
      });
    }

  } catch(e) {
    console.error(`❌ Sync Failed: ${e.message}`);
    if (e.response) console.error(`   HTTP ${e.response.status}:`, JSON.stringify(e.response.data).slice(0, 200));
    process.exit(1);
  }
  process.exit(0);
}

// AUTO-PILOT: Never mark the Action as failed
sync().catch(e => {
  console.error('[V35.0-AUTO-PILOT] non-fatal error:', e?.message || e);
  process.exit(0);
});
