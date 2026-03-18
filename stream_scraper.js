const admin = require('firebase-admin');
const axios  = require('axios');
const fsMod  = require('fs');

// ============================================================
// STREAM SCRAPER V40.0-PRO-LIVE
// ─ Saves server1 / server2 / server3 keys in match_links/{matchId}
// ─ Each server is a different aggregator embed source
// ─ HEAD validation: skip 404/403 responses before saving
// ─ 100% iframe/embed — no HLS
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

// ─────────────────────────────────────────────────────────────
// Embed URL builders — one URL per server slot
// These are aggregator/embed sites that serve iframes.
// ─────────────────────────────────────────────────────────────
function buildEmbedUrls(matchId, homeName, awayName) {
  const q = encodeURIComponent(`${homeName} vs ${awayName}`);
  return [
    // Server 1: VidSrc — most reliable, index by fixture id
    `https://vidsrc.me/embed/soccer/${matchId}`,
    // Server 2: SportStream search embed
    `https://embedstream.me/soccer/?q=${q}`,
    // Server 3: 2embed.cc soccer search
    `https://www.2embed.cc/embedtvshows/${matchId}`,
  ];
}

// ─────────────────────────────────────────────────────────────
// Validation: HEAD check to filter dead links (404 / 403 / 5xx)
// Returns true if the URL is likely reachable.
// ─────────────────────────────────────────────────────────────
async function isReachable(url) {
  try {
    const res = await axios.head(url, {
      timeout: 5000,
      maxRedirects: 4,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122',
        'Accept': 'text/html,application/xhtml+xml'
      },
      validateStatus: () => true // never throw on status
    });
    const ok = res.status >= 200 && res.status < 400;
    console.log(`      ✅ HEAD ${res.status} → ${url.substring(0, 60)}`);
    if (!ok) console.log(`      ⚠️  Skipping (${res.status})`);
    return ok;
  } catch (e) {
    // Network error (DNS failure, timeout) — skip silently
    console.log(`      ❌ HEAD failed for ${url.substring(0, 60)}: ${e.message}`);
    return false;
  }
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
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  STREAM SCRAPER V40.0-PRO-LIVE                           ║');
  console.log(`║  START: ${new Date().toISOString()}            ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('  Mode: server1/server2/server3 iframe | HEAD validation ON');

  // ── Step 1: Load today's matches ─────────────────────────
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

  // ── Step 2: Process each match ────────────────────────────
  let saved = 0;

  for (const match of eligible) {
    const matchId  = String(match.fixture?.id);
    const leagueId = match.league?.id || '';
    const homeName = match.teams?.home?.name || 'Home';
    const awayName = match.teams?.away?.name || 'Away';

    console.log(`\n  🔍 [${leagueId}] ${homeName} vs ${awayName} (id:${matchId})`);

    // Check if already has all 3 servers
    const existSnap = await rtdb.ref(`match_links/${matchId}`).once('value');
    const existing  = existSnap.val();
    if (existing?.server1 && existing?.server2 && existing?.server3) {
      console.log(`    ✅ Already has 3 servers — skipping`);
      continue;
    }

    // Build candidate URLs
    const candidates = buildEmbedUrls(matchId, homeName, awayName);
    console.log(`    🔎 Checking ${candidates.length} candidate URLs...`);

    // Validate each candidate
    const validServers = [];
    for (const url of candidates) {
      const ok = await isReachable(url);
      if (ok) validServers.push(url);
      await delay(300);
    }

    if (!validServers.length) {
      console.log(`    ❌ All servers failed validation — skipping`);
      continue;
    }

    // Build Firebase object with server1/server2/server3 slots
    const streamDoc = {
      server1:   validServers[0] || null,
      server2:   validServers[1] || null,
      server3:   validServers[2] || null,
      type:      'iframe',
      source:    'V40.0-MULTI-EMBED',
      matchId,
      homeName,
      awayName,
      leagueId,
      savedAt:   Date.now(),
      version:   'V40.0-SCRAPER'
    };

    // Remove null slots
    if (!streamDoc.server2) delete streamDoc.server2;
    if (!streamDoc.server3) delete streamDoc.server3;

    await rtdb.ref(`match_links/${matchId}`).set(streamDoc);

    // Set HAS_LIVE_STREAM flag on the match record
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
    } catch(e) {
      console.warn(`    ⚠️  Could not set HAS_LIVE_STREAM: ${e.message}`);
    }

    const serverCount = [streamDoc.server1, streamDoc.server2, streamDoc.server3].filter(Boolean).length;
    console.log(`    💾 Saved → match_links/${matchId} | ${serverCount} servers | HAS_LIVE_STREAM=true`);
    saved++;
    await delay(500);
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  ✅ [V40.0-PRO-LIVE] Done!                               ║`);
  console.log(`║  Eligible: ${eligible.length} | Saved: ${saved} | Validated: HEAD-checked     ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  process.exit(0);
}

scrape().catch(e => {
  console.error('[SCRAPER V40.0] Error:', e?.message || e);
  process.exit(0);
});
