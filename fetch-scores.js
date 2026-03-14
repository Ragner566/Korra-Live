const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

const fileSystem = require('fs');

// ============================================================
// CONFIGURATION
// ============================================================
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL"];
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";

// ============================================================
// IPTV CHANNEL MAPPING
// Maps broadcast channel names -> IPTV-Org channel IDs
// ============================================================
const CHANNEL_KEYWORDS_MAP = {
  "bein sports hd 1":   "beIN Sports HD 1",
  "bein sports hd 2":   "beIN Sports HD 2",
  "bein sports hd 3":   "beIN Sports HD 3",
  "bein sports hd 4":   "beIN Sports HD 4",
  "bein sports 1":      "beIN Sports HD 1",
  "bein sports 2":      "beIN Sports HD 2",
  "bein sports 3":      "beIN Sports HD 3",
  "bein sports extra":  "beIN Sports HD 4",
  "sky sports":         "Sky Sports Premier League",
  "sky sports pl":      "Sky Sports Premier League",
  "bt sport":           "BT Sport 1",
  "canal+":             "Canal+ Sport",
  "dazn":               "DAZN 1 Germany",
  "sport 1":            "Sport 1 Germany",
  "mbc sport":          "MBC Sports HD",
  "al kass":            "Al Kass HD",
  "ssc":                "SSC Sports 1",
  "abu dhabi sport":    "Abu Dhabi Sports 1 HD",
};

// Known static links for the most common Arabic sports channels (fallback)
const STATIC_CHANNEL_LINKS = {
  "beIN Sports HD 1":          "https://iptv-org.github.io/streams/bein_sports_hd_1.m3u8",
  "beIN Sports HD 2":          "https://iptv-org.github.io/streams/bein_sports_hd_2.m3u8",
  "beIN Sports HD 3":          "https://iptv-org.github.io/streams/bein_sports_hd_3.m3u8",
  "beIN Sports HD 4":          "https://iptv-org.github.io/streams/bein_sports_hd_4.m3u8",
  "Sky Sports Premier League": "https://iptv-org.github.io/streams/sky_sports_premier_league.m3u8",
  "MBC Sports HD":             null,
  "SSC Sports 1":              null,
  "Abu Dhabi Sports 1 HD":     null,
};

const fsMod = require('fs');
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./service-account.js')) {
  serviceAccount = require('./service-account.js');
}

if (!serviceAccount) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT or service-account.js");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
});

const db = admin.database();
const fs = admin.firestore();

// ============================================================
// IPTV FETCHER - Parse ara.m3u from iptv-org
// ============================================================
let _iptvCache = null;

async function fetchIPTVChannels() {
  if (_iptvCache) return _iptvCache;
  console.log("[IPTV] Fetching Arabic channel list from iptv-org...");
  try {
    const res = await axios.get("https://iptv-org.github.io/iptv/languages/ara.m3u", {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KorraLive/20.5)' }
    });
    // Parse M3U
    const lines = res.data.split('\n');
    const channels = {};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF')) {
        const nameMatch = lines[i].match(/tvg-name="([^"]+)"/i) || lines[i].match(/,(.+)$/);
        const rawUrl = lines[i + 1]?.trim();
        if (nameMatch && rawUrl && rawUrl.startsWith('http')) {
          const name = (nameMatch[1] || '').trim();
          channels[name.toLowerCase()] = { name, url: rawUrl };
        }
      }
    }
    console.log(`[IPTV] Parsed ${Object.keys(channels).length} channels.`);
    _iptvCache = channels;
    return channels;
  } catch (e) {
    console.warn("[IPTV] Failed to fetch ara.m3u:", e.message);
    return {};
  }
}

// Look up a stream URL for a broadcaster name
async function findStreamUrl(broadcasterName) {
  if (!broadcasterName) return null;
  const lower = broadcasterName.toLowerCase();

  // Check our keyword map
  for (const [keyword, channelName] of Object.entries(CHANNEL_KEYWORDS_MAP)) {
    if (lower.includes(keyword)) {
      // First check static links
      if (STATIC_CHANNEL_LINKS[channelName]) {
        return STATIC_CHANNEL_LINKS[channelName];
      }
      // Then check live IPTV list
      const channels = await fetchIPTVChannels();
      const found = channels[channelName.toLowerCase()];
      if (found) return found.url;
    }
  }

  // Fuzzy search in live IPTV list
  const channels = await fetchIPTVChannels();
  for (const [key, val] of Object.entries(channels)) {
    if (key.includes(lower) || lower.includes(key)) {
      return val.url;
    }
  }

  return null;
}

// ============================================================
// SAVE CHANNELS LIST TO FIREBASE (for 24/7 page)
// ============================================================
async function saveIPTVChannelsToFirebase() {
  console.log("[IPTV] Saving channel list to Firebase...");
  const channels = await fetchIPTVChannels();

  // Sport channels only (filter)
  const sportKeywords = ['sport', 'bein', 'sky', 'dazn', 'canal', 'kass', 'ssc', 'mbc sport', 'abu dhabi sport', 'al jazeera', 'arab'];
  const sportChannels = Object.values(channels).filter(ch =>
    sportKeywords.some(kw => ch.name.toLowerCase().includes(kw))
  ).slice(0, 60); // Max 60 channels

  try {
    const dataObj = {
      channels: sportChannels,
      lastUpdated: new Date().toISOString(),
      source: 'iptv-org/arabic'
    };
    
    // Save to Firebase (Optional now, but good for backup)
    await fs.collection('live_tv').doc('channels').set({
      ...dataObj,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Write local JSON files for Web Client to bypass CORS fetching IPTV
    fileSystem.writeFileSync('./football_live_score_web/public/channels_data.json', JSON.stringify(dataObj, null, 2));
    fileSystem.writeFileSync('./football_live_score_web/channels_data.json', JSON.stringify(dataObj, null, 2));
    
    console.log(`[IPTV] Saved ${sportChannels.length} sport channels to Firestore and local channels_data.json`);
  } catch (e) {
    console.error("[IPTV] Failed to save channels:", e.message);
  }
}

// ============================================================
// DATA FETCHING HELPERS
// ============================================================
async function fetchMatchDetails(matchId) {
  try {
    const res = await axios.get(`${BASE_URL}/matches/${matchId}`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      timeout: 10000
    });
    return res.data;
  } catch (e) {
    if (e.response?.status === 429) return "LIMIT";
    console.error(`Error fetching details for match ${matchId}: ${e.message}`);
    return null;
  }
}

async function fetchMatchesForRange(dateFrom, dateTo) {
  console.log(`Fetching matches from ${dateFrom} to ${dateTo}...`);
  try {
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { dateFrom, dateTo, competitions: SUPPORTED_COMPETITIONS.join(',') },
      timeout: 15000
    });

    let matches = res.data.matches || [];

    // Deep fetch for LIVE/FINISHED
    const importantMatches = matches.filter(m =>
      ["IN_PLAY", "FINISHED", "PAUSED"].includes(m.status)
    ).slice(0, 6);

    for (let i = 0; i < importantMatches.length; i++) {
      try {
        const m = importantMatches[i];
        const details = await fetchMatchDetails(m.id);
        if (details === "LIMIT") break;
        if (details) {
          m.detailsFetched = true;
          m.lineups = details.lineups || null;
          m.statistics = details.statistics || [];
          m.goals_events = details.goals || [];
        }
        if (i < importantMatches.length - 1) await new Promise(r => setTimeout(r, 6500));
      } catch (err) {
        console.warn(`Error during deep fetch for match ${importantMatches[i]?.id}:`, err?.message);
      }
    }

    // Resolve YouTube highlight links sequentially for FINISHED matches
    const mappedMatches = [];
    for (const m of matches) {
      const isFinished = ["FINISHED", "AWARDED"].includes(m.status);
      let highlightsUrl = null;
      let fullMatchUrl = null;

      if (isFinished) {
        const leagueName = m.competition.name || '';
        const homeName = m.homeTeam.shortName || m.homeTeam.name || '';
        const awayName = m.awayTeam.shortName || m.awayTeam.name || '';
        
        // Use Real YouTube Data API for Highlights!
        try {
          const query = encodeURIComponent(`أهداف مباراة ${homeName} و ${awayName} ${leagueName}`.trim());
          const ytRes = await axios.get(`https://www.googleapis.com/youtube/v3/search`, {
            params: {
              part: 'snippet',
              q: query,
              key: process.env.YOUTUBE_API_KEY || "AIzaSyC3Ul_gB1ZkRM9ZLVEdgz4KH3boiKhtzO0",
              type: 'video',
              maxResults: 1
            }
          });
          if (ytRes.data.items && ytRes.data.items.length > 0) {
            highlightsUrl = `https://www.youtube.com/embed/${ytRes.data.items[0].id.videoId}?enablejsapi=1&rel=0`;
          } else {
            // Fallback list embed if specific video fails
            highlightsUrl = `https://www.youtube.com/embed?listType=search&list=${query}&enablejsapi=1&rel=0`;
          }
        } catch (ytErr) {
          console.warn(`YouTube search failed for ${homeName}:`, ytErr.response?.data?.error?.message || ytErr.message);
          highlightsUrl = `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(homeName + ' ' + awayName)}&enablejsapi=1&rel=0`;
        }
        
        fullMatchUrl = `https://footballia.eu/search?q=${encodeURIComponent(homeName + ' ' + awayName)}`;
      }

      mappedMatches.push({
        fixture: {
          id: m.id,
          status: { short: m.status, elapsed: m.minute || null },
          date: m.utcDate
        },
        league: {
          name: m.competition.name,
          id: m.competition.code,
          logo: m.competition.emblem
        },
        teams: {
          home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
          away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
        },
        goals: { home: m.score.fullTime.home, away: m.score.fullTime.away },
        score: m.score,
        lineups: m.lineups,
        statistics: m.statistics,
        events: m.goals_events,
        broadcasters: m.odds?.msg || null,
        highlights: highlightsUrl ? { url: highlightsUrl, isFallback: false } : null,
        fullMatchUrl: fullMatchUrl,
        source: "football-data.org (enriched)"
      });
    }
    return mappedMatches;

  } catch (e) {
    console.error(`Error fetching matches: ${e.message}`);
    return null;
  }
}

async function fetchStandings(competitionCode) {
  try {
    const res = await axios.get(`${BASE_URL}/competitions/${competitionCode}/standings`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      timeout: 15000
    });
    return res.data.standings || [];
  } catch (e) {
    console.error(`Error fetching standings for ${competitionCode}: ${e.message}`);
    return null;
  }
}

// ============================================================
// MAIN RUN
// ============================================================
async function run() {
  console.log("=== Kora Live V20.5 - Smart Fetch + IPTV Mapper ===");

  // Step 0: Load IPTV channels in background
  const iptvPromise = fetchIPTVChannels();

  // Adapt server time to Arab UTC+2 timezone logic
  const now = new Date();
  now.setHours(now.getHours() + 2); // Force +2 hours for Egypt/Saudi timing
  
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const dStr = (d) => d.toISOString().split('T')[0];

  // Step 1: Fetch matches
  const matches = await fetchMatchesForRange(dStr(yesterday), dStr(tomorrow));

  if (matches) {
    const grouped = {};
    matches.forEach(m => {
      const date = m.fixture.date.split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(m);
    });

    for (const [date, events] of Object.entries(grouped)) {
      await db.ref(`/matches/${date}`).set({ events, lastUpdated: Date.now(), source: "football-data.org" });
      await fs.collection('matches').doc(date).set({
        events,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        source: "football-data.org"
      });
      console.log(`Saved ${events.length} matches for ${date}`);

      if (date === dStr(now)) {
        await fs.collection('matches').doc('today').set({ events, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
        await db.ref("/live_matches").set({ events, lastUpdated: Date.now(), quotaExceeded: false });

        // Step 2: Auto-link IPTV streams to today's live/upcoming matches
        console.log("[IPTV] Auto-mapping streams to today's matches...");
        await iptvPromise; // Ensure IPTV is loaded

        for (const match of events) {
          const fixtureId = String(match.fixture.id);

          // Check if already has a manual link
          const existingDoc = await fs.collection('matches').doc(date).collection('live_links').doc(fixtureId).get();
          if (existingDoc.exists && existingDoc.data().url && !existingDoc.data().autoGenerated) {
            console.log(`[IPTV] Skip ${fixtureId} - has manual link.`);
            continue;
          }

          // Try to find a relevant stream via league name or competition
          const leagueName = match.league?.name || '';
          let streamUrl = null;

          // Try well-known league -> channel mapping
          if (leagueName.includes('Premier League')) {
            streamUrl = await findStreamUrl('sky sports pl');
          } else if (leagueName.includes('La Liga')) {
            streamUrl = await findStreamUrl('bein sports hd 1');
          } else if (leagueName.includes('Champions League')) {
            streamUrl = await findStreamUrl('bein sports hd 2');
          } else if (leagueName.includes('Serie A')) {
            streamUrl = await findStreamUrl('bein sports hd 3');
          } else if (leagueName.includes('Bundesliga')) {
            streamUrl = await findStreamUrl('bein sports hd 1');
          } else if (leagueName.includes('Ligue 1')) {
            streamUrl = await findStreamUrl('bein sports hd 4');
          }

          if (streamUrl) {
            await fs.collection('matches').doc(date).collection('live_links').doc(fixtureId).set({
              url: streamUrl,
              autoGenerated: true,
              leagueSource: leagueName,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: false }); // Don't override manual links (handled above)
            console.log(`[IPTV] ✅ Auto-linked ${match.teams.home.name} vs ${match.teams.away.name} -> ${streamUrl}`);
          } else {
            console.log(`[IPTV] ❌ No stream found for ${match.teams.home.name} vs ${match.teams.away.name}`);
          }
        }

      } else if (date === dStr(yesterday)) {
        await fs.collection('matches').doc('yesterday').set({ events, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
      } else if (date === dStr(tomorrow)) {
        await fs.collection('matches').doc('tomorrow').set({ events, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
      }
    }
  }

  // Step 3: Save IPTV channels to Firestore for 24/7 page
  await saveIPTVChannelsToFirebase();

  // Step 4: Fetch standings
  for (const code of SUPPORTED_COMPETITIONS) {
    const standings = await fetchStandings(code);
    if (standings) {
      await fs.collection('standings').doc(code).set({
        standings,
        lastUpdated: new Date().toISOString()
      });
      console.log(`Saved standings for ${code}`);
    }
    await new Promise(r => setTimeout(r, 6500));
  }

  // Step 5: Update verified token record
  try {
    await fs.collection('settings').doc('global').set({
      korra: FOOTBALL_DATA_TOKEN,
      footballDataToken: FOOTBALL_DATA_TOKEN,
      lastSmartUpdate: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    console.error("Firestore settings update failed:", e.message);
  }

  console.log("=== V20.5 Run Completed ===");
  process.exit(0);
}

run().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
