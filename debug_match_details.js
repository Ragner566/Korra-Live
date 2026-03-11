const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkMatchDetails() {
  const matchId = 537092; // One of the CL matches
  try {
    const res = await axios.get(`${BASE_URL}/${matchId}`, {
      headers: { "X-Auth-Token": TOKEN }
    });
    console.log("Match Details for", matchId);
    console.log("Status:", res.data.status);
    console.log("Minute:", res.data.minute);
    console.log("Goals Sample:", JSON.stringify(res.data.goals?.slice(0, 1), null, 2));
    console.log("Stats Sample:", JSON.stringify(res.data.statistics?.slice(0, 1), null, 2));
    console.log("Lineups Home Players Sample:", res.data.lineups?.homeTeam?.formation, res.data.lineups?.homeTeam?.bench?.length);
  } catch (e) {
    console.error(e.message);
  }
}
checkMatchDetails();
