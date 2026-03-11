const admin = require('firebase-admin');
const fsMod = require('fs');

let serviceAccount;
if (fsMod.existsSync('./football_live_score_web/functions/service-account.json.json')) {
  serviceAccount = require('./football_live_score_web/functions/service-account.json.json');
} else {
  console.error("Missing service-account file.");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const fs = admin.firestore();

async function checkFirestore() {
  const dates = ["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "today", "yesterday", "tomorrow"];
  for (const date of dates) {
    const doc = await fs.collection('matches').doc(date).get();
    if (doc.exists) {
      const data = doc.data();
      console.log(`Doc [${date}]: ${data.events?.length || 0} matches. (Data Date: ${data.date})`);
      data.events?.slice(0, 1).forEach(m => {
          console.log(`  First Match: ${m.fixture.date} | ${m.teams.home.name} vs ${m.teams.away.name}`);
      });
    } else {
      console.log(`Doc [${date}]: MISSING`);
    }
  }
  process.exit(0);
}

checkFirestore();
