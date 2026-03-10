const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkMatchesNow() {
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN }
    });
    console.log("Upcoming Matches Count:", res.data.matches?.length);
    if (res.data.matches) {
        res.data.matches.slice(0, 5).forEach(m => {
            console.log(`- ${m.utcDate}: ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`);
        });
    }
  } catch (e) {
    console.error(e.message);
  }
}
checkMatchesNow();
