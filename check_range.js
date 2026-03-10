const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkRange() {
  const from = "2026-03-09";
  const to = "2026-03-11";
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: from,
        dateTo: to
      }
    });
    console.log(`Matches in range ${from} - ${to}:`, res.data.matches?.length);
    res.data.matches.slice(0, 10).forEach(m => {
        console.log(`- ${m.utcDate}: ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
checkRange();
