const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function check552073() {
  const matchId = 552073;
  try {
    const res = await axios.get(`${BASE_URL}/${matchId}`, {
        headers: { "X-Auth-Token": TOKEN }
    });
    console.log("Details for Match 552073:");
    console.log("- Status:", res.data.status);
    console.log("- Goals:", JSON.stringify(res.data.goals, null, 2));
    console.log("- Statistics:", JSON.stringify(res.data.statistics, null, 2));
    console.log("- Lineups:", res.data.lineups ? "YES" : "NO");
    if (res.data.lineups) {
        console.log("- Home Players:", res.data.lineups.homeTeam?.bench?.length);
    }
  } catch (e) {
    console.error(e.message);
  }
}
check552073();
