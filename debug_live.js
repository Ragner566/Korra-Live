const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function findLive() {
  try {
    const res = await axios.get(BASE_URL, {
        headers: { "X-Auth-Token": TOKEN }
    });
    const live = res.data.matches?.filter(m => m.status === "IN_PLAY" || m.status === "PAUSED");
    console.log("Live Matches Found:", live.length);
    live.forEach(m => {
        console.log(`- [${m.status}] ${m.homeTeam.name} vs ${m.awayTeam.name} | Minute: ${m.minute} | Score: ${m.score?.fullTime?.home}-${m.score?.fullTime?.away}`);
        console.log("Keys:", Object.keys(m));
    });
  } catch (e) {
    console.error(e.message);
  }
}
findLive();
