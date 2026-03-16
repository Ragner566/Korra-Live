const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = require('./service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();

async function cleanup() {
  console.log("🧹 Cleaning up Firebase RTDB nodes...");
  try {
    await db.ref("/live_matches").remove();
    console.log("✅ Deleted /live_matches");
    await db.ref("/matches").remove();
    console.log("✅ Deleted /matches");
    console.log("🏁 Cleanup complete.");
    process.exit(0);
  } catch (e) {
    console.error("❌ Cleanup failed:", e.message);
    process.exit(1);
  }
}

cleanup();
