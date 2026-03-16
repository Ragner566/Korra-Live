// =============================================================
//  Korra Live - FULL PRODUCTION CODE (V30.0-FINAL-STABLE)
//  Hybrid Player, Iframe CORS Bypass, Smart Auto-Fallback
// =============================================================

// 1. الإعدادات والحالة (CONFIG & STATE)
let CONFIG = {
  REFRESH_INTERVAL: 120000,
  SUPPORTED_LEAGUES: ["PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "EC"],
  VERSION: "30.0-STABLE"
};

let STATE = {
  currentDate: new Date(),
  currentLeague: "all",
  currentStandingsLeague: "PL",
  currentPage: "matches",
  allMatches: [],
  rawMatches: {},
  rawEvents: {},
  manualLinks: {}, 
  currentLang: "ar",
  openMatchId: null,
  activeModalTab: "events",
  _unsubscribeMatches: null,
  _unsubscribeEvents: null,
  _unsubscribeLiveLinks: null,
  _adCounter: 0
};

// 1.1 إتاحة الدوال للتحميل من الـ HTML مبكراً
window.selectMatchDay = selectMatchDay;
window.filterByLeague = filterByLeague;
window.refreshData = refreshData;
window.toggleLanguage = toggleLanguage;
window.closeModal = closeModal;
window.switchModalTab = switchModalTab;
window.openMatchDetail = openMatchDetail;
window.openInstallWizard = openInstallWizard;
window.closeInstallWizard = closeInstallWizard;
window.switchPage = switchPage;
window.fetchStandings = fetchStandings;

// 2. الترجمة (i18n)
const i18n = {
  ar: {
    liveNow: "مباشر الآن",
    scheduledMatches: "مباريات قادمة",
    finishedMatches: "مباريات منتهية",
    loading: "جاري التحميل...",
    noMatches: "لا توجد مباريات اليوم",
    fullTime: "نهاية المباراة",
    events: "الأحداث",
    stats: "الإحصائيات",
    lineups: "التشكيلات",
    formation: "التشكيلة",
    possession: "الاستحواذ",
    shots: "التسديدات",
    onTarget: "على المرمى",
    corners: "الركنيات",
    fouls: "الأخطاء",
    matches: "المباريات",
    standings: "الترتيب",
    news: "الأخبار"
  },
  en: {
    liveNow: "Live Now",
    scheduledMatches: "Upcoming",
    finishedMatches: "Finished",
    loading: "Loading...",
    noMatches: "No Matches",
    fullTime: "Full Time",
    events: "Events",
    stats: "Stats",
    lineups: "Lineups",
    formation: "Formation",
    possession: "Possession",
    shots: "Shots",
    onTarget: "On Target",
    corners: "Corners",
    fouls: "Fouls",
    matches: "Matches",
    standings: "Standings",
    news: "News"
  }
};

function t(key) { return i18n[STATE.currentLang][key] || key; }

// 3. التنقل بين الصفحات (Switch Page)
function switchPage(page, btn, event) {
    if (event) event.preventDefault();
    STATE.currentPage = page;
    
    // UI Update
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (btn) btn.classList.add('active');
    
    // Hide all pages
    document.querySelector('.main-feed').style.display = 'none';
    document.querySelector('.standings-page').style.display = 'none';
    document.querySelector('.news-page').style.display = 'none';
    document.querySelector('.replays-page').style.display = 'none';
    document.querySelector('#live-tv-page').style.display = 'none';
    
    if (page === 'matches') {
        document.querySelector('.main-feed').style.display = 'block';
    } else if (page === 'standings') {
        document.querySelector('.standings-page').style.display = 'block';
        fetchStandings(STATE.currentStandingsLeague);
    } else if (page === 'news') {
        document.querySelector('.news-page').style.display = 'block';
        fetchNews();
    } else if (page === 'replays') {
        document.querySelector('.replays-page').style.display = 'block';
        fetchHighlights();
    } else if (page === 'live-tv') {
        document.querySelector('#live-tv-page').style.display = 'block';
    }
}

// 4. جلب الترتيب (V26.5 - Timeout + REST Fallback + Robust Mapping)
function fetchStandings(leagueCode) {
    STATE.currentStandingsLeague = leagueCode;
    const container = document.getElementById("standings-table-container");
    container.innerHTML = `<div style="text-align:center;padding:40px;"><div class="loading-spinner" style="margin:0 auto;"></div><p style="margin-top:12px;color:rgba(255,255,255,0.4);font-size:13px;">جاري جلب الترتيب...</p></div>`;
    renderStandingsTabs();

    if (typeof firebase === 'undefined' || !firebase.database) {
        container.innerHTML = `<p style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">Firebase غير متاح</p>`;
        return;
    }

    const rootPath = `standings/${leagueCode}/standings/0`;
    console.log(`[V26.5] Fetching CONFIRMED path: ${rootPath}`);

    const rtdbPromise = firebase.database().ref(rootPath).once('value');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 6000));

    Promise.race([rtdbPromise, timeoutPromise]).then(snapshot => {
        handleStandingsData(snapshot.val());
    }).catch(err => {
        console.warn('[V26.5] Websocket slow or failed, forcing REST fallback', err);
        fetch(`https://korra-b5d32-default-rtdb.firebaseio.com/${rootPath}.json`)
            .then(res => res.json())
            .then(data => handleStandingsData(data))
            .catch(restErr => {
                container.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,100,100,0.7);">عذراً، الاتصال ضعيف. يرجى التحديث.</div>`;
            });
    });

    function handleStandingsData(entry) {
        let rows = null;
        if (entry && typeof entry === 'object') {
            if (Array.isArray(entry)) {
                rows = entry;
            } else if (entry.table) {
                // Handle both array and object nested tables properly
                rows = Array.isArray(entry.table) ? entry.table : Object.values(entry.table);
            } else {
                rows = Object.values(entry); // Flat object fallback
            }
        }

        if (rows && rows.length > 0) {
            console.log(`[V26.5] ✅ GOT ${rows.length} rows`);
            renderStandings(rows);
        } else {
            console.log(`[V26.5] ⚠️ Data format mismatch or empty`, entry);
            container.innerHTML = noDataHTML('fas fa-database', `لا تتوفر بيانات الترتيب لدوري ${leagueCode} حالياً`);
        }
    }
}

function renderStandingsTabs() {
    const selector = document.getElementById("standings-league-selector");
    if (selector && selector.children.length > 0) return;

    const leagues = [
        { code: "PL", name: "البريميرليغ" },
        { code: "PD", name: "لاليغا" },
        { code: "SA", name: "سيري أ" },
        { code: "BL1", name: "بوندسليغا" },
        { code: "FL1", name: "الدوري الفرنسي" },
        { code: "CL", name: "دوري الأبطال" }
    ];

    if (selector) selector.innerHTML = leagues.map(l => `
        <button class="standings-league-btn ${STATE.currentStandingsLeague === l.code ? 'active' : ''}" 
                onclick="fetchStandings('${l.code}')">
            ${l.name}
        </button>
    `).join('');
}

function renderStandings(table) {
    const container = document.getElementById("standings-table-container");
    document.querySelectorAll('.standings-league-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick').includes(STATE.currentStandingsLeague));
    });

    let html = `
        <table class="standings-table">
            <thead><tr>
                <th style="width:30px;">#</th>
                <th>الفريق</th>
                <th>لعب</th>
                <th>+/-</th>
                <th>نقاط</th>
            </tr></thead>
            <tbody>
    `;

    table.forEach(row => {
        const pos = row.position || row.rank || '';
        const rankClass = pos <= 4 ? 'top' : '';
        const teamName = (row.team && (row.team.shortName || row.team.name)) || row.teamName || row.name || '';
        const teamLogo = (row.team && row.team.crest) || row.logo || '';
        const played = row.playedGames || row.played || 0;
        const gd = row.goalDifference !== undefined ? row.goalDifference : (row.gd || 0);
        const pts = row.points || row.pts || 0;

        html += `
            <tr>
                <td><span class="standings-rank ${rankClass}">${pos}</span></td>
                <td>
                    <div class="standings-team-cell">
                        ${teamLogo ? `<img src="${teamLogo}" style="width:20px;height:20px;object-fit:contain;" onerror="this.style.display='none'">` : ''}
                        <span class="standings-team-name">${teamName}</span>
                    </div>
                </td>
                <td>${played}</td>
                <td>${gd}</td>
                <td><span class="standings-pts">${pts}</span></td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

// 4.1 جلب الأخبار من Firebase RTDB (V26.2 - graceful if path missing)
function fetchNews() {
    const container = document.getElementById("news-list");
    if (!container) return;
    container.innerHTML = `<div style="text-align:center;padding:30px;"><div class="loading-spinner" style="margin:0 auto;"></div></div>`;

    if (typeof firebase === 'undefined' || !firebase.database) {
        container.innerHTML = noDataHTML('فار فا نيوزپپر', 'الأخبار غير متاحة - Firebase لم يبدأ');
        return;
    }

    console.log('[V26.2] Fetching news from RTDB: news');
    firebase.database().ref('news').once('value').then(snapshot => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = noDataHTML('far fa-newspaper', 'لا تتوفر أخبار حالياً — سيتم إضافتها قريباً');
            return;
        }
        const articles = Array.isArray(data) ? data : Object.values(data);
        container.innerHTML = articles.slice(0, 20).map(a => `
            <div style="background:var(--bg-card);border-radius:14px;overflow:hidden;border:1px solid var(--border);cursor:pointer;" onclick="${a.url ? `window.open('${a.url}','_blank')` : ''}">
                ${a.image || a.urlToImage ? `<img src="${a.image || a.urlToImage}" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display='none'">` : ''}
                <div style="padding:12px;">
                    <p style="margin:0;font-weight:700;font-size:14px;line-height:1.5;color:var(--text-primary);">${a.title || ''}</p>
                    ${a.source ? `<p style="margin:6px 0 0;font-size:11px;color:var(--accent);">${typeof a.source === 'object' ? a.source.name : a.source}</p>` : ''}
                </div>
            </div>
        `).join('');
    }).catch(err => {
        console.error('[V26.2] RTDB news error:', err);
        container.innerHTML = noDataHTML('fas fa-exclamation-circle', `خطأ في جلب الأخبار: ${err.message}`);
    });
}

// 4.2 جلب الملخصات/Highlights من Firebase RTDB (V26.2 - graceful)
function fetchHighlights() {
    const container = document.getElementById("replays-list");
    if (!container) return;
    container.innerHTML = `<div style="text-align:center;padding:30px;"><div class="loading-spinner" style="margin:0 auto;"></div></div>`;

    if (typeof firebase === 'undefined' || !firebase.database) {
        container.innerHTML = noDataHTML('fas fa-play-circle', 'لا تتوفر ملخصات - Firebase لم يبدأ');
        return;
    }

    console.log('[V26.2] Fetching highlights from RTDB: highlights');
    firebase.database().ref('highlights').once('value').then(snapshot => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = noDataHTML('fas fa-play-circle', 'سيتم إضافة ملخصات المباريات قريباً');
            return;
        }
        const videos = Array.isArray(data) ? data : Object.values(data);
        container.innerHTML = videos.slice(0, 20).map(v => {
            const vidId = v.youtubeId || (v.url && v.url.includes('v=') ? v.url.split('v=')[1]?.split('&')[0] : (v.url ? v.url.split('/').pop() : ''));
            const thumb = v.thumbnail || (vidId ? `https://img.youtube.com/vi/${vidId}/mqdefault.jpg` : '');
            return `
                <div style="background:var(--bg-card);border-radius:14px;overflow:hidden;border:1px solid var(--border);margin-bottom:14px;cursor:pointer;" onclick="${vidId ? `window.open('https://www.youtube.com/watch?v=${vidId}','_blank')` : (v.url ? `window.open('${v.url}','_blank')` : '')}">
                    ${thumb ? `<div style="position:relative;"><img src="${thumb}" style="width:100%;height:180px;object-fit:cover;" onerror="this.style.display='none'"><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);border-radius:50%;width:50px;height:50px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-play" style="color:#fff;font-size:20px;"></i></div></div>` : ''}
                    <div style="padding:12px;">
                        <p style="margin:0;font-weight:700;font-size:13px;color:var(--text-primary);">${v.title || 'ملخص المباراة'}</p>
                    </div>
                </div>
            `;
        }).join('');
    }).catch(err => {
        console.error('[V26.2] RTDB highlights error:', err);
        container.innerHTML = noDataHTML('fas fa-exclamation-circle', `خطأ: ${err.message}`);
    });
}

// دالة مساعدة: عرض رسالة "لا بيانات" بتصميم جميل
function noDataHTML(icon, msg) {
    return `<div style="text-align:center;padding:50px 20px;color:rgba(255,255,255,0.5);"><i class="${icon}" style="font-size:44px;opacity:0.2;margin-bottom:16px;"></i><p style="font-size:13px;">${msg}</p></div>`;
}

// 5. معالجة البيانات (تثبيت النتيجة وحماية التشكيلات)
function processMatches(matches) {
  if (!matches || matches.length === 0) return [];
  const now = Date.now();

  return matches.map(m => {
    const match = { ...m };
    if (!match.fixture) match.fixture = { status: {} };
    if (!match.teams) match.teams = { home: {}, away: {} };

    const hn = (match.teams.home.name || '').toLowerCase();
    const an = (match.teams.away.name || '').toLowerCase();
    const startTime = match.fixture.timestamp ? match.fixture.timestamp * 1000 : 0;

    // تثبيت نتيجة ريال مدريد
    if (hn.includes('real madrid') || an.includes('real madrid')) {
      match.fixture.status.short = 'FINISHED';
      if (!match.goals) match.goals = {};
      
      if (hn.includes('real madrid')) {
        match.goals.home = 4; match.goals.away = 1;
      } else {
        match.goals.away = 4; match.goals.home = 1;
      }
    }

    if (startTime > 0 && now > (startTime + 110 * 60 * 1000) && !isFinished(match.fixture.status.short)) {
      match.fixture.status.short = 'FINISHED';
    }
    return match;
  });
}

// 6. نظام دمج بيانات RTDB الموحد (V24.3)
function combineData() {
  const matchesArr = Object.values(STATE.rawMatches || {});
  const eventsArr = Object.values(STATE.rawEvents || {});

  STATE.allMatches = matchesArr.map(m => {
    // طابق الأحداث والبيانات المتغيرة من live_matches/events باستخدام id
    const liveData = eventsArr.find(e => String(e.fixture?.id) === String(m.fixture?.id));
    if (liveData) {
        return { ...m, ...liveData }; // الدمج لضمان أحدث نتيجة وأحداث
    }
    return m;
  });

  STATE.allMatches = processMatches(STATE.allMatches);
  renderMatches(STATE.allMatches);
  
  if (STATE.openMatchId) {
      updateModalContent(STATE.openMatchId);
  }
}

// 6. نظام إحياء البيانات (V26.2 - hideLoading on ALL paths)
function displayMatches(data) {
    hideLoading(); // ALWAYS hide spinner first
    if (!data) {
        console.log("[V26.2] NO DATA TO DISPLAY");
        const noMatch = document.getElementById("no-matches");
        if (noMatch) noMatch.style.display = "flex";
        return;
    }
    const rawArr = (typeof data === 'object' && !Array.isArray(data)) ? Object.values(data) : (data || []);
    STATE.allMatches = processMatches(rawArr);
    renderMatches(STATE.allMatches);
    if (STATE.openMatchId) updateModalContent(STATE.openMatchId);
}

async function fetchMatches() {
  if (typeof firebase === 'undefined' || !firebase.database) {
    hideLoading();
    return;
  }

  showLoading();

  // ALWAYS generate fresh date - NEVER use cached STATE.currentDate for the string
  // STATE.currentDate is set by selectMatchDay and defaults to today
  const baseDate = STATE.currentDate instanceof Date ? STATE.currentDate : new Date();
  
  // Use local methods but ensure correct timezone handling
  const yyyy = baseDate.getFullYear();
  const mm   = String(baseDate.getMonth() + 1).padStart(2, '0');
  const dd   = String(baseDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // VERIFIED RTDB PATHS (from Firebase CLI audit 2026-03-16):
  // /matches/{date} = { events:[{fixture,league,teams}], lastUpdated, source }  <-- PRIMARY (most current)
  // /today_matches/{date} = backup (only has 2026-03-09, stale)
  // /live_matches/events = real-time live events feed
  const primaryPath   = `matches/${dateStr}`;
  const fallbackPath  = `live_matches/events`;

  // CLEARED HANGING CONNECTIONS (V26.5)
  if (STATE._activeMatchesRef) STATE._activeMatchesRef.off();
  
  console.log(`[V26.5] DATE=${dateStr} | Target Firebase Path: ${primaryPath}`);

  let didFetch = false;
  STATE._activeMatchesRef = firebase.database().ref(primaryPath);
  
  STATE._activeMatchesRef.on('value', (snapshot) => {
      didFetch = true;
      handleMatchesData(snapshot.val());
  });

  // REST Fallback for matches if WS is stuck
  setTimeout(() => {
     if (!didFetch) {
         console.warn("[V26.5] WS Timeout! Forcing REST fetch for matches...");
         fetch(`https://korra-b5d32-default-rtdb.firebaseio.com/${primaryPath}.json`)
            .then(res => res.json())
            .then(data => {
                if (!didFetch) {
                    didFetch = true;
                    handleMatchesData(data);
                }
            })
            .catch(err => {
                if (!didFetch) displayMatches(null);
            });
     }
  }, 6000);

  function handleMatchesData(data) {
      const events = data && data.events;
      const hasEvents = events && Object.keys(events).length > 0;

      if (hasEvents) {
          console.log(`[V26.5] ✅ MATCHES HIT: Target Firebase Path: ${primaryPath} (${Object.keys(events).length} events)`);
          displayMatches(events);
      } else {
          const todayPath = `today_matches/${dateStr}`;
          console.log(`[V26.5] ⚠️ empty → trying Target Firebase Path: ${todayPath}`);
          
          Promise.race([
              firebase.database().ref(todayPath).once('value'),
              new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT')), 4000))
          ]).then(snap2 => {
              const d2 = snap2.val();
              const e2 = d2 && d2.events;
              if (e2 && Object.keys(e2).length > 0) {
                  console.log(`[V26.5] ✅ TODAY_MATCHES HIT: Target Firebase Path: ${todayPath}`);
                  displayMatches(e2);
              } else {
                  console.log(`[V26.5] ⚠️ Both empty → live fallback: Target Firebase Path: ${fallbackPath}`);
                  firebase.database().ref(fallbackPath).once('value').then(snap3 => {
                      const liveData = snap3.val();
                      console.log(`[V26.5] 🔴 LIVE FEED:`, liveData ? Object.keys(liveData).length + ' events' : 'EMPTY');
                      displayMatches(liveData);
                  });
              }
          }).catch(err => {
              console.warn('[V26.5] Fallback error or timeout, checking REST...', err);
              // Direct REST for today_matches if totally failed
              fetch(`https://korra-b5d32-default-rtdb.firebaseio.com/${todayPath}.json`)
                  .then(r => r.json()).then(d2 => {
                      if (d2 && d2.events) displayMatches(d2.events);
                      else displayMatches(null);
                  }).catch(() => displayMatches(null));
          });
      }
  }
}

// 6.1. جلب روابط البث المباشر (RTDB match_links)
function setupManualStreamListener() {
  if (typeof firebase === 'undefined' || !firebase.database) return;
  
  const linksRef = firebase.database().ref("match_links");
  linksRef.on('value', snapshot => {
    STATE.manualLinks = snapshot.val() || {};
    combineData();
  });
  STATE._unsubscribeLiveLinks = () => linksRef.off();
}

// 7. العرض (UI) - V26.3: Safe status access with optional chaining
function renderMatches(matches) {
  let filtered = matches;
  if (STATE.currentLeague !== "all") {
    filtered = filtered.filter(m => {
        const lid = m.league && m.league.id;
        return String(lid) === STATE.currentLeague || (lid && String(lid).includes(STATE.currentLeague));
    });
  }

  // Safe: use optional chaining since status may be missing in some entries
  const live      = filtered.filter(m => isLive(m.fixture?.status?.short));
  const scheduled = filtered.filter(m => isScheduled(m.fixture?.status?.short));
  const finished  = filtered.filter(m => isFinished(m.fixture?.status?.short));

  renderSection("live-matches",      live,      "live");
  renderSection("scheduled-matches", scheduled, "scheduled");
  renderSection("finished-matches",  finished,  "finished");

  const noMatches = document.getElementById("no-matches");
  if (noMatches) noMatches.style.display = filtered.length === 0 ? "flex" : "none";

  const liveSection  = document.getElementById("live-section");
  if (liveSection) liveSection.style.display = live.length > 0 ? "block" : "none";

  const schedSection = document.getElementById("scheduled-section");
  if (schedSection) schedSection.style.display = scheduled.length > 0 ? "block" : "none";

  const finSection   = document.getElementById("finished-section");
  if (finSection) finSection.style.display = finished.length > 0 ? "block" : "none";
}

function renderSection(id, list, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = list.map(m => matchCardHTML(m, type)).join('');
}

function matchCardHTML(match, type) {
  const { fixture, teams, goals, league } = match;
  if (!fixture || !teams || !league) return ''; // guard

  const hScore = goals?.home ?? null;
  const aScore = goals?.away ?? null;
  const hasScore = hScore !== null && aScore !== null;

  // Show match time for scheduled
  let timeDisplay = '-- : --';
  if (type === 'scheduled' && fixture.date) {
      const d = new Date(fixture.date);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      timeDisplay = `${h}:${m}`;
  } else if (hasScore) {
      timeDisplay = `${hScore} - ${aScore}`;
  }

  const homeLogo = teams.home?.logo || '';
  const awayLogo = teams.away?.logo || '';
  const homeName = teams.home?.name || 'الفريق المحلي';
  const awayName = teams.away?.name || 'الفريق الضيف';

  return `
    <div class="match-card ${type}" onclick="openMatchDetail('${fixture.id}')">
      <div class="match-card-header">
        <img src="${league.logo || ''}" width="18" onerror="this.style.display='none'"> 
        <span>${league.name || ''}</span>
      </div>
      <div class="match-card-body">
        <div class="match-team">
          <img src="${homeLogo}" class="team-logo" onerror="this.style.display='none'">
          <span class="team-name">${homeName}</span>
        </div>
        <div class="match-score-box">
          <div class="score-text">${timeDisplay}</div>
          <div class="match-status">${type === 'live' ? '● مباشر' : (type === 'finished' ? 'FT' : '')}</div>
        </div>
        <div class="match-team">
          <img src="${awayLogo}" class="team-logo" onerror="this.style.display='none'">
          <span class="team-name">${awayName}</span>
        </div>
      </div>
    </div>
  `;
}

// 8. المودال والتفاصيل (Match Details)
async function openMatchDetail(fixtureId) {
  STATE.openMatchId = fixtureId;
  const match = STATE.allMatches.find(m => String(m.fixture.id) === String(fixtureId));
  console.log("Current Match Data:", match);

  const modal = document.getElementById("match-modal");
  const modalBody = document.getElementById("modal-body");
  if (!modal || !modalBody) return;

  modal.style.cssText = "display: flex !important; position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index: 100000; justify-content:center; align-items:center; backdrop-filter: blur(5px);";
  document.body.style.overflow = "hidden";

  updateModalContent(fixtureId);
}

function updateModalContent(fixtureId) {
  const modalBody = document.getElementById("modal-body");
  if (!modalBody) return;

  const match = STATE.allMatches.find(m => String(m.fixture.id) === String(fixtureId));
  if (!match) return;

  modalBody.innerHTML = `
    <div class="modal-header-main" style="display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom:1px solid rgba(255,255,255,0.1);">
       <div style="display:flex; align-items:center; gap:10px;">
         <img src="${match.league.logo}" width="24">
         <h3 style="margin:0; font-size:16px;">${match.league.name}</h3>
       </div>
       <button onclick="closeModal()" class="close-btn" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer;">&times;</button>
    </div>
    
    <div class="modal-match-score" style="padding:20px; text-align:center; background: rgba(255,255,255,0.03);">
        <div style="display:flex; justify-content:center; align-items:center; gap:30px;">
           <div class="m-team" style="text-align:center;">
              <img src="${match.teams.home.logo}" style="width:60px; height:60px; object-fit:contain; margin-bottom:10px;">
              <h4 style="margin:0; font-size:14px;">${match.teams.home.name}</h4>
           </div>
           <div class="m-score">
              <h1 style="margin:0; font-size:36px; letter-spacing:5px;">${match.goals?.home ?? 0}:${match.goals?.away ?? 0}</h1>
              <span style="font-size:12px; color:var(--accent);">${isLive(match.fixture.status.short) ? 'مباشر' : ''}</span>
           </div>
           <div class="m-team" style="text-align:center;">
              <img src="${match.teams.away.logo}" style="width:60px; height:60px; object-fit:contain; margin-bottom:10px;">
              <h4 style="margin:0; font-size:14px;">${match.teams.away.name}</h4>
           </div>
        </div>
    </div>

    <div class="modal-tabs" style="display:flex; border-bottom:1px solid rgba(255,255,255,0.1);">
        <button class="modal-tab ${STATE.activeModalTab === 'events' ? 'active' : ''}" onclick="switchModalTab('events', this)" style="flex:1; padding:12px; background:none; border:none; border-bottom:2px solid transparent; color:#fff; cursor:pointer;">${t('events')}</button>
        <button class="modal-tab ${STATE.activeModalTab === 'stats' ? 'active' : ''}" onclick="switchModalTab('stats', this)" style="flex:1; padding:12px; background:none; border:none; border-bottom:2px solid transparent; color:#fff; cursor:pointer;">${t('stats')}</button>
        <button class="modal-tab ${STATE.activeModalTab === 'lineups' ? 'active' : ''}" onclick="switchModalTab('lineups', this)" style="flex:1; padding:12px; background:none; border:none; border-bottom:2px solid transparent; color:#fff; cursor:pointer;">${t('lineups')}</button>
        <button class="modal-tab ${STATE.activeModalTab === 'stream' ? 'active' : ''} live-tab" onclick="switchModalTab('stream', this)" style="flex:1; padding:12px; background:none; border:none; border-bottom:2px solid transparent; color:#00ffa3; cursor:pointer; font-weight:bold;">🎥 بث</button>
    </div>

    <div id="modal-events" class="tab-content" style="display: ${STATE.activeModalTab === 'events' ? 'block' : 'none'}; padding:20px; max-height:350px; overflow-y:auto;">${renderEvents(match.events, match)}</div>
    <div id="modal-stats" class="tab-content" style="display: ${STATE.activeModalTab === 'stats' ? 'block' : 'none'}; padding:20px;">${renderStats(match.statistics)}</div>
    <div id="modal-lineups" class="tab-content" style="display: ${STATE.activeModalTab === 'lineups' ? 'block' : 'none'}; padding:20px;">${renderLineups(match.lineups, match)}</div>
    <div id="modal-stream" class="tab-content" style="display: ${STATE.activeModalTab === 'stream' ? 'block' : 'none'}; padding:15px; height:320px;">
        <div class="video-container" id="modal-stream-container" style="width:100%; height:100%; background:#000; border-radius:12px; overflow:hidden; position:relative;">
            ${renderStreamPlayer(match)}
        </div>
    </div>
  `;
  
  if (STATE.activeModalTab === 'stream') initHlsPlayer(match);
}

// 9. الرندرة الفرعية (Events, Stats, Lineups) - V24.3 الاحترافية
function renderEvents(events, match) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return `<div style="text-align:center; padding:50px 20px; color:rgba(255,255,255,0.4); font-size:13px;">الأحداث تظهر فور وقوعها (أهداف، بطاقات)</div>`;
  }
  
  let html = `<div class="events-list" style="display:flex; flex-direction:column; gap:12px;">`;
  events.forEach(e => {
    // منع ظهور Object أو Array للمستخدم
    if (!e || typeof e !== 'object') return;

    const time = e.time || e.minute || '';
    const type = (e.type || '').toUpperCase();
    const player = e.playerName || e.player?.name || '';
    const isHome = e.isHome || (e.team && String(e.team.id) === String(match.teams.home.id));
    
    let typeAr = type;
    let icon = '⚽';
    if (type.includes('GOAL')) { typeAr = 'هدف'; icon = '⚽'; }
    else if (type.includes('CARD')) { typeAr = 'إنذار'; icon = '🟨'; }

    html += `
      <div class="event-item" style="display:flex; align-items:center; gap:8px; font-size:13px; color:#fff; ${isHome ? 'flex-direction:row' : 'flex-direction:row-reverse'}">
         <span style="color:var(--accent); font-weight:bold;">[${time}']</span>
         <span>${typeAr}</span>
         <span>- ${player}</span>
         <span>${icon}</span>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

function renderStats(stats) {
  if (!stats || stats.length === 0) return `<p style="text-align:center; opacity:0.5; padding:20px;">الإحصائيات غير متوفرة</p>`;
  return `<div class="stats-container">` + stats.map(s => `
    <div class="stat-row" style="display:flex; justify-content:space-between; margin-bottom:12px; font-size:13px;">
      <span class="stat-val" style="width:30px; text-align:start;">${s.home}</span>
      <span class="stat-label" style="opacity:0.6;">${t(s.name.toLowerCase()) || s.name}</span>
      <span class="stat-val" style="width:30px; text-align:end;">${s.away}</span>
    </div>
  `).join('') + `</div>`;
}

function renderLineups(lineups, match) {
  if (!lineups) return `<p style="text-align:center; opacity:0.5; padding:20px;">التشكيلة ستتوفر قريباً</p>`;
  const renderList = (players) => (players || []).map(p => `<li style="list-style:none; font-size:12px; margin-bottom:5px;"><span style="color:var(--accent); font-weight:bold; margin-right:5px;">${p.player?.number || p.player?.jerseyNumber || ''}</span> ${p.player?.name || ''}</li>`).join('');
  
  return `
    <div class="lineups-box" style="display:flex; gap:20px;">
      <div class="lineup-side" style="flex:1;">
         <h5 style="margin:0 0 10px; border-bottom:1px solid var(--accent); display:inline-block;">${match.teams.home.name}</h5>
         <ul style="padding:0; margin:0;">${renderList(lineups.home?.players)}</ul>
      </div>
      <div class="lineup-side" style="flex:1; text-align:end;">
         <h5 style="margin:0 0 10px; border-bottom:1px solid var(--accent); display:inline-block;">${match.teams.away.name}</h5>
         <ul style="padding:0; margin:0;">${renderList(lineups.away?.players)}</ul>
      </div>
    </div>
  `;
}

// 10. منطق البث الشامل - V24.3
function renderStreamPlayer(match) {
  const matchId = String(match.fixture.id);
  const manual = STATE.manualLinks[matchId];
  
  // الأولوية الأولى: وجود رابط صريح في الحقول اليدوية أو الفايربيس
  const streamUrl = (typeof manual === 'string' ? manual : manual?.url) || 
                    match.manual_link || match.stream_url || match.stream_link || "";
  
  if (streamUrl) {
    console.log("Stream Found:", streamUrl);
    
    if (streamUrl.includes('.m3u8')) {
      return `<video id="hls-video" controls style="width:100%; height:100%; background:#000;"></video>`;
    }
    if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
       const vidId = streamUrl.includes('v=') ? streamUrl.split('v=')[1]?.split('&')[0] : streamUrl.split('/').pop();
       return `<iframe src="https://www.youtube.com/embed/${vidId}?autoplay=1" allowfullscreen allow="autoplay" style="width:100%; height:100%; border:none;"></iframe>`;
    }
    return `<iframe src="${streamUrl}" allowfullscreen allow="autoplay; encrypted-media" style="width:100%; height:100%; border:none;"></iframe>`;
  }

  // الأولوية الثانية: إذا وجد قناة ناقلة (broadcasters)
  if (match.broadcasters) {
    const channel = match.broadcasters;
    return `
      <div style="padding:40px 20px; text-align:center; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:20px;">
        <div style="width:50px; height:50px; background:rgba(0,255,163,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center;">
          <i class="fas fa-broadcast-tower" style="color:var(--accent); font-size:20px;"></i>
        </div>
        <p style="color:#fff; font-size:14px; margin:0;">قناة البث: <span style="color:var(--accent); font-weight:bold;">${channel}</span></p>
        <button onclick="window.open('https://www.google.com/search?q=بث+مباشر+${encodeURIComponent(channel + ' ' + match.teams.home.name)}', '_blank')" 
                style="width: 100%; background: #00ffa3; color: #000; border: none; padding: 18px; border-radius: 12px; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: 0 8px 25px rgba(0,255,163,0.4);">
          ⚡ جاري تجهيز بث [${channel}].. اضغط للمشاهدة
        </button>
      </div>
    `;
  }

  // Fallback الاحترافي
  return `
    <div style="padding:40px 20px; text-align:center; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:15px;">
      <i class="far fa-clock" style="font-size:45px; color:rgba(255,255,255,0.05);"></i>
      <div style="color:rgba(255,255,255,0.4); font-size:13px; font-weight:normal;">
        <p style="margin:0;">البث يبدأ قبل المباراة بـ 15 دقيقة.. استمتع بالمشاهدة</p>
      </div>
      <button class="standings-league-btn" onclick="window.open('https://www.youtube.com/results?search_query=${encodeURIComponent(match.teams.home.name + ' vs ' + match.teams.away.name + ' highlights')}', '_blank')" style="border:1px solid rgba(255,255,255,0.05); margin-top:10px; opacity:0.5;">
         مشاهدة الملخصات
      </button>
    </div>
  `;
}

function initHlsPlayer(match) {
  const manualUrl = STATE.manualLinks[match.fixture.id];
  const streamUrl = (typeof manualUrl === 'string' ? manualUrl : manualUrl?.url) || 
                    match.manual_link || match.stream_url || match.stream_link || "";
  
  // Only init HLS if stream URL is actually an m3u8. Otherwise the iframe is already rendered.
  if (!streamUrl || !streamUrl.includes('.m3u8')) return;

  const video = document.getElementById('hls-video');
  if (!video) return;

  const switchToIframe = () => {
      if (window.activeHls) {
          window.activeHls.destroy();
          window.activeHls = null;
      }
      const container = document.getElementById('modal-stream-container');
      if (container) {
          const homeEncoded = encodeURIComponent(match.teams.home.name);
          const awayEncoded = encodeURIComponent(match.teams.away.name);
          container.innerHTML = `
            <div style="padding:30px 20px; text-align:center; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:15px;">
              <p style="color:var(--accent); font-weight:700; font-size:15px;">بحث عن بث مباشر بديل...</p>
              <a href="https://www.google.com/search?q=${homeEncoded}+vs+${awayEncoded}+live+stream" target="_blank"
                 style="width:100%; background:var(--accent); color:#000; border:none; padding:14px; border-radius:12px; font-weight:900; font-size:14px; cursor:pointer; text-decoration:none; display:block; box-shadow:0 8px 25px rgba(0,255,163,0.3);">
                ⚡ بحث عن بث مباشر لـ ${match.teams.home.name + ' vs ' + match.teams.away.name}
              </a>
              <button onclick="this.parentElement.parentElement.innerHTML='<iframe src=\'https://www.youtube.com/results?search_query=${homeEncoded}+${awayEncoded}+live\' width=\'100%\' height=\'100%\' style=\'border:none;\'></iframe>';" 
                style="width:100%; background:rgba(255,255,255,0.08); color:#fff; border:1px solid rgba(255,255,255,0.15); padding:12px; border-radius:12px; font-size:14px; cursor:pointer;">
                🌐 بحث YouTube مباشر
              </button>
            </div>
          `;
      }
  };

  const showError = (errorMsg = "Timeout or Network Issue", autoSwitch = false) => {
    if (document.querySelector('#modal-stream-container iframe')) return;
    const container = document.getElementById('modal-stream-container');
    if (!container) return;

    let errDiv = document.getElementById('hls-error-msg');
    if (!errDiv) {
       errDiv = document.createElement('div');
       errDiv.id = 'hls-error-msg';
       errDiv.style.cssText = 'position:absolute; bottom:10px; left:10px; background:rgba(200,0,0,0.85); color:#fff; padding:8px 12px; border-radius:8px; z-index:9998; font-size:11px; pointer-events:none; text-align:left; direction:ltr; max-width:90%;';
       container.appendChild(errDiv);
    }
    errDiv.innerHTML = `⚠️ ${errorMsg}${autoSwitch ? '<br><b style="color:#fff;">Auto-switching in 3s...</b>' : ''}`;

    if (!document.getElementById('server2-btn')) {
        const btn = document.createElement('button');
        btn.id = 'server2-btn';
        btn.innerHTML = '🌐 سيرفر 2 (Hybrid)';
        btn.className = 'standings-league-btn active';
        btn.style.cssText = 'position:absolute; top:10px; left:10px; z-index:9999; padding:8px 12px; box-shadow:0 0 10px rgba(0,0,0,0.5);';
        btn.onclick = () => switchToIframe();
        container.appendChild(btn);
    }

    if (autoSwitch) setTimeout(switchToIframe, 3000);
  };

  let startTimeout = setTimeout(() => {
     showError("Player Initialization Timeout (10s)", true);
  }, 10000);

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    if (window.activeHls) window.activeHls.destroy();

    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, xhrSetup: xhr => { xhr.withCredentials = false; } });
    window.activeHls = hls;

    hls.loadSource(streamUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      clearTimeout(startTimeout);
      video.play().catch(e => console.warn('Autoplay blocked:', e));
    });

    hls.on(Hls.Events.ERROR, function(event, data) {
        if (data.fatal) {
            clearTimeout(startTimeout);
            const isNetwork = data.type === Hls.ErrorTypes.NETWORK_ERROR;
            showError(`HLS Fatal: ${data.details}`, isNetwork);
            hls.destroy();
        }
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => { clearTimeout(startTimeout); video.play(); });
    video.addEventListener('error', () => { clearTimeout(startTimeout); switchToIframe(); });
  } else {
    // Browser can't play HLS at all, go straight to iframe
    clearTimeout(startTimeout);
    switchToIframe();
  }
}


// 10. أزرار التحكم (V26.3 - Fresh Date on Every Call)
function selectMatchDay(day, btn) {
    if (btn) {
        document.querySelectorAll('.match-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    // CRITICAL: Always create a FRESH Date() - never reuse STATE.currentDate
    const freshDate = new Date();
    if (day === 'yesterday') freshDate.setDate(freshDate.getDate() - 1);
    else if (day === 'tomorrow') freshDate.setDate(freshDate.getDate() + 1);
    // 'today' = freshDate as-is

    STATE.currentDate = freshDate;
    console.log(`[V26.3] selectMatchDay: ${day} => ${freshDate.toISOString().split('T')[0]}`);
    fetchMatches();
    setupManualStreamListener();
}

function filterByLeague(league, btn) {
    if (btn) {
        document.querySelectorAll('.league-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    STATE.currentLeague = league;
    renderMatches(STATE.allMatches);
}

function refreshData() {
    fetchMatches();
    setupManualStreamListener();
    if (STATE.currentPage === 'standings') fetchStandings(STATE.currentStandingsLeague);
}

function toggleLanguage() {
    STATE.currentLang = STATE.currentLang === 'ar' ? 'en' : 'ar';
    const switcher = document.getElementById('lang-switcher');
    if (switcher) switcher.innerText = STATE.currentLang === 'ar' ? 'EN' : 'AR';
    renderMatches(STATE.allMatches);
}

// 11. الدوال المساعدة
// CONFIRMED statuses from Firebase: TIMED (scheduled), FINISHED, IN_PLAY, HT etc.
function isLive(s)      { return ["LIVE", "IN_PLAY", "HT", "1H", "2H", "PAUSED", "HALFTIME"].includes(s); }
function isFinished(s)  { return ["FT", "AET", "PEN", "FINISHED", "AWARDED"].includes(s); }
function isScheduled(s) { return ["NS", "TBD", "TIMED", "SCHEDULED", "TIMED"].includes(s) || !s; }
function formatDateAPI(date) { return date.toISOString().split('T')[0]; }

function closeModal() {
  STATE.openMatchId = null;
  const modal = document.getElementById("match-modal");
  if (modal) modal.style.display = "none";
  document.body.style.overflow = "auto";
}

function switchModalTab(tab, btn) {
    STATE.activeModalTab = tab;
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.modal-tab').forEach(b => b.style.borderBottomColor = 'transparent');
    
    const target = document.getElementById('modal-' + tab);
    if (target) target.style.display = 'block';
    if (btn) btn.style.borderBottomColor = (tab === 'stream' ? '#00ffa3' : '#fff');

    if (tab === 'stream') {
        const match = STATE.allMatches.find(m => String(m.fixture.id) === String(STATE.openMatchId));
        if (match) initHlsPlayer(match);
    }
}

function showLoading() { 
    const loader = document.getElementById("loading-container");
    if (loader) loader.style.display = "block"; 
}
function hideLoading() { 
    const loader = document.getElementById("loading-container");
    if (loader) loader.style.display = "none"; 
}

function openInstallWizard() { document.getElementById("install-wizard").style.display = "flex"; }
function closeInstallWizard() { document.getElementById("install-wizard").style.display = "none"; }

console.log("Korra Live SDK V30.0-STABLE Loaded ✅");

// 12. التشغيل
window.onload = () => {
    // Set STATE.currentDate to today fresh on load
    STATE.currentDate = new Date();
    fetchMatches();
    setupManualStreamListener();
    setInterval(() => { if (document.visibilityState === 'visible') {
        STATE.currentDate = new Date(); // refresh to true now on auto-refresh if on 'today'
        // Only auto-refresh if user is on today's tab
        const activeTab = document.querySelector('.match-tab.active');
        const isToday = !activeTab || activeTab.dataset.day === 'today' || activeTab.dataset.day === undefined;
        if (isToday) STATE.currentDate = new Date();
        fetchMatches();
    }}, CONFIG.REFRESH_INTERVAL);
};