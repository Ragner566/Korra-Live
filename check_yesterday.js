const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkYesterday() {
  const yesterday = "2026-03-09";
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: yesterday,
        dateTo: yesterday
      }
    });
    console.log(`Any Matches for Yesterday (${yesterday}):`, res.data.matches?.length);
  } catch (e) {
    console.error(e.message);
  }
}
checkYesterday();
