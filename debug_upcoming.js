const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkUpcoming() {
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN }
    });
    console.log(`Upcoming Matches:`, res.data.matches?.length);
    res.data.matches?.slice(0, 10).forEach(m => {
        console.log(`- ${m.utcDate}: [${m.status}] ${m.homeTeam.name} vs ${m.awayTeam.name} (Min: ${m.minute}) (Comp: ${m.competition.code})`);
    });
  } catch (e) {
    console.error(e.message);
  }
}
checkUpcoming();
