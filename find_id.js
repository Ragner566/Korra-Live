const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function findMatchId() {
  try {
    const res = await axios.get(BASE_URL, {
        headers: { "X-Auth-Token": TOKEN },
        params: { dateFrom: "2026-03-11", dateTo: "2026-03-11" }
    });
    res.data.matches?.forEach(m => {
        console.log(`- ${m.id} | ${m.homeTeam.name} vs ${m.awayTeam.name}`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
findMatchId();
