const admin = require('firebase-admin');
const axios = require('axios');

// ============================================================
// CONFIGURATION
// Football-Data.org TIER_ONE (Free) Limitations:
// - Delayed stats (up to 15-20 min)
// - No lineups/events/stats for most leagues in Free plan.
// ============================================================
const SUPPORTED_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL", "ELC"]; 
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4";

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

const fs = admin.firestore();

async function sync() {
  console.log(`=== SYNC START: ${new Date().toISOString()} ===`);
  
  const dStr = (d) => d.toISOString().split('T')[0];
  const now = new Date();
  
  // Broad range to ensure no date is missed across timezones
  const dateFrom = dStr(new Date(now.getTime() - 86400000 * 2)); // Yesterday - 1
  const dateTo = dStr(new Date(now.getTime() + 86400000 * 2));   // Tomorrow + 1
  
  try {
    const res = await axios.get(`${BASE_URL}/matches`, {
      headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
      params: { 
        dateFrom, 
        dateTo,
        competitions: SUPPORTED_COMPETITIONS.join(',') 
      }
    });
    
    const matches = res.data.matches || [];
    console.log(`Fetched ${matches.length} matches.`);

    const mappedTemp = matches.map(m => {
        return {
            fixture: {
                id: m.id,
                status: { short: m.status, elapsed: m.minute || null },
                date: m.utcDate
            },
            league: { name: m.competition.name, id: m.competition.code, logo: m.competition.emblem },
            teams: {
                home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
                away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
            },
            score: m.score,
            goals: {
                home: m.score?.fullTime?.home ?? 0,
                away: m.score?.fullTime?.away ?? 0
            },
            minute: m.minute || null,
            // placeholders
            events: m.goals_incidents || [],
            statistics: [],
            lineups: null,
            utcDate: m.utcDate
        };
    });


    // --- Deep Fetch for LIVE Matches ---
    const liveMatches = matches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    if (liveMatches.length > 0) {
        console.log(`Deep Fetching ${liveMatches.length} LIVE matches...`);
        for (let i = 0; i < liveMatches.length; i++) {
            const mData = liveMatches[i];
            try {
                // Rate limit to stay under 10req/min
                if (i > 0) await new Promise(r => setTimeout(r, 6500));
                
                const detailRes = await axios.get(`${BASE_URL}/matches/${mData.id}`, {
                    headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN }
                });
                
                // Map the new deeper info
                const deeper = detailRes.data;
                const matchObj = mappedTemp.find(el => el.fixture.id === mData.id);
                if (matchObj) {
                    matchObj.fixture.status.elapsed = deeper.minute || matchObj.fixture.status.elapsed;
                    matchObj.minute = deeper.minute || matchObj.minute;
                    matchObj.events = deeper.goals_incidents || deeper.events || matchObj.events;
                    matchObj.statistics = deeper.statistics || [];
                    matchObj.lineups = deeper.lineups || null;
                    console.log(`  - Updated deep data for Match ${mData.id} (Min: ${matchObj.minute})`);
                }
            } catch(e) {
                console.warn(`  - Failed deep fetch for ${mData.id} (Rate limit or API issue)`);
            }
        }
    }

    const grouped = {};
    for (let d = new Date(dateFrom); d <= new Date(dateTo); d.setDate(d.getDate() + 1)) {
        grouped[dStr(d)] = [];
    }
    
    mappedTemp.forEach(m => {
        const utcDate = m.utcDate.split('T')[0];
        if (!grouped[utcDate]) grouped[utcDate] = [];
        grouped[utcDate].push(m);
    });

    const batch = fs.batch();
    for (const [dateStr, events] of Object.entries(grouped)) {
        batch.set(fs.collection('matches').doc(dateStr), {
            events,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            date: dateStr
        });
        
        // Aliases for compatibility (careful with timezone shift)
        if (dateStr === dStr(now)) batch.set(fs.collection('matches').doc('today'), { events, date: dateStr, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
        if (dateStr === dStr(new Date(now.getTime() + 86400000))) batch.set(fs.collection('matches').doc('tomorrow'), { events, date: dateStr, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
        if (dateStr === dStr(new Date(now.getTime() - 86400000))) batch.set(fs.collection('matches').doc('yesterday'), { events, date: dateStr, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
    }
    
    await batch.commit();
    console.log("✅ Sync successful.");

  } catch (e) {
    console.error(`❌ Sync Failed: ${e.message}`);
  }
  process.exit(0);
}

sync();
