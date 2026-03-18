const admin = require('firebase-admin');
const axios  = require('axios');
const fsMod  = require('fs');

// ============================================================
// SOCIAL BOT V35.0 — Telegram Goal Alerts
// Watches Firebase RTDB match_events for new goals.
// Posts instant alerts to Telegram with match link.
//
// SETUP:
//   Set these env vars (or edit directly below):
//   TELEGRAM_BOT_TOKEN = your bot token from @BotFather
//   TELEGRAM_CHAT_ID   = your channel/group chat ID (e.g. -1001234567890)
//   SITE_URL           = your site URL (default: https://korra-b5d32.web.app)
// ============================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'PUT_YOUR_BOT_TOKEN_HERE';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || 'PUT_YOUR_CHAT_ID_HERE';
const SITE_URL           = process.env.SITE_URL            || 'https://korra-b5d32.web.app';

if (TELEGRAM_BOT_TOKEN === 'PUT_YOUR_BOT_TOKEN_HERE') {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — alerts will be dry-run only (console output).');
}

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

const rtdb = admin.database();

// ─────────────────────────────────────────────────────────────
// In-memory store: track which events have already been posted
// Key: `${matchId}_${eventType}_${eventTime}_${playerName}`
// ─────────────────────────────────────────────────────────────
const POSTED_EVENTS = new Set();

// ─────────────────────────────────────────────────────────────
// SEND TELEGRAM MESSAGE
// ─────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('PUT_YOUR')) {
    console.log('[DRY-RUN] Telegram Message:\n', message, '\n');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id:    TELEGRAM_CHAT_ID,
      text:       message,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
    console.log('📤 Telegram alert sent!');
  } catch(e) {
    console.error('❌ Telegram send failed:', e?.response?.data?.description || e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT GOAL ALERT MESSAGE (Arabic + Emoji)
// ─────────────────────────────────────────────────────────────
function buildGoalMessage(matchId, matchData, event) {
  const home     = matchData?.homeTeamName || 'Home';
  const away     = matchData?.awayTeamName || 'Away';
  const player   = event.playerName || 'لاعب';
  const minute   = event.time ? `${event.time}'` : '';
  const side     = event.isHome ? home : away;
  const isPen    = event.type === 'PENALTY_GOAL';
  const goalIcon = isPen ? '🎯⚽' : '⚽';
  const penText  = isPen ? ' (ركلة جزاء)' : '';

  return (
    `${goalIcon} <b>هدف!</b>${penText}\n` +
    `\n🏟 <b>${home}</b> 🆚 <b>${away}</b>\n` +
    `👟 ${goalIcon} <b>${player}</b> يسجل للفريق <b>${side}</b> ${minute}${penText}\n` +
    `\n📺 <a href="${SITE_URL}">شاهد المباراة مباشرةً على كورة لايف</a>`
  );
}

// ─────────────────────────────────────────────────────────────
// PROCESS ONE MATCH NODE from match_events/{matchId}
// ─────────────────────────────────────────────────────────────
async function processMatchEvents(matchId, matchData) {
  const events = matchData?.events;
  if (!Array.isArray(events)) return;

  for (const ev of events) {
    const isGoal = ev.type === 'GOAL' || ev.type === 'PENALTY_GOAL';
    if (!isGoal) continue;

    // Build a dedup key
    const key = `${matchId}_${ev.type}_${ev.time}_${ev.playerName}`;
    if (POSTED_EVENTS.has(key)) continue; // Already alerted

    POSTED_EVENTS.add(key);
    console.log(`⚽ NEW GOAL detected! Match ${matchId} | ${ev.playerName} @ ${ev.time}'`);

    const msg = buildGoalMessage(matchId, matchData, ev);
    await sendTelegram(msg);
  }
}

// ─────────────────────────────────────────────────────────────
// BOOT: Pre-load all existing events so we don't re-alert old goals
// ─────────────────────────────────────────────────────────────
async function preloadExistingEvents() {
  console.log('🔁 Pre-loading existing match events (no alerts for these)...');
  const snap = await rtdb.ref('match_events').once('value');
  const data = snap.val() || {};
  for (const [matchId, matchData] of Object.entries(data)) {
    const events = matchData?.events;
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (ev.type === 'GOAL' || ev.type === 'PENALTY_GOAL') {
        const key = `${matchId}_${ev.type}_${ev.time}_${ev.playerName}`;
        POSTED_EVENTS.add(key);
      }
    }
  }
  console.log(`  ✅ Pre-loaded ${POSTED_EVENTS.size} existing goal keys (won't re-alert).`);
}

// ─────────────────────────────────────────────────────────────
// MAIN: Start watching RTDB match_events in real-time
// ─────────────────────────────────────────────────────────────
async function startBot() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  SOCIAL BOT V35.0 — Telegram Goal Alerts             ║');
  console.log(`║  START: ${new Date().toISOString()}          ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Telegram Bot: ${TELEGRAM_BOT_TOKEN.includes('PUT_YOUR') ? '⚠️  DRY-RUN' : '✅ Active'}`);
  console.log(`  Chat ID:      ${TELEGRAM_CHAT_ID}`);
  console.log(`  Site URL:     ${SITE_URL}`);
  console.log(`  Watching:     Firebase RTDB / match_events/*\n`);

  await preloadExistingEvents();

  // Listen for any change under match_events/
  const ref = rtdb.ref('match_events');
  ref.on('child_changed', async (snapshot) => {
    const matchId   = snapshot.key;
    const matchData = snapshot.val();
    console.log(`🔔 [CHANGE] match_events/${matchId} updated`);
    await processMatchEvents(matchId, matchData);
  });

  ref.on('child_added', async (snapshot) => {
    const matchId   = snapshot.key;
    const matchData = snapshot.val();
    // child_added fires for existing + new — but POSTED_EVENTS prevents double-alerts
    await processMatchEvents(matchId, matchData);
  });

  console.log('👂 Listening for live goals... (Ctrl+C to stop)\n');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n🛑 Bot stopped. Bye!');
    rtdb.ref('match_events').off();
    process.exit(0);
  });
}

startBot().catch(e => {
  console.error('[SOCIAL BOT] Fatal error:', e?.message || e);
  process.exit(1);
});
