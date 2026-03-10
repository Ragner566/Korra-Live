const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkSaturday() {
  const sat = "2026-03-14";
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: sat,
        dateTo: sat
      }
    });
    console.log(`Any Matches for Saturday (${sat}):`, res.data.matches?.length);
    res.data.matches.slice(0, 5).forEach(m => {
        console.log(`- ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
checkSaturday();
