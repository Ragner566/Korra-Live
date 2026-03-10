// =============================================================
//  LiveScore Pro - Full API Integration with API-Football
//  Uses: https://rapidapi.com/api-sports/api/api-football
// =============================================================

// ============================================
// CONFIG & STATE
// ============================================
let CONFIG = {
  API_BASE_URL: "https://api.football-data.org/v4",
  REFRESH_INTERVAL: 120000, // 2 minutes
  FALLBACK_API_KEY: "33e62ca975a749858503fdf63b75d9d7",
  SUPPORTED_LEAGUES: ["PL", "PD", "BL1", "SA", "FL1", "CL"]
};

let STATE = {
  apiKey: "", 
  currentDate: new Date(),
  currentLeague: "all",
  currentPage: "matches",
  allMatches: [],
  refreshTimer: null,
  progressTimer: null,
  currentLang: "ar",
  isArabic: true,
  _appStarted: false,
  _unsubscribeMatches: null
};

// ============================================
// i18n TRANSLATIONS
// ============================================
const i18n = {
  ar: {
    liveNow: "مباشر الآن",
    scheduledMatches: "مباريات قادمة",
    finishedMatches: "مباريات منتهية",
    loading: "جاري تحميل المباريات...",
    noMatches: "لا توجد مباريات في هذا اليوم",
    matches: "المباريات",
    standings: "الترتيب",
    news: "الأخبار",
    retry: "إعادة المحاولة",
    allLeagues: "الكل",
    premierLeague: "البريميرليغ",
    laLiga: "لاليغا",
    serieA: "سيري أ",
    bundesliga: "بوندسليغا",
    ligue1: "الدوري الفرنسي",
    championsLeague: "دوري الأبطال",
    today: "اليوم",
    yesterday: "أمس",
    tomorrow: "غداً",
    fullTime: "النتيجة النهائية",
    halfTime: "نهاية الشوط",
    events: "الأحداث",
    stats: "الإحصائيات",
    lineups: "التشكيلات",
    goalScorer: "⚽ هدف",
    yellowCard: "🟡 بطاقة صفراء",
    redCard: "🔴 بطاقة حمراء",
    substitution: "🔄 تبديل",
    possession: "الاستحواذ",
    shots: "التسديدات",
    shotsOnTarget: "على المرمى",
    corners: "الركنيات",
    fouls: "الأخطاء",
    offsides: "التسلل",
    passes: "التمريرات",
    passAccuracy: "دقة التمريرات",
    formation: "التشكيلة",
    newsComingSoon: "قسم الأخبار قريبًا",
    played: "لعب",
    won: "فاز",
    drawn: "تعادل",
    lost: "خسر",
    goalsFor: "له",
    goalsAgainst: "عليه",
    gd: "الفرق",
    pts: "النقاط",
    team: "الفريق",
    rank: "#",
  },
  en: {
    liveNow: "Live Now",
    scheduledMatches: "Upcoming Matches",
    finishedMatches: "Finished Matches",
    loading: "Loading matches...",
    noMatches: "No matches on this day",
    matches: "Matches",
    standings: "Standings",
    news: "News",
    retry: "Retry",
    allLeagues: "All",
    premierLeague: "Premier League",
    laLiga: "La Liga",
    serieA: "Serie A",
    bundesliga: "Bundesliga",
    ligue1: "Ligue 1",
    championsLeague: "Champions League",
    today: "Today",
    yesterday: "Yesterday",
    tomorrow: "Tomorrow",
    fullTime: "Full Time",
    halfTime: "Half Time",
    events: "Events",
    stats: "Statistics",
    lineups: "Lineups",
    goalScorer: "⚽ Goal",
    yellowCard: "🟡 Yellow Card",
    redCard: "🔴 Red Card",
    substitution: "🔄 Substitution",
    possession: "Possession",
    shots: "Shots",
    shotsOnTarget: "On Target",
    corners: "Corners",
    fouls: "Fouls",
    offsides: "Offsides",
    passes: "Passes",
    passAccuracy: "Pass Accuracy",
    formation: "Formation",
    newsComingSoon: "News section coming soon",
    played: "P",
    won: "W",
    drawn: "D",
    lost: "L",
    goalsFor: "GF",
    goalsAgainst: "GA",
    gd: "GD",
    pts: "Pts",
    team: "Team",
    rank: "#",
  },
};

// ============================================
// API FUNCTIONS (Football-Data.org)
// ============================================
async function apiRequest(endpoint, params = {}) {
  // CORS NOTICE: Football-Data.org does NOT support client-side CORS.
  // This function is kept for legacy/testing but will likely fail in production browsers.
  // We should rely 100% on Firestore (synced by our backend script).
  
  const url = new URL(`${CONFIG.API_BASE_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const keyToUse = STATE.apiKey ? STATE.apiKey.trim() : CONFIG.FALLBACK_API_KEY;
  console.warn(`[CORS Warning] Attempting client-side fetch for ${endpoint}. This will likely fail due to CORS policy.`);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      // Note: No 'mode: cors' here because the server won't respond with correct headers
      headers: {
        "X-Auth-Token": keyToUse,
        "Accept": "application/json"
      },
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("429 Too Many Requests");
      const errorText = await response.text();
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`[CORS] Request to ${endpoint} failed as expected. Using Firestore fallback.`);
    throw error;
  }
}

// ============================================
// DATA FETCHING
// ============================================
async function selectMatchDay(day, btn) {
  console.log(`[Navigation] User clicked: ${day}`);
  
  // 1. UI Feedback: Update Active Tab
  if (btn) {
    document.querySelectorAll('.match-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // 2. Clear current matches view to avoid ghosting or stale data
  const sections = ["live-matches", "scheduled-matches", "finished-matches"];
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = "";
      const section = el.closest('.section');
      if (section) section.style.display = "none";
    }
  });
  
  const noMatches = document.getElementById("no-matches");
  if (noMatches) noMatches.style.display = "none";
  
  showLoading();

  // 3. Update Date State
  const now = new Date();
  if (day === 'yesterday') {
    STATE.currentDate = new Date(now.getTime() - 86400000);
  } else if (day === 'tomorrow') {
    STATE.currentDate = new Date(now.getTime() + 86400000);
  } else {
    STATE.currentDate = now;
    day = 'today';
  }

  await fetchMatches(day);
}

// Event Delegation for Match Cards
document.addEventListener('click', function(e) {
  const card = e.target.closest('.match-card');
  if (card && card.dataset.id) {
    const matchId = card.dataset.id;
    const match = STATE.allMatches.find(m => String(m.fixture.id) === String(matchId));
    console.log("Match Data Clicked:", match); // Logic requested for debugging JSON
    
    if (typeof showInterstitial === 'function') showInterstitial();
    openMatchDetail(parseInt(matchId));
  }
});

async function fetchMatches(forcedDocId = null) {
  // Simple Debounce: prevent spamming
  const clickTime = Date.now();
  if (STATE._lastFetch && (clickTime - STATE._lastFetch < 1000) && !forcedDocId) return;
  STATE._lastFetch = clickTime;

  const dateStr = formatDateAPI(STATE.currentDate);
  const todayDateStr = formatDateAPI(new Date());

  // Logic to determine which document to fetch
  let docId = forcedDocId;
  if (!docId) {
    if (dateStr === todayDateStr) docId = "today";
    else if (dateStr === formatDateAPI(new Date(Date.now() - 86400000))) docId = "yesterday";
    else if (dateStr === formatDateAPI(new Date(Date.now() + 86400000))) docId = "tomorrow";
    else docId = dateStr;
  }

  console.log(`[Fetch] Priority: ${docId}, Date: ${dateStr}`);
  
  showLoading();
  hideError();

  // ── 1. FIRESTORE ONLY (Server backend runs independently) ──────────────────────────────
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    try {
      const fs = firebase.firestore();
      const docSnap = await fs.collection("matches").doc(docId).get();
      
      if (docSnap.exists) {
        const data = docSnap.data();
        STATE.allMatches = data.events || [];
        console.log(`[Firestore] Successfully loaded ${STATE.allMatches.length} matches for ${docId}`);
      } else {
        console.warn(`[Firestore] Document ${docId} missing, using empty list.`);
        STATE.allMatches = [];
      }
      
      hideLoading();
      renderMatches(STATE.allMatches);
      
      // Setup real-time listener for current view
      setupLiveMatchesListener();
      return;
    } catch(e) {
      console.error("[Firestore] Read error:", e.message);
      showError("تعذر تحميل البيانات من قاعدة البيانات.");
      return;
    }
  } else {
    showError("قاعدة البيانات غير متصلة.");
    return;
  }
}

// Shows a soft banner instead of a hard error
function showQuotaMessage(msg) {
  const old = document.getElementById("quota-banner");
  if (old) old.remove();

  const banner = document.createElement("div");
  banner.id = "quota-banner";
  banner.style.cssText = [
    "background:linear-gradient(135deg,#1a2a1a,#0d1f2d)",
    "border:1px solid rgba(0,255,163,0.3)",
    "border-radius:16px",
    "padding:24px",
    "margin:20px 16px",
    "text-align:center",
    "color:#fff",
    "font-family:'Tajawal',sans-serif"
  ].join(";");
  banner.innerHTML = `
    <div style="font-size:32px;margin-bottom:10px">⏱️</div>
    <div style="font-size:16px;font-weight:700;color:#00ffa3;margin-bottom:8px">${msg}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.5)">يتم تجديد البيانات تلقائياً. شكراً لصبركم.</div>
  `;
  const container = document.getElementById("matches-container") || document.getElementById("main-content");
  if (container) container.prepend(banner);
  else document.body.prepend(banner);
}

// Data is now saved in standard format, no normalization needed for DB reads
function normalizeDbEvent(e) {
  return e;
}

// Direct API fallback using Football-Data.org
async function fetchMatchesDirect(dateStr) {
  const cacheBuster = Date.now();
  console.log(`[Fallback] Fetching matches for ${dateStr} directly from Football-Data.org... cb=${cacheBuster}`);
  try {
    const params = {
      dateFrom: dateStr,
      dateTo: dateStr,
      competitions: CONFIG.SUPPORTED_LEAGUES.join(','),
      _cb: cacheBuster
    };
    
    // Explicit logging for tomorrow's fetch to debug the URL
    if (dateStr === formatDateAPI(new Date(Date.now() + 86400000))) {
      console.log(`[Tomorrow Debug] URL: ${CONFIG.API_BASE_URL}/matches?dateFrom=${dateStr}&dateTo=${dateStr}&competitions=${params.competitions}`);
    }

    const data = await apiRequest("matches", params);

    return (data.matches || []).map(m => ({
      fixture: {
        id: m.id,
        status: { short: m.status, elapsed: m.minute || null },
        date: m.utcDate
      },
      league: { 
        name: m.competition.name, 
        id: m.competition.code, 
        logo: m.competition.emblem 
      },
      teams: {
        home: { name: m.homeTeam.shortName || m.homeTeam.name, id: m.homeTeam.id, logo: m.homeTeam.crest },
        away: { name: m.awayTeam.shortName || m.awayTeam.name, id: m.awayTeam.id, logo: m.awayTeam.crest }
      },
      goals: {
        home: m.score.fullTime.home,
        away: m.score.fullTime.away
      },
      score: m.score, // Include full score object (halfTime, fullTime, etc.)
      source: "football-data.org"
    }));
  } catch (e) {
    console.error("Direct API fallback failed:", e);
    return [];
  }
}

// Realtime DB updates listener
let liveDbListenerRef = null;
let liveDbCallback = null;

function setupLiveMatchesListener() {
  if (typeof firebase === 'undefined' || !firebase.firestore) return;

  // Unsubscribe from previous listener if exists
  if (STATE._unsubscribeMatches) {
    STATE._unsubscribeMatches();
    STATE._unsubscribeMatches = null;
  }

  const dateStr = formatDateAPI(STATE.currentDate);
  const todayDateStr = formatDateAPI(new Date());
  
  // Determine docId
  let docId = dateStr;
  if (dateStr === todayDateStr) docId = "today";
  else if (dateStr === formatDateAPI(new Date(Date.now() - 86400000))) docId = "yesterday";
  else if (dateStr === formatDateAPI(new Date(Date.now() + 86400000))) docId = "tomorrow";

  console.log(`[Firestore] Setting up Real-time Listener for: ${docId}`);
  
  const fs = firebase.firestore();
  STATE._unsubscribeMatches = fs.collection("matches").doc(docId).onSnapshot(docSnap => {
    if (docSnap.exists) {
      const data = docSnap.data();
      const newMatches = data.events || [];
      
      // Update state and UI
      STATE.allMatches = newMatches;
      console.log(`[Real-time] Received update for ${docId}: ${newMatches.length} matches. Last update: ${data.lastUpdated?.toDate().toLocaleTimeString() || 'N/A'}`);
      
      // Only render if not loading
      const loading = document.getElementById("loading-container");
      if (loading && loading.style.display === "none") {
        renderMatches(STATE.allMatches);
      }
    }
  }, err => {
    console.error(`[Real-time] Listener failed for ${docId}:`, err);
  });
}

async function fetchMatchDetailsServer(fixtureId) {
  // Try to find if this specific match needs fresh data from Firestore (Server source)
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    try {
      console.log(`[Firestore] Fetching fresh details for match ${fixtureId} from SERVER...`);
      // Note: Full incidents/stats would normally be in a separate collection or doc
      // For this implementation, we try the API fallback if Firestore doesn't have deep details
    } catch(e) {}
  }
  return await fetchMatchDetails(fixtureId);
}

async function fetchMatchDetails(fixtureId) {
  // CORS FIX: Do not fetch from API. Look into our STATE.allMatches (which is from Firestore)
  console.log(`[CORS-Fix] Looking for match ${fixtureId} details in local Firestore data...`);
  
  const match = STATE.allMatches.find(m => String(m.fixture.id) === String(fixtureId));
  
  if (match) {
    return {
      events: match.events || [], // These should be populated by our backend script
      statistics: match.statistics || [],
      lineups: match.lineups || { home: {}, away: {} },
      match: match
    };
  }

  console.warn(`[CORS-Fix] Match ${fixtureId} not found in pre-loaded data.`);
  return { events: [], statistics: [], lineups: { home: {}, away: {} } };
}

async function fetchStandings(leagueCode) {
  if (typeof firebase === 'undefined' || !firebase.firestore) return [];
  
  try {
    console.log(`[Standings] Reading from Firestore standings/${leagueCode}...`);
    const doc = await firebase.firestore().collection("standings").doc(leagueCode).get();
    
    if (doc.exists) {
      const data = doc.data();
      if (data && data.standings && data.standings.length > 0) {
        // Football-Data.org format: find the TOTAL type table
        const totalStanding = data.standings.find(s => s.type === "TOTAL");
        return totalStanding ? totalStanding.table : [];
      }
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch standings from Firestore:", error);
    return [];
  }
}

// ============================================
// RENDERING
// ============================================
function renderMatches(matches) {
  hideLoading();

  let filtered = matches;
  if (STATE.currentLeague !== "all") {
    filtered = matches.filter(
      (m) => String(m.league.id) === STATE.currentLeague
    );
  } else {
    // Only show supported leagues by default
    filtered = matches.filter((m) => CONFIG.SUPPORTED_LEAGUES.includes(String(m.league.id)));
  }

  const live = filtered.filter((m) => isLive(m.fixture.status.short) || m.fixture.status.short === "IN_PLAY");
  const scheduled = filtered.filter(
    (m) => ["NS", "TBD", "TIMED", "SCHEDULED"].includes(m.fixture.status.short)
  );
  const finished = filtered.filter((m) => ["FT", "AET", "PEN", "FINISHED"].includes(m.fixture.status.short));

  // Live section
  const liveSection = document.getElementById("live-section");
  const liveContainer = document.getElementById("live-matches");
  const liveCount = document.getElementById("live-count");

  if (live.length > 0) {
    liveSection.style.display = "block";
    liveCount.textContent = live.length;
    liveContainer.innerHTML = live.map((m) => matchCardHTML(m, "live")).join("");
  } else {
    liveSection.style.display = "none";
  }

  // Scheduled section
  const scheduledSection = document.getElementById("scheduled-section");
  const scheduledContainer = document.getElementById("scheduled-matches");
  const scheduledCount = document.getElementById("scheduled-count");

  if (scheduled.length > 0) {
    scheduledSection.style.display = "block";
    scheduledCount.textContent = scheduled.length;
    scheduledContainer.innerHTML = scheduled.map((m) => matchCardHTML(m, "scheduled")).join("");
  } else {
    scheduledSection.style.display = "none";
  }

  // Finished section
  const finishedSection = document.getElementById("finished-section");
  const finishedContainer = document.getElementById("finished-matches");
  const finishedCount = document.getElementById("finished-count");

  if (finished.length > 0) {
    finishedSection.style.display = "block";
    finishedCount.textContent = finished.length;
    finishedContainer.innerHTML = finished.map((m) => matchCardHTML(m, "finished")).join("");
  } else {
    finishedSection.style.display = "none";
  }

  // No matches message
  const noMatches = document.getElementById("no-matches");
  const noMatchesText = noMatches.querySelector('p');
  
  if (live.length === 0 && scheduled.length === 0 && finished.length === 0) {
    noMatchesText.textContent = t("noMatches");
    noMatches.style.display = "flex";
  } else {
    noMatches.style.display = "none";
  }
}

function matchCardHTML(match, type) {
  const { fixture, league, teams, goals } = match;
  const status = fixture.status;

  // Flexible score logic as requested
  const homeScore = match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? goals?.home ?? 0;
  const awayScore = match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? goals?.away ?? 0;

  let scoreSection = "";

  if (type === "live") {
    scoreSection = `
      <div class="match-score-section">
        <div class="match-score live-score">${homeScore} - ${awayScore}</div>
        <div class="match-minute">${status.elapsed != null ? status.elapsed + "'" : "LIVE"}${status.short === "HT" ? " HT" : ""}</div>
      </div>
    `;
  } else if (type === "scheduled") {
    const matchDate = new Date(fixture.date);
    const timeStr = matchDate.toLocaleTimeString(STATE.currentLang === "ar" ? "ar-EG" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    scoreSection = `
      <div class="match-score-section">
        <div class="match-time-scheduled">${timeStr}</div>
      </div>
    `;
  } else {
    scoreSection = `
      <div class="match-score-section">
        <div class="match-score">${homeScore} - ${awayScore}</div>
        <div class="match-status-ft">${t("fullTime")}</div>
      </div>
    `;
  }

  return `
    <div class="match-card ${type === "live" ? "live" : ""}" data-id="${fixture.id}">
      <div class="match-card-league">
        <img src="${league.logo}" alt="${league.name}" onerror="this.style.display='none'" />
        <span>${league.name}</span>
      </div>
      <div class="match-card-body">
        <div class="match-team">
          <img class="match-team-logo team-logo" src="${teams.home.logo}" alt="${teams.home.name}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iIzJiMmQ0MiIvPjwvc3ZnPg=='" />
          <span class="match-team-name">${teams.home.name}</span>
        </div>
        ${scoreSection}
        <div class="match-team">
          <img class="match-team-logo team-logo" src="${teams.away.logo}" alt="${teams.away.name}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iIzJiMmQ0MiIvPjwvc3ZnPg=='" />
          <span class="match-team-name">${teams.away.name}</span>
        </div>
      </div>
    </div>
  `;
}

// ============================================
// MATCH DETAIL MODAL
// ============================================
async function openMatchDetail(fixtureId) {
  const modal = document.getElementById("match-modal");
  const modalBody = document.getElementById("modal-body");
  const modalLeagueName = document.getElementById("modal-league-name");

  // Clear previous content to avoid ghosting
  modalBody.innerHTML = '<div class="loading-container" style="display:flex; padding: 40px;"><div class="loading-spinner"></div></div>';
  modalLeagueName.textContent = "...";

  const match = STATE.allMatches.find((m) => m.fixture.id === fixtureId);
  if (!match) return;

  console.log(`[Interaction] Opening match details for ID: ${fixtureId}, Current Status: ${match.fixture.status.short}`);

  modalLeagueName.textContent = match.league.name;

  // Show modal with loading
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  const statusText =
    isLive(match.fixture.status.short)
      ? (match.fixture.status.elapsed != null ? `${match.fixture.status.elapsed}'` : "LIVE")
      : isFinished(match.fixture.status.short)
      ? t("fullTime")
      : new Date(match.fixture.date).toLocaleTimeString(
          STATE.currentLang === "ar" ? "ar-EG" : "en-US",
          { hour: "2-digit", minute: "2-digit", hour12: false }
        );

  const isLiveMatch = isLive(match.fixture.status.short);

  modalBody.innerHTML = `
    <div class="modal-match-header">
      <div class="modal-team">
        <img src="${match.teams.home.logo}" alt="${match.teams.home.name}" onerror="this.style.display='none'" />
        <span>${match.teams.home.name}</span>
      </div>
      <div class="modal-score-box">
        <div class="modal-score">${match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? match.goals?.home ?? "-"} - ${match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? match.goals?.away ?? "-"}</div>
        ${isLiveMatch ? `<div class="modal-minute">${statusText}</div>` : `<div class="match-status-ft">${statusText}</div>`}
      </div>
      <div class="modal-team">
        <img src="${match.teams.away.logo}" alt="${match.teams.away.name}" onerror="this.style.display='none'" />
        <span>${match.teams.away.name}</span>
      </div>
    </div>

    <div class="modal-tabs">
      <button class="modal-tab active" onclick="switchModalTab('events', this)">${t("events")}</button>
      <button class="modal-tab" onclick="switchModalTab('statistics', this)">${t("stats")}</button>
      <button class="modal-tab" onclick="switchModalTab('lineups-tab', this)">${t("lineups")}</button>
    </div>

    <div id="modal-events" class="modal-tab-content active">
      <div class="loading-container"><div class="loading-spinner"></div></div>
    </div>
    <div id="modal-statistics" class="modal-tab-content"></div>
    <div id="modal-lineups-tab" class="modal-tab-content"></div>
  `;

  // Fetch details - FORCE SERVER to bypass cache
  const details = await fetchMatchDetailsServer(fixtureId);
  console.log(`[Interaction] Details Received:`, details);

  const eventsContainer = document.getElementById("modal-events");
  const statsContainer = document.getElementById("modal-statistics");
  const lineupsContainer = document.getElementById("modal-lineups-tab");
  const status = match.fixture.status.short;

  const isStarted = isFinished(status) || isLive(status);

  // Render events
  if (isStarted) {
    if (details.events && details.events.length > 0) {
      eventsContainer.innerHTML = renderEvents(details.events);
    } else {
      eventsContainer.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:20px">${STATE.currentLang === "ar" ? "لا توجد أحداث" : "No events yet"}</p>`;
    }
  } else {
    eventsContainer.innerHTML = `<div style="text-align:center; padding:20px;"><p style="color:var(--text-secondary);">${STATE.currentLang === "ar" ? "أحداث المباراة لم تبدأ" : "Match events have not started"}</p></div>`;
  }

  // Render statistics with fallback logic
  if (isStarted) {
    if (details.statistics && details.statistics.length > 0) {
      const stats = parseStats(details.statistics);
      statsContainer.innerHTML = renderStats(stats);
    } else {
      // Enhanced stats-missing display
      const goalsList = details.events?.filter(ev => ev.incidentType === "goal") || [];
      let goalsInfo = "";
      if (goalsList.length > 0) {
        goalsInfo = `<div style="margin-bottom:15px; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px;">
          <h4 style="margin-bottom:8px; color:var(--accent);">${STATE.currentLang === "ar" ? "مسجلي الأهداف" : "Scorers"}</h4>
          ${renderEvents(goalsList)}
        </div>`;
      }

      statsContainer.innerHTML = `
        <div style="text-align:center; padding:20px;">
          ${goalsInfo}
          <i class="fas fa-info-circle fa-2x" style="opacity:0.3; margin-bottom:10px;"></i>
          <p style="color:var(--text-secondary);">${STATE.currentLang === "ar" ? "الإحصائيات التفصيلية غير متوفرة لهذا الدوري" : "Detailed statistics not available for this league"}</p>
        </div>
      `;
    }
  } else {
    statsContainer.innerHTML = `
      <div style="text-align:center; padding:20px;">
        <i class="fas fa-chart-bar fa-2x" style="opacity:0.3; margin-bottom:10px;"></i>
        <p style="color:var(--text-secondary);">${STATE.currentLang === "ar" ? "الإحصائيات ستكون متاحة أثناء وبعد المباراة" : "Statistics will be available during and after the match"}</p>
      </div>
    `;
  }

  // Set the lineups logic container logic relies on 'status' being available, which was already defined above

  if (isFinished(status) || isLive(status)) {
    if (details.lineups && (details.lineups.home?.players || details.lineups.away?.players)) {
      lineupsContainer.innerHTML = renderLineups(details.lineups, match);
    } else {
      lineupsContainer.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:30px">${STATE.currentLang === "ar" ? "التشكيلات غير متوفرة بعد" : "Lineups not available yet"}</p>`;
    }
  } else {
    // Scheduled/Timed
    const msg = STATE.currentLang === "ar" 
      ? "التشكيلات ستتوفر قبل المباراة بـ 60 دقيقة" 
      : "Lineups will be available 60 minutes before kickoff";
    lineupsContainer.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:30px;font-weight:700">${msg}</p>`;
  }
}

function renderEvents(incidents) {
  let html = '<div class="events-timeline">';
  // SportAPI7 provides an array of incidents directly
  if (!Array.isArray(incidents)) return html + '</div>';
  
  // Sort by time ascending
  const sorted = [...incidents].sort((a, b) => (a.time || 0) - (b.time || 0));

  sorted.forEach((ev) => {
    let iconClass = "subst";
    let label = "⚡";
    let detailText = ev.playerName || ev.player?.name || "";

    if (ev.incidentType === "goal") {
      iconClass = "goal";
      label = "⚽";
    } else if (ev.incidentType === "card") {
      if (ev.incidentClass === "yellow") {
         iconClass = "card-yellow";
         label = "🟡";
      } else if (ev.incidentClass === "red") {
         iconClass = "card-red";
         label = "🔴";
      } else {
         iconClass = "card-yellow";
         label = "�";
      }
    } else if (ev.incidentType === "substitution") {
      iconClass = "subst";
      label = "🔄";
      detailText = `${ev.playerIn?.name || ""} <small>🔄 ${ev.playerOut?.name || ""}</small>`;
    }

    // Determine side based on isHome
    const alignClass = ev.isHome ? "home-event" : "away-event";

    html += `
      <div class="event-item ${alignClass}">
        <div class="event-icon ${iconClass}">${label}</div>
        <div class="event-time">${ev.time || ""}'</div>
        <div class="event-detail">
          ${detailText}
        </div>
      </div>
    `;
  });
  html += "</div>";
  return html;
}

function parseStats(statsArray) {
  if (!Array.isArray(statsArray)) return [];
  // Find period="ALL"
  const allStats = statsArray.find(s => s.period === "ALL" || s.period === "1ST");
  if (!allStats || !allStats.groups) return [];

  let flatStats = [];
  allStats.groups.forEach(group => {
    if (Array.isArray(group.statisticsItems)) {
      group.statisticsItems.forEach(item => {
        flatStats.push({
          type: item.name || item.key,
          home: String(item.home || item.homeValue || "0"),
          away: String(item.away || item.awayValue || "0"),
        });
      });
    }
  });

  return flatStats;
}

function renderStats(stats) {
  let html = "";
  stats.forEach((stat) => {
    const homeVal = parseFloat(stat.home) || 0;
    const awayVal = parseFloat(stat.away) || 0;
    const total = homeVal + awayVal || 1;
    const homePercent = (homeVal / total) * 100;
    const awayPercent = (awayVal / total) * 100;

    html += `
      <div class="stat-row">
        <span class="stat-value">${stat.home}</span>
        <div class="stat-bar-container left">
          <div class="stat-bar home-bar" style="width:${homePercent}%"></div>
        </div>
        <span class="stat-label">${translateStat(stat.type)}</span>
        <div class="stat-bar-container">
          <div class="stat-bar away-bar" style="width:${awayPercent}%"></div>
        </div>
        <span class="stat-value">${stat.away}</span>
      </div>
    `;
  });
  return html;
}

function translateStat(type) {
  if (STATE.currentLang !== "ar") return type;
  const map = {
    "Ball Possession": "الاستحواذ",
    "Total Shots": "التسديدات",
    "Shots on Goal": "على المرمى",
    "Shots off Goal": "خارج المرمى",
    "Blocked Shots": "مسدودة",
    "Shots insidebox": "داخل الصندوق",
    "Shots outsidebox": "خارج الصندوق",
    "Corner Kicks": "الركنيات",
    Fouls: "الأخطاء",
    Offsides: "التسلل",
    "Yellow Cards": "بطاقات صفراء",
    "Red Cards": "بطاقات حمراء",
    "Total passes": "التمريرات",
    "Passes accurate": "تمريرات دقيقة",
    "Passes %": "دقة التمريرات",
    "Goalkeeper Saves": "تصديات",
    "expected_goals": "الأهداف المتوقعة",
  };
  return map[type] || type;
}

function renderLineups(lineupsData, match) {
  let html = "";
  if (!lineupsData) return html;

  const sides = [
    { key: "home", teamName: match.teams.home.name, teamLogo: match.teams.home.logo },
    { key: "away", teamName: match.teams.away.name, teamLogo: match.teams.away.logo }
  ];

  sides.forEach(side => {
    const lineup = lineupsData[side.key];
    if (!lineup || !lineup.players) return;

    html += `
      <div class="lineup-section">
        <div class="lineup-team-name">
          <img src="${side.teamLogo}" alt="${side.teamName}" onerror="this.style.display='none'" />
          ${side.teamName}
        </div>
        <div class="lineup-formation">${t("formation")}: ${lineup.formation || "N/A"}</div>
    `;

    lineup.players.forEach((p) => {
      const player = p.player;
      html += `
        <div class="lineup-player">
          <span class="player-number">${player.jerseyNumber || player.shirtNumber || ""}</span>
          <span class="player-name">${player.name || player.shortName || ""}</span>
          <span class="player-pos">${player.position || ""}</span>
        </div>
      `;
    });

    html += "</div>";
  });
  return html;
}

function closeModal() {
  const modal = document.getElementById("match-modal");
  modal.style.display = "none";
  document.body.style.overflow = "";
}

function switchModalTab(tabId, btn) {
  document.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".modal-tab-content").forEach((t) => t.classList.remove("active"));

  btn.classList.add("active");
  document.getElementById("modal-" + tabId).classList.add("active");
}

// ============================================
// STANDINGS
// ============================================
async function loadStandings() {
  const container = document.getElementById("standings-table-container");
  const selectorContainer = document.getElementById("standings-league-selector");

  const leagues = [
    { id: "PL", name: t("premierLeague") },
    { id: "PD", name: t("laLiga") },
    { id: "SA", name: t("serieA") },
    { id: "BL1", name: t("bundesliga") },
    { id: "FL1", name: t("ligue1") },
    { id: "CL", name: t("championsLeague") },
  ];

  selectorContainer.innerHTML = leagues
    .map(
      (l, i) =>
        `<button class="standings-league-btn ${i === 0 ? "active" : ""}" onclick="selectStandingsLeague('${l.id}', this)">${l.name}</button>`
    )
    .join("");

  container.innerHTML =
    '<div class="loading-container"><div class="loading-spinner"></div></div>';

  const standings = await fetchStandings(leagues[0].id);
  renderStandingsTable(standings);
}

async function selectStandingsLeague(leagueId, btn) {
  document.querySelectorAll(".standings-league-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  const container = document.getElementById("standings-table-container");
  container.innerHTML =
    '<div class="loading-container"><div class="loading-spinner"></div></div>';

  const standings = await fetchStandings(leagueId);
  renderStandingsTable(standings);
}

function renderStandingsTable(standings) {
  const container = document.getElementById("standings-table-container");

  if (!standings || standings.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:30px">${STATE.currentLang === "ar" ? "لا تتوفر بيانات الترتيب" : "No standings data available"}</p>`;
    return;
  }

  let html = `
    <table class="standings-table">
      <thead>
        <tr>
          <th>${t("rank")}</th>
          <th>${t("team")}</th>
          <th>${t("played")}</th>
          <th>${t("won")}</th>
          <th>${t("drawn")}</th>
          <th>${t("lost")}</th>
          <th>${t("gd")}</th>
          <th>${t("pts")}</th>
        </tr>
      </thead>
      <tbody>
  `;

  standings.forEach((team) => {
    const teamData = team.team;
    html += `
      <tr>
        <td><span class="standings-rank ${team.position <= 4 ? "top" : ""}">${team.position}</span></td>
        <td>
          <div class="standings-team-cell">
            <img class="team-logo" src="${teamData.crest}" alt="${teamData.name}" onerror="this.style.display='none'" />
            <span class="standings-team-name">${teamData.shortName || teamData.name}</span>
          </div>
        </td>
        <td>${team.playedGames}</td>
        <td>${team.won}</td>
        <td>${team.draw}</td>
        <td>${team.lost}</td>
        <td>${team.goalDifference > 0 ? "+" : ""}${team.goalDifference}</td>
        <td class="standings-pts">${team.points}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

// ============================================
// NAVIGATION & UI
// ============================================
function switchPage(page, el, e) {
  e.preventDefault();

  // Update nav
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  el.classList.add("active");

  STATE.currentPage = page;

  // Hide all pages
  document.getElementById("live-section").style.display = "none";
  document.getElementById("scheduled-section").style.display = "none";
  document.getElementById("finished-section").style.display = "none";
  document.getElementById("no-matches").style.display = "none";
  document.getElementById("standings-page").style.display = "none";
  document.getElementById("news-page").style.display = "none";
  document.getElementById("league-filter-section").style.display = "none";
  document.getElementById("date-section").style.display = "none";
  document.getElementById("loading-container").style.display = "none";
  document.getElementById("error-container").style.display = "none";

  if (page === "matches") {
    document.getElementById("league-filter-section").style.display = "block";
    document.getElementById("date-section").style.display = "flex";
    renderMatches(STATE.allMatches);
  } else if (page === "standings") {
    document.getElementById("standings-page").style.display = "block";
    loadStandings();
  } else if (page === "news") {
    document.getElementById("news-page").style.display = "block";
  }
}

function filterByLeague(leagueId, btn) {
  STATE.currentLeague = leagueId;

  document.querySelectorAll(".league-chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");

  renderMatches(STATE.allMatches);
}

function changeDate(offset) {
  // In RTL, arrow directions are reversed visually so we flip offset
  const dir = STATE.currentLang === "ar" ? -offset : offset;
  STATE.currentDate.setDate(STATE.currentDate.getDate() + dir);
  updateDateDisplay();
  fetchMatches();
}

function updateDateDisplay() {
  const el = document.getElementById("current-date");
  const today = new Date();
  const date = STATE.currentDate;

  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear();

  if (isToday) {
    el.textContent = t("today");
  } else if (isYesterday) {
    el.textContent = t("yesterday");
  } else if (isTomorrow) {
    el.textContent = t("tomorrow");
  } else {
    el.textContent = date.toLocaleDateString(
      STATE.currentLang === "ar" ? "ar-EG" : "en-US",
      { weekday: "short", month: "short", day: "numeric" }
    );
  }
}

// ============================================
// LANGUAGE
// ============================================
function toggleLanguage() {
  STATE.currentLang = STATE.currentLang === "ar" ? "en" : "ar";
  const htmlEl = document.getElementById("html-root");

  htmlEl.setAttribute("lang", STATE.currentLang);
  htmlEl.setAttribute("dir", STATE.currentLang === "ar" ? "rtl" : "ltr");

  document.getElementById("lang-switcher").textContent =
    STATE.currentLang === "ar" ? "EN" : "عربي";

  // Update all i18n elements
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (i18n[STATE.currentLang][key]) {
      el.textContent = i18n[STATE.currentLang][key];
    }
  });

  updateDateDisplay();

  // Re-render current page
  if (STATE.currentPage === "matches") {
    renderMatches(STATE.allMatches);
  } else if (STATE.currentPage === "standings") {
    loadStandings();
  }
}

function t(key) {
  return i18n[STATE.currentLang]?.[key] || key;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function formatDateAPI(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isLive(statusShort) {
  const liveStatuses = ["IN_PLAY", "PAUSED", "LIVE", "1H", "HT", "2H", "ET", "BT", "P", "INT"];
  return liveStatuses.includes(statusShort);
}

function isFinished(statusShort) {
  const finishedStatuses = ["FINISHED", "FT", "AET", "PEN", "AWD", "WO"];
  return finishedStatuses.includes(statusShort);
}

function showLoading() {
  document.getElementById("loading-container").style.display = "flex";
  document.getElementById("live-section").style.display = "none";
  document.getElementById("scheduled-section").style.display = "none";
  document.getElementById("finished-section").style.display = "none";
  document.getElementById("no-matches").style.display = "none";
}

function hideLoading() {
  document.getElementById("loading-container").style.display = "none";
}

function showError(message) {
  hideLoading();
  const errorContainer = document.getElementById("error-container");
  document.getElementById("error-message").textContent = message;
  errorContainer.style.display = "flex";
}

function hideError() {
  document.getElementById("error-container").style.display = "none";
}

function refreshData() {
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("spinning");
  setTimeout(() => btn.classList.remove("spinning"), 1000);

  if (STATE.currentPage === "matches") {
    fetchMatches();
  } else if (STATE.currentPage === "standings") {
    loadStandings();
  }
}

// ============================================
// AUTO REFRESH
// ============================================
function startAutoRefresh() {
  stopAutoRefresh();

  let elapsed = 0;
  const interval = 1000; // 1 second
  const totalSeconds = CONFIG.REFRESH_INTERVAL / 1000;

  STATE.progressTimer = setInterval(() => {
    elapsed++;
    const progress = (elapsed / totalSeconds) * 100;
    const bar = document.getElementById("refresh-progress");
    if (bar) bar.style.width = `${progress}%`;

    if (elapsed >= totalSeconds) {
      elapsed = 0;
      if (bar) bar.style.width = "0%";

      // Only auto-refresh on matches page
      if (STATE.currentPage === "matches") {
        fetchMatches();
        // FORCE LIVE UPDATE: Push fresh IN_PLAY scores to Firestore every cycle
        syncLiveScoresToFirestore();
      }
    }
  }, interval);
}

async function syncLiveScoresToFirestore() {
  console.log("[Auto-Sync] Client-side auto-sync is disabled. Server-side GitHub action is handling real-time updates directly to Firestore.");
}

function stopAutoRefresh() {
  if (STATE.progressTimer) {
    clearInterval(STATE.progressTimer);
    STATE.progressTimer = null;
  }
}

// ============================================
// API KEY MANAGEMENT
// ============================================
// ============================================
// FIREBASE SYNC (REAL-TIME GLOBAL SETTINGS)
// ============================================
async function initFirebaseSync() {
  console.log("Initializing Firebase Real-time Sync...");
  
  if (typeof firebase === 'undefined') {
    console.warn("Firebase SDK not loaded, using fallback key");
    loadDemoMode();
    return;
  }

  // Ensure Firebase is initialized
  if (!firebase.apps.length) {
    try {
      // Use config from global scope (index.html) if available
      if (typeof firebaseConfig !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
      }
    } catch(e) { console.error("Firebase init fallback failed:", e); }
  }

  const db = firebase.firestore();
  
  // Listen for real-time changes to the settings
  db.collection("settings").doc("global").onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      // Flexible field naming check with cleanup (removes spaces and quotes)
      let rawKey = data.apiKey || data.api_key || data.key || data.korra || "";
      const firebaseKey = rawKey.trim().replace(/['"]+/g, '');
      console.log("Firebase Sync: received key length:", firebaseKey.length);
      
      if (firebaseKey) {
        STATE.apiKey = firebaseKey;
        console.log("Using Firebase API key.");
      } else {
        // Use fallback if Firebase has no key
        STATE.apiKey = CONFIG.FALLBACK_API_KEY;
        console.warn("No key in Firestore, using fallback key.");
      }

      // Sync Ads Config
      if (data.adsenseId) ADS_CONFIG.publisherId = data.adsenseId;
      if (data.propellerId) ADS_CONFIG.propellerId = data.propellerId;
      if (data.adFrequency) ADS_CONFIG.interstitialFrequency = parseInt(data.adFrequency);
      console.log("Ads settings synced:", ADS_CONFIG);

      document.getElementById("api-key-modal").style.display = "none";
      
      // Firestore Stability Settings
      try {
        db.settings({ experimentalForceLongPolling: true });
        console.log("Firestore: Long Polling enabled for stability.");
      } catch(e) { console.warn("Firestore settings already applied."); }

      // Only initialize once, or refresh if data changes
      if (!STATE.isFirebaseLoaded) {
        STATE.isFirebaseLoaded = true;
        initApp();
      } else {
        refreshData();
      }
    } else {
      console.warn("No settings doc in Firestore. Using fallback key.");
      STATE.apiKey = CONFIG.FALLBACK_API_KEY;
      document.getElementById("api-key-modal").style.display = "none";
      if (!STATE.isFirebaseLoaded) {
        STATE.isFirebaseLoaded = true;
        initApp();
      }
    }
  }, (error) => {
    console.error("Firestore Error:", error, "- Using fallback key.");
    // On any Firestore error, use fallback key and start app
    if (!STATE.isFirebaseLoaded) {
      STATE.isFirebaseLoaded = true;
      STATE.apiKey = CONFIG.FALLBACK_API_KEY;
      document.getElementById("api-key-modal").style.display = "none";
      initApp();
    }
  });
}

function checkApiKey() {
  // Use fallback key immediately so app starts fast
  // Firebase sync will override it when ready
  if (!STATE.apiKey) {
    STATE.apiKey = CONFIG.FALLBACK_API_KEY;
  }
  // If Firebase is not being used (initFirebaseSync not called), start app directly
}

function loadDemoMode() {
  console.log("Using default API integration");
  STATE.apiKey = CONFIG.FALLBACK_API_KEY;
  if (!STATE._appStarted) initApp();
}

// ============================================
// MODAL CLOSE ON OVERLAY CLICK
// ============================================
document.getElementById("match-modal").addEventListener("click", function (e) {
  if (e.target === this) {
    closeModal();
  }
});

// ============================================
// AD MANAGEMENT SYSTEM (ADSENSE / PROPELLERRADS / ETC)
// ============================================
const ADS_CONFIG = {
  interstitialFrequency: 5, // Show every 5 matches clicked
  matchClickCount: 0,
  isEnabled: true
};

// ============================================
// ANALYTICS & TRACKING (REAL DATA)
// ============================================
async function logVisit() {
  if (typeof firebase === 'undefined') return;
  const db = firebase.firestore();
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Increment global visits
    db.collection("analytics").doc("global").set({
      totalVisits: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });

    // Increment daily visits
    db.collection("analytics").doc("daily").collection("dates").doc(today).set({
      visits: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch (e) {
    console.error("Analytics error:", e);
  }
}

async function logClick(type = "match") {
  if (typeof firebase === 'undefined') return;
  const db = firebase.firestore();
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const field = type === "ad" ? "adClicks" : "matchClicks";
    db.collection("analytics").doc("global").set({
      [field]: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });

    db.collection("analytics").doc("daily").collection("dates").doc(today).set({
      [field]: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch (e) {
    console.error("Click Tracking error:", e);
  }
}

function initAds() {
  console.log("Ads System Initialized");
  // Logic to load AdSense auto-ads if ID exists in Firestore
}

function showInterstitial() {
  if (!ADS_CONFIG.isEnabled) return;
  
  logClick("match"); // Track actual match click
  ADS_CONFIG.matchClickCount++;
  if (ADS_CONFIG.matchClickCount % ADS_CONFIG.interstitialFrequency === 0) {
    console.log("Showing Interstitial Ad...");
    renderInterstitialOverlay();
  }
}

function renderInterstitialOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'interstitial-ad';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '9999';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width: 400px; padding: 30px; text-align: center; border-radius: 20px;">
      <div class="ad-badge" style="position:static; display:inline-block; margin-bottom:15px;">ADVERTISEMENT</div>
      <h3 style="margin-bottom:10px;">إعلان ممول</h3>
      <div style="background:#0d1117; height:250px; border-radius:15px; display:flex; align-items:center; justify-content:center; margin-bottom:20px; border: 1px dashed var(--border);">
         <i class="fas fa-image fa-3x" style="opacity:0.2"></i>
      </div>
      <button class="btn-primary" onclick="logClick('ad'); this.closest('#interstitial-ad').remove()" style="width:100%; padding:12px; background:var(--accent); border:none; border-radius:10px; font-weight:700; cursor:pointer;">إغلاق الإعلان</button>
      <p style="font-size:10px; color:var(--text-secondary); margin-top:10px;">سيختفي الإعلان تلقائياً بعد قليل...</p>
    </div>
  `;
  document.body.appendChild(overlay);
  
  // Auto close after 10 seconds if user doesn't
  setTimeout(() => {
    if (document.getElementById('interstitial-ad')) {
      document.getElementById('interstitial-ad').remove();
    }
  }, 10000);
}

// ============================================
// INITIALIZATION
// ============================================
function initApp() {
  if (STATE._appStarted) {
    // Already started, just refresh data
    fetchMatches();
    return;
  }
  STATE._appStarted = true;
  updateDateDisplay();
  fetchMatches();
  startAutoRefresh();
  syncLiveScoresToFirestore(); // Initial manual-like sync on startup
  initAds(); // Start Ads
  logVisit(); // Track real visitor
}

// DOMContentLoaded fallback - handled from index.html now
