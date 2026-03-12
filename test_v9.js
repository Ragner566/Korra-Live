const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync('./football_live_score_web/functions/service-account.json.json'));

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function testV9() {
  console.log("--- Testing V9 Data Integrity ---");
  
  const newsIndex = await db.collection("news_index").doc("latest").get();
  if (newsIndex.exists) {
    const items = newsIndex.data().items;
    console.log(`✅ News Index exists: ${items.length} items found.`);
    console.log(`   Sample: ${items[0].titleAr}`);
  } else {
    console.error("❌ News Index missing!");
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  const matchesDoc = await db.collection("matches").doc(dateStr).get();
  if (matchesDoc.exists) {
    const matches = matchesDoc.data().events || [];
    const finished = matches.filter(m => ['FINISHED', 'FT'].includes(m.fixture.status.short));
    console.log(`✅ Replays data exists for ${dateStr}: ${finished.length} finished matches.`);
  } else {
    console.log(`⚠️ No matches found for ${dateStr} for replays.`);
  }

  process.exit(0);
}

testV9();
