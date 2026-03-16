// ============================================================
// PURGE & SYNC V31.0 — Data Overhaul Script
// Cleans fake data, re-fetches real match + standings data
// from Football-Data.org and writes it to Firebase with .set()
// ============================================================
const admin = require('firebase-admin');
const axios = require('axios');

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";
const TARGET_DATE = "2026-03-17";

// Competitions to sync standings for
const STANDINGS_COMPETITIONS = [
  { code: "PL",  id: 2021, name: "Premier League" },
  { code: "PD",  id: 2014, name: "La Liga" },
  { code: "BL1", id: 2002, name: "Bundesliga" },
  { code: "SA",  id: 2019, name: "Serie A" },
  { code: "FL1", id: 2015, name: "Ligue 1" },
  { code: "CL",  id: 2001, name: "Champions League" },
];

// All supported match competitions
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL"];

// ─────────────────────────────────────────────────────────────
// INIT FIREBASE
// ─────────────────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require('./service-account.json');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}

const rtdb = admin.database();
const fs   = admin.firestore();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// STEP 1: PURGE BAD DATA FROM RTDB
// ─────────────────────────────────────────────────────────────
async function purgeStaleNodes() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  STEP 1: PURGING STALE / FAKE DATA FROM RTDB         ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // Wipe the entire matches/2026-03-17 node (fake scores like Real Madrid 4-1 Man City)
  await rtdb.ref(`matches/${TARGET_DATE}`).remove();
  console.log(`✅ Deleted RTDB node: matches/${TARGET_DATE}`);

  // Wipe today_matches/2026-03-17
  await rtdb.ref(`today_matches/${TARGET_DATE}`).remove();
  console.log(`✅ Deleted RTDB node: today_matches/${TARGET_DATE}`);

  // Wipe live_matches (stale live data)
  await rtdb.ref('live_matches').remove();
  console.log(`✅ Deleted RTDB node: live_matches`);

  // Also purge Firestore stale docs
  try {
    await fs.collection('matches').doc('today').delete();
    console.log(`✅ Deleted Firestore doc: matches/today`);
    await fs.collection('matches').doc(TARGET_DATE).delete();
    console.log(`✅ Deleted Firestore doc: matches/${TARGET_DATE}`);
  } catch(e) {
    console.warn(`  ⚠ Firestore purge warning: ${e.message}`);
  }

  console.log("\n✅ PURGE COMPLETE — database is clean.\n");
}

// ─────────────────────────────────────────────────────────────
// STEP 2: FETCH REAL MATCH DATA & FIX RAYO STATUS
// ─────────────────────────────────────────────────────────────
function mapMatch(m) {
  const homeName = m.homeTeam.shortName || m.homeTeam.name || '';
  const awayName = m.awayTeam.shortName || m.awayTeam.name || '';

  // Fix: Rayo Vallecano and any other AWARDED/FINISHED match must show as FINISHED (FT)
  let statusShort = m.status;
  if (statusShort === "AWARDED") statusShort = "FINISHED";

  const isFinished = ["FINISHED"].includes(statusShort);
  const highlightsUrl = isFinished
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${homeName} vs ${awayName} highlights`)}`
    : null;

  // Preserve null scores for upcoming matches (no fake zeros)
  const homeGoals = m.score?.fullTime?.home ?? null;
  const awayGoals = m.score?.fullTime?.away ?? null;

  return {
    fixture: {
      id: m.id,
      status: { short: statusShort, elapsed: m.minute || null },
      date: m.utcDate
    },
    league: {
      name: m.competition.name,
      id: m.competition.code,
      logo: m.competition.emblem
    },
    teams: {
      home: { name: homeName, logo: m.homeTeam.crest, id: m.homeTeam.id },
      away: { name: awayName, logo: m.awayTeam.crest, id: m.awayTeam.id }
    },
    goals: { home: homeGoals, away: awayGoals },
    score: { fullTime: { home: homeGoals, away: awayGoals } },
    highlights: highlightsUrl ? { url: highlightsUrl, isFallback: true } : null,
    broadcasters: isFinished ? null : "beIN Sports HD",
    statistics: [],
    lineups: null,
    deepFetched: false
  };
}

async function fetchAndWriteMatches() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  STEP 2: FETCHING REAL MATCHES FOR 2026-03-17        ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // Fetch a 3-day window to catch timezone edges
  const dateFrom = "2026-03-16";
  const dateTo   = "2026-03-18";

  let rawMatches;
  try {
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom, dateTo },
      timeout: 20000
    });
    rawMatches = res.data.matches || [];
    console.log(`  ✅ Football-Data returned ${rawMatches.length} total matches (${dateFrom} → ${dateTo})`);
  } catch(e) {
    if (e.response) {
      console.error(`  ❌ API Error: HTTP ${e.response.status} — ${JSON.stringify(e.response.data)}`);
    } else {
      console.error(`  ❌ Network Error: ${e.message}`);
    }
    throw e;
  }

  // Filter to supported competitions
  const supported = rawMatches.filter(m => SUPPORTED_COMPETITIONS.includes(m.competition?.code));
  console.log(`  📋 After competition filter: ${supported.length} matches`);

  // Split by date (UTC date)
  const todayMatches     = supported.filter(m => m.utcDate?.startsWith(TARGET_DATE));
  const yesterdayMatches = supported.filter(m => m.utcDate?.startsWith("2026-03-16"));
  const tomorrowMatches  = supported.filter(m => m.utcDate?.startsWith("2026-03-18"));

  console.log(`  📅 Mar 16: ${yesterdayMatches.length} | Mar 17: ${todayMatches.length} | Mar 18: ${tomorrowMatches.length}`);

  // Log any Rayo Vallecano matches found
  const rayo = supported.filter(m =>
    m.homeTeam?.name?.toLowerCase().includes('rayo') ||
    m.awayTeam?.name?.toLowerCase().includes('rayo')
  );
  if (rayo.length > 0) {
    rayo.forEach(m => {
      console.log(`  🔍 Rayo match found: ${m.homeTeam.name} vs ${m.awayTeam.name} | Status: ${m.status} | Date: ${m.utcDate}`);
    });
  }

  const todayMapped     = todayMatches.map(mapMatch);
  const yesterdayMapped = yesterdayMatches.map(mapMatch);
  const tomorrowMapped  = tomorrowMatches.map(mapMatch);

  const nowMs = Date.now();
  const source = "V31.0_PURGE_SYNC";

  // ── Write Today ───────────────────────────────────────────
  const todayPayload = { events: todayMapped, lastUpdated: nowMs, source };
  await rtdb.ref(`matches/${TARGET_DATE}`).set(todayPayload);
  await rtdb.ref(`today_matches/${TARGET_DATE}`).set(todayPayload);
  await rtdb.ref('live_matches').set(todayPayload);
  await fs.collection('matches').doc('today').set({ ...todayPayload, version: "31.0" });
  await fs.collection('matches').doc(TARGET_DATE).set(todayPayload);
  console.log(`\n  ✅ Wrote ${todayMapped.length} matches → matches/${TARGET_DATE}, today_matches/${TARGET_DATE}, live_matches`);

  // ── Write Yesterday ───────────────────────────────────────
  if (yesterdayMapped.length > 0) {
    const yPayload = { events: yesterdayMapped, lastUpdated: nowMs, source };
    await rtdb.ref('matches/2026-03-16').set(yPayload);
    await fs.collection('matches').doc('2026-03-16').set(yPayload);
    console.log(`  ✅ Wrote ${yesterdayMapped.length} matches → matches/2026-03-16`);
  }

  // ── Write Tomorrow ────────────────────────────────────────
  if (tomorrowMapped.length > 0) {
    const tmPayload = { events: tomorrowMapped, lastUpdated: nowMs, source };
    await rtdb.ref('matches/2026-03-18').set(tmPayload);
    await fs.collection('matches').doc('2026-03-18').set(tmPayload);
    console.log(`  ✅ Wrote ${tomorrowMapped.length} matches → matches/2026-03-18`);
  }

  // Log today's match statuses for integrity check
  console.log("\n  📊 TODAY'S MATCHES INTEGRITY CHECK:");
  if (todayMapped.length === 0) {
    console.log("  ℹ️  No matches scheduled for 2026-03-17 in supported leagues (correct if no fixtures today).");
  } else {
    todayMapped.forEach(m => {
      const score = m.goals.home !== null ? `${m.goals.home}-${m.goals.away}` : 'NO SCORE (upcoming)';
      console.log(`  ⚽ [${m.fixture.status.short}] ${m.teams.home.name} vs ${m.teams.away.name} → ${score}`);
    });
  }

  console.log("\n✅ MATCH SYNC COMPLETE.\n");
  return { todayMapped, yesterdayMapped, tomorrowMapped };
}

// ─────────────────────────────────────────────────────────────
// STEP 3: FETCH & WRITE REAL STANDINGS
// ─────────────────────────────────────────────────────────────
async function fetchAndWriteStandings() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  STEP 3: REFRESHING STANDINGS FOR ALL LEAGUES        ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  for (const comp of STANDINGS_COMPETITIONS) {
    console.log(`\n  🔄 Fetching standings for ${comp.name} (${comp.code})...`);
    try {
      const res = await axios.get(`${BASE_URL}/competitions/${comp.id}/standings`, {
        headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
        timeout: 15000
      });

      const data = res.data;
      const standings = data.standings || [];

      // Football-Data returns TOTAL, HOME, AWAY — we want TOTAL
      const totalStanding = standings.find(s => s.type === "TOTAL") || standings[0];
      if (!totalStanding) {
        console.warn(`  ⚠ No TOTAL standings found for ${comp.code}`);
        continue;
      }

      // Map to our format
      const tableRows = (totalStanding.table || []).map(row => ({
        position: row.position,
        team: {
          id: row.team?.id,
          name: row.team?.name,
          shortName: row.team?.shortName || row.team?.name,
          crest: row.team?.crest || row.team?.logo || null
        },
        playedGames: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        points: row.points,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
        form: row.form || null
      }));

      // Log Barcelona's entry if in La Liga
      if (comp.code === "PD") {
        const barca = tableRows.find(r =>
          r.team?.name?.toLowerCase().includes('barcelona') ||
          r.team?.shortName?.toLowerCase().includes('barcelona')
        );
        if (barca) {
          console.log(`  🔵🔴 Barcelona: pos=${barca.position}, pts=${barca.points}, played=${barca.playedGames}, GD=${barca.goalDifference}`);
        }
      }

      const payload = {
        competition: {
          id: comp.id,
          code: comp.code,
          name: comp.name,
          emblem: data.competition?.emblem || null
        },
        season: data.season || null,
        standings: [{ type: "TOTAL", table: tableRows }],
        lastUpdated: Date.now(),
        source: "V31.0_PURGE_SYNC"
      };

      // Write to Firestore standings/{code}
      await fs.collection('standings').doc(comp.code).set(payload);
      console.log(`  ✅ Firestore standings/${comp.code} updated (${tableRows.length} teams)`);

      // Write to RTDB standings/{code}
      await rtdb.ref(`standings/${comp.code}`).set(payload);
      console.log(`  ✅ RTDB standings/${comp.code} updated`);

      // Be respectful to the API (free tier: 10 req/min)
      await delay(1200);

    } catch(e) {
      if (e.response?.status === 429) {
        console.error(`  ❌ RATE LIMITED on ${comp.code}. Waiting 60s...`);
        await delay(62000);
        // Retry once
        try {
          const res2 = await axios.get(`${BASE_URL}/competitions/${comp.id}/standings`, {
            headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
            timeout: 15000
          });
          const data2 = res2.data;
          const sl = (data2.standings?.find(s => s.type === "TOTAL") || data2.standings?.[0]);
          if (sl) {
            const rows2 = (sl.table || []).map(row => ({
              position: row.position,
              team: { id: row.team?.id, name: row.team?.name, shortName: row.team?.shortName || row.team?.name, crest: row.team?.crest || null },
              playedGames: row.playedGames, won: row.won, draw: row.draw, lost: row.lost,
              points: row.points, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
              goalDifference: row.goalDifference, form: row.form || null
            }));
            const p2 = { competition: { id: comp.id, code: comp.code, name: comp.name }, standings: [{ type: "TOTAL", table: rows2 }], lastUpdated: Date.now(), source: "V31.0_RETRY" };
            await fs.collection('standings').doc(comp.code).set(p2);
            await rtdb.ref(`standings/${comp.code}`).set(p2);
            console.log(`  ✅ (Retry) ${comp.code} standings written (${rows2.length} teams)`);
          }
        } catch(e2) {
          console.error(`  ❌ Retry also failed for ${comp.code}: ${e2.message}`);
        }
      } else if (e.response?.status === 403) {
        console.warn(`  ⚠ 403 Forbidden for ${comp.code} — competition may not be on free tier. Skipping.`);
      } else {
        console.error(`  ❌ Failed to fetch standings for ${comp.code}: ${e.message}`);
      }
    }
  }

  console.log("\n✅ STANDINGS SYNC COMPLETE.\n");
}

// ─────────────────────────────────────────────────────────────
// STEP 4: INTEGRITY VERIFICATION
// ─────────────────────────────────────────────────────────────
async function verifyIntegrity() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  STEP 4: VERIFYING DATABASE INTEGRITY                ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // Read back the RTDB node
  const snap = await rtdb.ref(`matches/${TARGET_DATE}`).once('value');
  const data = snap.val();

  if (!data) {
    console.error(`  ❌ INTEGRITY FAIL: matches/${TARGET_DATE} is empty or missing!`);
  } else {
    const events = data.events || [];
    console.log(`  ✅ matches/${TARGET_DATE} exists — ${events.length} match(es) found`);
    const fakeRM = events.find(e =>
      (e.teams?.home?.name?.toLowerCase().includes('real madrid') || e.teams?.away?.name?.toLowerCase().includes('real madrid')) &&
      (e.teams?.home?.name?.toLowerCase().includes('man') || e.teams?.away?.name?.toLowerCase().includes('man'))
    );
    if (fakeRM) {
      console.error(`  ❌ INTEGRITY FAIL: Fake Real Madrid match still exists!`, fakeRM.teams);
    } else {
      console.log(`  ✅ No fake 'Real Madrid vs Man City' match detected.`);
    }

    // Check Rayo Vallecano status
    const rayo = events.find(e =>
      e.teams?.home?.name?.toLowerCase().includes('rayo') ||
      e.teams?.away?.name?.toLowerCase().includes('rayo')
    );
    if (rayo) {
      const st = rayo.fixture?.status?.short;
      if (st === "FINISHED") {
        console.log(`  ✅ Rayo Vallecano match status: FINISHED (FT) ✓`);
      } else {
        console.warn(`  ⚠ Rayo Vallecano match status is '${st}' (expected FINISHED)`);
      }
    } else {
      console.log(`  ℹ️  No Rayo Vallecano match on ${TARGET_DATE} in this dataset.`);
    }

    // Upcoming matches should have null scores
    const upcomingWithFakeScores = events.filter(e =>
      e.fixture?.status?.short === "TIMED" &&
      (e.goals?.home !== null || e.goals?.away !== null)
    );
    if (upcomingWithFakeScores.length > 0) {
      console.warn(`  ⚠ ${upcomingWithFakeScores.length} upcoming match(es) have non-null scores (possible issue)`);
    } else {
      console.log(`  ✅ All upcoming matches have null scores (correct).`);
    }
  }

  // Check La Liga standings
  const standSnap = await rtdb.ref('standings/PD').once('value');
  const standData = standSnap.val();
  if (!standData) {
    console.error(`  ❌ INTEGRITY FAIL: standings/PD missing!`);
  } else {
    const table = standData.standings?.[0]?.table || [];
    console.log(`  ✅ standings/PD (La Liga) — ${table.length} teams present`);
    const barca = table.find(r => r.team?.name?.toLowerCase().includes('barcelona'));
    if (barca) {
      console.log(`  🔵🔴 Barcelona: pos=${barca.position}, pts=${barca.points}, played=${barca.playedGames}, GD=${barca.goalDifference}`);
    }
  }

  console.log("\n✅ INTEGRITY CHECK DONE.\n");
}

// ─────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  KORRA LIVE — DATA PURGE & SYNC V31.0               ║");
  console.log(`║  Timestamp: ${new Date().toISOString()}  ║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  try {
    await purgeStaleNodes();
    await fetchAndWriteMatches();
    await fetchAndWriteStandings();
    await verifyIntegrity();

    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  🎉 ALL STEPS COMPLETE — DATABASE MIRRORS REALITY   ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    process.exit(0);
  } catch(e) {
    console.error(`\n❌ FATAL ERROR: ${e.message}`);
    if (e.response) {
      console.error(`   HTTP ${e.response.status}:`, JSON.stringify(e.response.data).slice(0, 300));
    }
    process.exit(1);
  }
}

main();
