const axios = require('axios');
const TOKEN = "33e62ca975a749858503fdf63b75d9d7";
const BASE_URL = "https://api.football-data.org/v4/competitions";

async function checkToken() {
  try {
    const res = await axios.get(BASE_URL, {
      headers: { "X-Auth-Token": TOKEN }
    });
    console.log("Token works. Competitions found:", res.data.count);
  } catch (e) {
    console.error("Token error:", e.message);
  }
}
checkToken();
