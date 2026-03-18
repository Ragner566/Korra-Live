const admin = require('firebase-admin');
const axios  = require('axios');
const fsMod  = require('fs');

// ============================================================
// STREAM SCRAPER V41.0-CHAMPIONS-FINAL
// ─ ONLY sports-specific embed sources (no movie sites)
// ─ Content validation: GET page body, reject if it has movie
//   keywords and lacks sports keywords
// ─ URL filter: discard any URL without 'soccer|sport|match|
//   football|live|stream' in the path
// ─ Saves server1 / server2 / server3 in match_links/{matchId}
// ============================================================

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./service-account.json')) {
  serviceAccount = require('./service-account.json');
} else {
  console.error('❌ Missing FIREBASE_SERVICE_ACCOUNT.');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://korra-b5d32-default-rtdb.firebaseio.com'
  });
}

const rtdb  = admin.database();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const WINDOW_BEFORE_KICKOFF_MS = 30 * 60 * 1000;

// Sports-only keywords — URL MUST contain at least one
const SPORTS_PATH_KEYWORDS = [
  'soccer', 'football', 'sport', 'match', 'live', 'stream',
  'futbol', 'koora', 'kora', 'bein', 'ssc', 'biss'
];

// Movie/series keywords — page body must NOT be dominated by these
const MOVIE_DISCARD_KEYWORDS = [
  'tv-series', 'tvshows', 'tv_shows', 'movies/', '/movie/',
  'embed/tv', 'embedtvshow', 'season', 'episode',
  'watch movie', 'full movie', 'watch series'
];

// ─────────────────────────────────────────────────────────────
// Candidate URL builders — ONLY sports-specific paths
// The sites below are known sports streaming aggregators.
// ─────────────────────────────────────────────────────────────
function buildSportsCandidates(matchId, homeName, awayName, leagueId) {
  const h = encodeURIComponent(homeName);
  const a = encodeURIComponent(awayName);
  const q = encodeURIComponent(`${homeName} vs ${awayName} live`);

  return [
    // ── Tier 1: streamed.su — dedicated sports stream site (soccer section)
    // Uses its own slugs, but the /soccer/ root page works as a sports aggregator
    `https://streamed.su/watch/soccer`,

    // ── Tier 2: sportsurge sports embed (by team names)
    `https://sportsurge.net/embed/soccer/${h}-vs-${a}`,

    // ── Tier 3: livesoccertv — match lookup by team names (embeddable)
    `https://embed.sportowl.me/soccer/?home=${h}&away=${a}`,

    // ── Tier 4: sport-stream.live — UCL-aware embed
    `https://sport-stream.live/soccer/${h}-vs-${a}`,

    // ── Tier 5: kickoff.st embed format (soccer specific)
    `https://kickoff.st/stream/soccer/${matchId}`,

    // ── Tier 6: sofa score embed
    `https://widgets.sofascore.com/embed/event/${matchId}/momentum`,

    // ── Tier 7: onefootball live embed (free CL coverage)
    `https://onefootball.com/en/match/${matchId}/live`,
  ];
}

// ─────────────────────────────────────────────────────────────
// Step 1 — URL path filter: reject non-sports URLs immediately
// ─────────────────────────────────────────────────────────────
function hasSportsPath(url) {
  const lower = url.toLowerCase();
  return SPORTS_PATH_KEYWORDS.some(kw => lower.includes(kw));
}

// ─────────────────────────────────────────────────────────────
// Step 2 — GET content check: fetch first 8KB, reject movie pages
// ─────────────────────────────────────────────────────────────
async function isSportsContent(url) {
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      maxRedirects: 4,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      },
      validateStatus: s => s < 500
    });

    if (res.status === 404) {
      console.log(`      ⛔ 404 — ${url.substring(0, 65)}`);
      return false;
    }

    const body = (res.data || '').substring(0, 12000).toLowerCase();

    // Hard reject: page body clearly about movies/series
    const isMovie = MOVIE_DISCARD_KEYWORDS.some(kw => body.includes(kw));
    if (isMovie) {
      const kw = MOVIE_DISCARD_KEYWORDS.find(k => body.includes(k));
      console.log(`      🎬 MOVIE/SERIES page detected (keyword: "${kw}") — DISCARDED`);
      return false;
    }

    // Soft check: page should have at least one sports signal
    const sportsSignals = [
      'soccer', 'football', 'match', 'live', 'stream', 'sport',
      'goal', 'fixture', 'league', 'ucl', 'champions', 'kick'
    ];
    const hasSports = sportsSignals.some(kw => body.includes(kw));
    if (!hasSports) {
      console.log(`      ⚠️  No sports content detected — DISCARDED`);
      return false;
    }

    console.log(`      ✅ Sports content confirmed [${res.status}] — ${url.substring(0, 60)}`);
    return true;
  } catch (e) {
    console.log(`      ❌ GET failed: ${e.message.substring(0, 60)}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Full validation pipeline for a candidate URL
// ─────────────────────────────────────────────────────────────
async function validateSportsUrl(url) {
  // Gate 1: URL path must be sports-specific
  if (!hasSportsPath(url)) {
    console.log(`      🚫 Non-sports URL path — SKIPPED: ${url.substring(0, 60)}`);
    return false;
  }
  // Gate 2: Content check
  return isSportsContent(url);
}

// ─────────────────────────────────────────────────────────────
// 30-Minute Rule
// ─────────────────────────────────────────────────────────────
function isInStreamWindow(match) {
  const status = match.fixture?.status?.short;
  if (['IN_PLAY','HT','HALFTIME','LIVE','PAUSED','FINISHED','FT','AET','PEN'].includes(status)) {
    return true;
  }
  const kickoffStr = match.fixture?.date;
  if (!kickoffStr) return false;
  const kickoffMs = new Date(kickoffStr).getTime();
  const nowMs     = Date.now();
  const diffMs    = kickoffMs - nowMs;
  const inWindow  = diffMs <= WINDOW_BEFORE_KICKOFF_MS && diffMs > -(150 * 60 * 1000);
  if (inWindow) {
    console.log(`    ⏱️  Kickoff in ${Math.round(diffMs / 60000)} min — in 30-min stream window`);
  }
  return inWindow;
}

// ─────────────────────────────────────────────────────────────
// MAIN SCRAPER
// ─────────────────────────────────────────────────────────────
async function scrape() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  STREAM SCRAPER V41.0-CHAMPIONS-FINAL                     ║');
  console.log(`║  START: ${new Date().toISOString()}             ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  console.log('  ✅ SPORTS-ONLY mode | Content validation ON | Movie filter ON');

  // ── Load today's matches ─────────────────────────
  const now   = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  console.log(`\n📅 Reading matches/${today} from Firebase...`);
  const snap = await rtdb.ref(`matches/${today}`).once('value');
  const data = snap.val();

  if (!data?.events || Object.keys(data.events).length === 0) {
    console.log('⚠️  No matches found for today — run sync_script.js first!');
    process.exit(0);
  }

  const matches  = Object.values(data.events);
  const eligible = matches.filter(m => isInStreamWindow(m));

  console.log(`  📊 Total: ${matches.length} | Eligible (live + 30min pre-kick): ${eligible.length}`);

  let saved = 0;

  for (const match of eligible) {
    const matchId  = String(match.fixture?.id);
    const leagueId = match.league?.id || '';
    const homeName = match.teams?.home?.name || 'Home';
    const awayName = match.teams?.away?.name || 'Away';

    console.log(`\n  ⚽ [${leagueId}] ${homeName} vs ${awayName} (id:${matchId})`);

    // Skip if already has 3 validated servers
    const existSnap = await rtdb.ref(`match_links/${matchId}`).once('value');
    const existing  = existSnap.val();
    if (existing?.server1 && existing?.server2 && existing?.server3) {
      console.log(`    ✅ Already has 3 verified sport servers — skipping`);
      continue;
    }

    // Build candidates using ONLY sports-specific URL patterns
    const candidates = buildSportsCandidates(matchId, homeName, awayName, leagueId);
    console.log(`    🔎 Checking ${candidates.length} sports candidates...`);

    const validServers = [];
    for (const url of candidates) {
      if (validServers.length >= 3) break; // max 3 servers
      console.log(`    → Testing: ${url.substring(0, 70)}`);
      const ok = await validateSportsUrl(url);
      if (ok) validServers.push(url);
      await delay(400);
    }

    if (!validServers.length) {
      console.log(`    ❌ No valid sports servers found — skipping match`);
      continue;
    }

    // Build Firebase object
    const streamDoc = {
      server1:  validServers[0] || null,
      server2:  validServers[1] || null,
      server3:  validServers[2] || null,
      type:     'iframe',
      source:   'V41.0-SPORTS-ONLY',
      matchId,
      homeName,
      awayName,
      leagueId,
      savedAt:  Date.now(),
      version:  'V41.0-SCRAPER'
    };

    // Remove null slots
    Object.keys(streamDoc).forEach(k => streamDoc[k] === null && delete streamDoc[k]);

    await rtdb.ref(`match_links/${matchId}`).set(streamDoc);

    // Set HAS_LIVE_STREAM flag
    try {
      const eventsSnap = await rtdb.ref(`matches/${today}/events`).once('value');
      const eventsData = eventsSnap.val();
      if (eventsData) {
        if (Array.isArray(eventsData)) {
          const idx = eventsData.findIndex(e => String(e?.fixture?.id) === matchId);
          if (idx >= 0) await rtdb.ref(`matches/${today}/events/${idx}/HAS_LIVE_STREAM`).set(true);
        } else {
          for (const [k, v] of Object.entries(eventsData)) {
            if (String(v?.fixture?.id) === matchId) {
              await rtdb.ref(`matches/${today}/events/${k}/HAS_LIVE_STREAM`).set(true);
              break;
            }
          }
        }
      }
    } catch(e) { console.warn(`    ⚠️  HAS_LIVE_STREAM flag error: ${e.message}`); }

    const count = [streamDoc.server1, streamDoc.server2, streamDoc.server3].filter(Boolean).length;
    console.log(`    💾 Saved → match_links/${matchId} | ${count} SPORTS servers | HAS_LIVE_STREAM=true`);
    saved++;
    await delay(500);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  ✅ [V41.0-CHAMPIONS-FINAL] Done!                         ║`);
  console.log(`║  Eligible: ${String(eligible.length).padEnd(3)} | Saved: ${String(saved).padEnd(3)} | Movie filter: ACTIVE    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝`);

  process.exit(0);
}

scrape().catch(e => {
  console.error('[SCRAPER V41.0] Error:', e?.message || e);
  process.exit(0);
});
