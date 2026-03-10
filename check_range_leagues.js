const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";
const SUPPORTED_LEAGUES = ["PL", "PD", "BL1", "SA", "FL1", "CL"];

async function checkRangeWithLeagues() {
  const from = "2026-03-09";
  const to = "2026-03-11";
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: from,
        dateTo: to,
        competitions: SUPPORTED_LEAGUES.join(',')
      }
    });
    console.log(`Matches In range ${from} - ${to} with competitions:`, res.data.matches?.length);
    res.data.matches.forEach(m => {
        console.log(`- ${m.utcDate}: ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
checkRangeWithLeagues();
