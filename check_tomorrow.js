const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";
const SUPPORTED_LEAGUES = ["PL", "PD", "BL1", "SA", "FL1", "CL"];

async function checkTomorrow() {
  const tomorrow = "2026-03-11";
  try {
    console.log(`Requesting URL: ${BASE_URL}?dateFrom=${tomorrow}&dateTo=${tomorrow}`);
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: tomorrow,
        dateTo: tomorrow,
        competitions: SUPPORTED_LEAGUES.join(',')
      }
    });
    console.log("Status:", res.status);
    console.log("Data Keys:", Object.keys(res.data));
    console.log("Count:", res.data.matches?.length);
    if (res.data.matches) {
        res.data.matches.forEach(m => {
            console.log(`- ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`);
        });
    }
  } catch (e) {
    console.error("Error:", e.message);
    if (e.response) {
        console.error("Response Data:", e.response.data);
    }
  }
}
checkTomorrow();
