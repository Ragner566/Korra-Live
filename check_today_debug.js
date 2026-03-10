const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/matches";

async function checkTodayDebug() {
  const today = "2026-03-10";
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN },
      params: {
        dateFrom: today,
        dateTo: today
      }
    });
    console.log("Response Data:", JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
checkTodayDebug();
