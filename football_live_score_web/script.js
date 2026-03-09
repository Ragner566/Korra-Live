// =============================================================
//  LiveScore Pro - Full API Integration with API-Football
//  Uses: https://rapidapi.com/api-sports/api/api-football
// =============================================================

// ============================================
// CONFIG & STATE
// ============================================
// Configuration for SportAPI (New Host)
let CONFIG = {
  API_HOST: "sportapi7.p.rapidapi.com",
  RAPID_API_HOST: "sportapi7.p.rapidapi.com",
  REFRESH_INTERVAL: 180000, // 3 minutes to save quota
  // Fallback API key used if Firebase is unavailable
  FALLBACK_API_KEY: "25603f0a6emsh854d8c40c5ed2adp15d8f1jsn5e59f1e42a5d",
  // Top 5 leagues + major regions
  IMPORTANT_LEAGUES: [17, 8, 23, 35, 34, 7, 808, 955, 52, 96, 1460, 676, 668, 18, 131, 36, 170, 155]
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
  isFirebaseLoaded: false,
  _appStarted: false
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
// API FUNCTIONS 
// ============================================
async function apiRequest(endpoint, params = {}) {
  const url = new URL(`https://${CONFIG.RAPID_API_HOST}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const keyToUse = STATE.apiKey ? STATE.apiKey.trim() : "";
  console.log(`[API Request] fetching ${endpoint}. Key length: ${keyToUse.length}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-host": CONFIG.RAPID_API_HOST,
        "x-rapidapi-key": keyToUse,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error ${response.status}:`, errorText);
      
      if (response.status === 429) {
        throw new Error("429 Too Many Requests");
      }
      if (response.status === 403 || response.status === 401) {
        throw new Error(`Auth Error ${response.status}: ` + errorText.substring(0, 50));
      }
      throw new Error(`API error: ${response.status} - ${errorText.substring(0, 50)}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("API Request failed for", endpoint, ":", error);
    throw error;
  }
}

// ============================================
// DATA FETCHING
// ============================================
async function fetchMatches() {
  const dateStr = formatDateAPI(STATE.currentDate);
  const todayStr = formatDateAPI(new Date());
  const isToday = dateStr === todayStr;

  showLoading();
  hideError();

  // ── DATABASE-FIRST STRATEGY ──────────────────────────────
  // For today: read from Firebase Realtime DB (populated by GitHub Actions every 15 min)
  // For other dates: call API directly
  if (isToday && typeof firebase !== 'undefined' && firebase.database) {
    try {
      console.log("[DB-First] Reading Firebase Realtime DB...");
      const snap = await firebase.database().ref("/live_matches").once("value");
      const dbData = snap.val();

      // ── QUOTA EXCEEDED ─────────────────────────────────
      if (dbData && dbData.quotaExceeded) {
        hideLoading();
        showQuotaMessage(dbData.quotaMessage || "سيتم تحديث النتائج قريباً");
        if (dbData.events && dbData.events.length > 0) {
          const events = dbData.events.map(normalizeDbEvent);
          STATE.allMatches = events;
          renderMatches(events);
        }
        setupLiveMatchesListener();
        return;
      }

      // ── FRESH DATA FROM DB ───────────────────────────
      if (dbData && dbData.events && dbData.events.length > 0) {
        const events = dbData.events.map(normalizeDbEvent);
        STATE.allMatches = events;
        hideLoading();
        renderMatches(events);
        setupLiveMatchesListener();
        return;
      }

      // DB empty — fall through to direct API
      console.warn("[DB-First] DB empty, calling API directly...");
    } catch(e) {
      console.warn("[DB-First] Firebase read failed, using API:", e.message);
    }
  }

  // ── DIRECT API FALLBACK ───────────────────────────────
  try {
    const allEvents = await fetchMatchesDirect(dateStr);
    STATE.allMatches = allEvents;
    renderMatches(allEvents);
  } catch(error) {
    if (error.message.includes("429")) {
      showQuotaMessage("سيتم تحديث النتائج قريباً — تجاوزنا الحد اليومي مؤقتاً");
    } else {
      showError(error.message);
    }
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

// Normalize events from Football-Data.org / API-Sports format stored in DB
function normalizeDbEvent(e) {
  // Already SportAPI7 format (has status.type object)
  if (e.status && typeof e.status === "object" && e.status.type) {
    return mapSportAPI7ToStandard(e);
  }

  // Football-Data.org / API-Sports string status
  const statusMap = {
    "SCHEDULED": "NS", "TIMED": "NS",
    "IN_PLAY": "LIVE", "1H": "LIVE", "2H": "LIVE", "ET": "LIVE", "P": "LIVE",
    "PAUSED": "HT", "HALFTIME": "HT",
    "FINISHED": "FT", "AWARDED": "FT",
    "SUSPENDED": "SUSP", "POSTPONED": "PST", "CANCELLED": "CAN"
  };
  const statusShort = statusMap[(e.status || "").toUpperCase()] || e.status || "NS";
  const isLive = ["LIVE", "HT"].includes(statusShort);

  return {
    id: e.id,
    homeTeam: { name: e.homeTeam?.name || "—", logo: null },
    awayTeam: { name: e.awayTeam?.name || "—", logo: null },
    homeScore: e.score?.home ?? (isLive ? 0 : null),
    awayScore: e.score?.away ?? (isLive ? 0 : null),
    homeHalf:  e.score?.halfHome ?? null,
    awayHalf:  e.score?.halfAway ?? null,
    status: statusShort,
    statusDisplay: statusShort,
    startTime: e.utcDate
      ? new Date(e.utcDate).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
      : "--:--",
    league: { id: 0, name: e.competition?.name || "—", logo: null },
    elapsed: e.minute ?? null,
    source: e.source || "db"
  };
}

// Direct API fallback when DB is empty
async function fetchMatchesDirect(dateStr) {
  console.log("Direct API: fetching scheduled + live...");
  const scheduledData = await apiRequest(`api/v1/sport/football/scheduled-events/${dateStr}`);
  await new Promise(r => setTimeout(r, 2500));
  const liveData = await apiRequest(`api/v1/sport/football/events/live`);

  const eventIds = new Set();
  return [...(liveData.events||[]), ...(scheduledData.events||[])]
    .filter(ev => { if (!ev?.id || eventIds.has(ev.id)) return false; eventIds.add(ev.id); return true; })
    .map(mapSportAPI7ToStandard);
}

// Global Realtime DB listener
let liveDbListenerRef = null;
let liveDbCallback = null;

function setupLiveMatchesListener() {
  if (liveDbListenerRef && liveDbCallback) {
    liveDbListenerRef.off("value", liveDbCallback);
  }
  if (typeof firebase === 'undefined' || !firebase.database) return;

  liveDbListenerRef = firebase.database().ref("/live_matches");
  liveDbCallback = liveDbListenerRef.on("value", snapshot => {
    const data = snapshot.val();
    if (!data) return;

    if (data.quotaExceeded) {
      showQuotaMessage(data.quotaMessage || "سيتم تحديث النتائج قريباً");
      return;
    }

    const banner = document.getElementById("quota-banner");
    if (banner) banner.remove();

    if (data.events && data.events.length > 0) {
      console.log("[Realtime DB] Updated — refreshing view...");
      const mapped = data.events.map(normalizeDbEvent);
      const updated = [...STATE.allMatches];
      mapped.forEach(ev => {
        const idx = updated.findIndex(m => m.id === ev.id);
        if (idx !== -1) updated[idx] = Object.assign(updated[idx], ev);
        else updated.push(ev);
      });
      STATE.allMatches = updated;
      renderMatches(updated);
    }
  });
}

// Normalization layer for SportAPI7
function mapSportAPI7ToStandard(event) {
  const statusType = event.status?.type || "notstarted";
  const statusDesc = event.status?.description || "";
  
  let statusShort = "NS";
  if (statusType === "inprogress") statusShort = "LIVE";
  else if (statusType === "finished") statusShort = "FT";
  else if (statusType === "canceled") statusShort = "CAN";

  return {
    fixture: {
      id: event.id,
      status: {
        short: statusShort,
        long: statusDesc,
        elapsed: (event.time?.current || event.time?.initial) ? Math.floor((event.time?.current || event.time?.initial) / 60) : null
      },
      date: new Date(event.startTimestamp * 1000).toISOString()
    },
    league: {
      id: event.tournament?.uniqueTournament?.id || event.uniqueTournament?.id || 0,
      name: event.tournament?.uniqueTournament?.name || event.uniqueTournament?.name || "Other",
      logo: (event.tournament?.uniqueTournament?.id || event.uniqueTournament?.id) 
        ? `https://img.sofascore.com/api/v1/unique-tournament/${event.tournament?.uniqueTournament?.id || event.uniqueTournament?.id}/image` 
        : ""
    },
    teams: {
      home: {
        id: event.homeTeam?.id || 0,
        name: event.homeTeam?.name || "TBA",
        logo: event.homeTeam?.id ? `https://img.sofascore.com/api/v1/team/${event.homeTeam.id}/image` : ""
      },
      away: {
        id: event.awayTeam?.id || 0,
        name: event.awayTeam?.name || "TBA",
        logo: event.awayTeam?.id ? `https://img.sofascore.com/api/v1/team/${event.awayTeam.id}/image` : ""
      }
    },
    goals: {
      home: event.homeScore?.current ?? 0,
      away: event.awayScore?.current ?? 0
    }
  };
}

async function fetchMatchDetails(fixtureId) {


  try {
    const [eventsRes, statsRes, lineupsRes] = await Promise.all([
      apiRequest(`api/v1/event/${fixtureId}/incidents`).catch(() => ({ incidents: [] })),
      apiRequest(`api/v1/event/${fixtureId}/statistics`).catch(() => ({ statistics: [] })),
      apiRequest(`api/v1/event/${fixtureId}/lineups`).catch(() => ({ home: {}, away: {} })),
    ]);

    return {
      events: eventsRes?.incidents || [],
      statistics: statsRes?.statistics || [],
      lineups: lineupsRes || { home: {}, away: {} },
    };
  } catch (error) {
    console.error("Failed to fetch match details:", error);
    return { events: [], statistics: [], lineups: [] };
  }
}

async function fetchStandings(leagueId) {
  const season = new Date().getFullYear();


  try {
    const data = await apiRequest("standings", { league: leagueId, season: season });
    if (data.response && data.response.length > 0) {
      return data.response[0].league.standings[0] || [];
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch standings:", error);
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
    // Only show important leagues by default to avoid "meaningless" matches
    filtered = matches.filter((m) => CONFIG.IMPORTANT_LEAGUES.includes(Number(m.league.id)));
  }

  const live = filtered.filter((m) => isLive(m.fixture.status.short));
  const scheduled = filtered.filter(
    (m) => m.fixture.status.short === "NS" || m.fixture.status.short === "TBD"
  );
  const finished = filtered.filter((m) => isFinished(m.fixture.status.short));

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
  if (live.length === 0 && scheduled.length === 0 && finished.length === 0) {
    noMatches.style.display = "flex";
  } else {
    noMatches.style.display = "none";
  }
}

function matchCardHTML(match, type) {
  const { fixture, league, teams, goals } = match;
  const status = fixture.status;

  let scoreSection = "";

  if (type === "live") {
    scoreSection = `
      <div class="match-score-section">
        <div class="match-score live-score">${goals.home ?? 0} - ${goals.away ?? 0}</div>
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
        <div class="match-score">${goals.home ?? 0} - ${goals.away ?? 0}</div>
        <div class="match-status-ft">${t("fullTime")}</div>
      </div>
    `;
  }

  return `
    <div class="match-card ${type === "live" ? "live" : ""}" onclick="showInterstitial(); openMatchDetail(${fixture.id})">
      <div class="match-card-league">
        <img src="${league.logo}" alt="${league.name}" onerror="this.style.display='none'" />
        <span>${league.name}</span>
      </div>
      <div class="match-card-body">
        <div class="match-team">
          <img class="match-team-logo" src="${teams.home.logo}" alt="${teams.home.name}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iIzJiMmQ0MiIvPjwvc3ZnPg=='" />
          <span class="match-team-name">${teams.home.name}</span>
        </div>
        ${scoreSection}
        <div class="match-team">
          <img class="match-team-logo" src="${teams.away.logo}" alt="${teams.away.name}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iIzJiMmQ0MiIvPjwvc3ZnPg=='" />
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
  const match = STATE.allMatches.find((m) => m.fixture.id === fixtureId);
  if (!match) return;

  const modal = document.getElementById("match-modal");
  const modalBody = document.getElementById("modal-body");
  const modalLeagueName = document.getElementById("modal-league-name");

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
        <div class="modal-score">${match.goals.home ?? "-"} - ${match.goals.away ?? "-"}</div>
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

  // Fetch details
  const details = await fetchMatchDetails(fixtureId);

  // Render events
  const eventsContainer = document.getElementById("modal-events");
  if (details.events && details.events.length > 0) {
    eventsContainer.innerHTML = renderEvents(details.events);
  } else {
    eventsContainer.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:20px">${STATE.currentLang === "ar" ? "لا توجد أحداث" : "No events yet"}</p>`;
  }

  // Render statistics
  const statsContainer = document.getElementById("modal-statistics");
  if (details.statistics && details.statistics.length > 0) {
    const stats = parseStats(details.statistics);
    statsContainer.innerHTML = renderStats(stats);
  } else {
    statsContainer.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:20px">${STATE.currentLang === "ar" ? "لا توجد إحصائيات" : "No statistics available"}</p>`;
  }

  // Render lineups
  const lineupsContainer = document.getElementById("modal-lineups-tab");
  if (details.lineups && (details.lineups.home?.players || details.lineups.away?.players)) {
    lineupsContainer.innerHTML = renderLineups(details.lineups, match);
  } else {
    lineupsContainer.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:20px">${STATE.currentLang === "ar" ? "لا توجد تشكيلات" : "No lineups available"}</p>`;
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
    { id: 39, name: STATE.currentLang === "ar" ? "البريميرليغ" : "Premier League" },
    { id: 140, name: STATE.currentLang === "ar" ? "لاليغا" : "La Liga" },
    { id: 135, name: STATE.currentLang === "ar" ? "سيري أ" : "Serie A" },
    { id: 78, name: STATE.currentLang === "ar" ? "بوندسليغا" : "Bundesliga" },
    { id: 61, name: STATE.currentLang === "ar" ? "الدوري الفرنسي" : "Ligue 1" },
  ];

  selectorContainer.innerHTML = leagues
    .map(
      (l, i) =>
        `<button class="standings-league-btn ${i === 0 ? "active" : ""}" onclick="selectStandingsLeague(${l.id}, this)">${l.name}</button>`
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
    const gd = team.all.goals.for - team.all.goals.against;
    html += `
      <tr>
        <td><span class="standings-rank ${team.rank <= 4 ? "top" : ""}">${team.rank}</span></td>
        <td>
          <div class="standings-team-cell">
            <img src="${team.team.logo}" alt="${team.team.name}" onerror="this.style.display='none'" />
            <span>${team.team.name}</span>
          </div>
        </td>
        <td>${team.all.played}</td>
        <td>${team.all.win}</td>
        <td>${team.all.draw}</td>
        <td>${team.all.lose}</td>
        <td>${gd > 0 ? "+" : ""}${gd}</td>
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
  const liveStatuses = ["1H", "2H", "HT", "ET", "P", "BT", "LIVE", "INT"];
  return liveStatuses.includes(statusShort);
}

function isFinished(statusShort) {
  const finishedStatuses = ["FT", "AET", "PEN", "AWD", "WO"];
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
      }
    }
  }, interval);
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

function saveApiKey() {
  const input = document.getElementById("api-key-input");
  const key = input.value.trim();

  if (!key) {
    input.style.borderColor = "var(--danger)";
    return;
  }

  STATE.apiKey = key;
  localStorage.setItem("livescore_api_key", key);
  document.getElementById("api-key-modal").style.display = "none";
  if (!STATE.isFirebaseLoaded) {
    STATE.isFirebaseLoaded = true;
    initApp();
  } else {
    refreshData();
  }
}

function loadDemoMode() {
  // Use fallback key instead of demo mode
  console.log("loadDemoMode: using fallback API key");
  STATE.apiKey = CONFIG.FALLBACK_API_KEY;
  document.getElementById("api-key-modal").style.display = "none";
  if (!STATE.isFirebaseLoaded) {
    STATE.isFirebaseLoaded = true;
    initApp();
  }
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
  initAds(); // Start Ads
  logVisit(); // Track real visitor
}

// DOMContentLoaded fallback - handled from index.html now
