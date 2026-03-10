const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkTodayAny() {
  const today = "2026-03-10";
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: today,
        dateTo: today
      }
    });
    console.log(`Any Matches for Today (${today}):`, res.data.matches?.length);
    res.data.matches.slice(0, 5).forEach(m => {
        console.log(`- ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
checkTodayAny();
