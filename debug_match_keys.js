const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkMatchKeys() {
  const matchId = 537092;
  try {
    const res = await axios.get(`${BASE_URL}/${matchId}`, {
      headers: { "X-Auth-Token": TOKEN }
    });
    console.log("Keys:", Object.keys(res.data));
    console.log("Status:", res.data.status);
    console.log("Match object keys:", Object.keys(res.data)); 
  } catch (e) {
    console.error(e.message);
  }
}
checkMatchKeys();
