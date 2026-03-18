// =============================================================
//  Korra Live - FULL PRODUCTION CODE (V34.0-MEGA-UPDATE)
//  Hybrid Player, Iframe CORS Bypass, Smart Auto-Fallback
//  Football News + Live Match Events Timeline (Firebase Sync)
// =============================================================

// 1. الإعدادات والحالة (CONFIG & STATE)
let CONFIG = {
  REFRESH_INTERVAL: 30000,   // 30s — fast update visibility
  SUPPORTED_LEAGUES: ["PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "EC"],
  VERSION: "V40.0-PRO-LIVE"
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

// 1.1 دوال عامة — تُضاف بعد تعريف كل الدوال في window.onload
// (يتم إسناد window.xxx في نهاية الملف لضمان وجود الدوال قبل الإسناد)

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
    const tvChanPage = document.querySelector('#tv-channels-page');
    if (tvChanPage) tvChanPage.style.display = 'none';
    
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
        renderLiveTVChannels(); // V34.0: load channels grid
    } else if (page === 'tv-channels') {
        if (tvChanPage) tvChanPage.style.display = 'block';
        renderLiveTVChannels('tv-channels-grid', 'tv-channels-count'); // V34.0: dedicated TV channels tab
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

// 4.1 جلب الأخبار من Firebase RTDB (V32.0 - Football News Only)
// DB Structure: news/{ id: { title, description, image_url, source_link, timestamp, category } }
function fetchNews() {
    const container = document.getElementById("news-list");
    if (!container) return;

    // Show loading state
    container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.5);">
            <div class="loading-spinner" style="margin:0 auto 15px;"></div>
            <p style="font-size:13px;">Fetching latest football updates...</p>
        </div>`;

    if (typeof firebase === 'undefined' || !firebase.database) {
        container.innerHTML = noDataHTML('far fa-newspaper', 'الأخبار غير متاحة - Firebase لم يبدأ');
        return;
    }

    console.log('[V32.0] Fetching football news from RTDB: news');

    // Race timeout vs RTDB fetch
    const rtdbPromise = firebase.database().ref('news').once('value');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000));

    Promise.race([rtdbPromise, timeoutPromise]).then(snapshot => {
        const data = snapshot.val ? snapshot.val() : snapshot;
        renderNewsArticles(data, container);
    }).catch(err => {
        if (err.message === 'TIMEOUT') {
            // REST fallback
            console.warn('[V32.0] WS timeout, falling back to REST...');
            fetch('https://korra-b5d32-default-rtdb.firebaseio.com/news.json?orderBy="timestamp"&limitToLast=30')
                .then(r => r.json())
                .then(data => renderNewsArticles(data, container))
                .catch(() => {
                    container.innerHTML = noDataHTML('far fa-newspaper', 'Fetching latest football updates...');
                });
        } else {
            console.error('[V32.0] RTDB news error:', err);
            container.innerHTML = noDataHTML('fas fa-exclamation-circle', `خطأ في جلب الأخبار: ${err.message}`);
        }
    });
}

function renderNewsArticles(data, container) {
    // Filter out meta entries and sort by timestamp
    if (!data || typeof data !== 'object') {
        container.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.5);">
                <i class="far fa-newspaper" style="font-size:44px;opacity:0.15;display:block;margin-bottom:16px;"></i>
                <p style="font-size:13px;">Fetching latest football updates...</p>
            </div>`;
        return;
    }

    let articles = Object.values(data)
        .filter(a => a && typeof a === 'object' && a.title && !a._meta && !a.status)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 30);

    if (articles.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.5);">
                <i class="far fa-newspaper" style="font-size:44px;opacity:0.15;display:block;margin-bottom:16px;"></i>
                <p style="font-size:13px;">Fetching latest football updates...</p>
            </div>`;
        return;
    }

    // Category badge colors
    const catColor = { transfer: '#00ffa3', injury: '#ff6b6b', club: '#4ecdc4', general: 'rgba(255,255,255,0.4)' };
    const catLabel = { transfer: '🔄 انتقال', injury: '🏥 إصابة', club: '🏟️ أخبار', general: '⚽ كرة القدم' };

    container.innerHTML = articles.map(a => {
        const imgUrl     = a.image_url || a.image || a.urlToImage || '';
        const sourceLink = a.source_link || a.link || a.url || '#';
        const cat        = a.category || 'general';
        const timeAgo    = a.timestamp ? getTimeAgo(a.timestamp) : '';

        return `
            <div style="background:var(--bg-card);border-radius:14px;overflow:hidden;border:1px solid var(--border);cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;"
                 onclick="window.open('${sourceLink}','_blank')"
                 onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,255,163,0.08)';"
                 onmouseout="this.style.transform='';this.style.boxShadow='';">
                ${imgUrl ? `<img src="${imgUrl}" style="width:100%;height:175px;object-fit:cover;" onerror="this.style.display='none'">` : ''}
                <div style="padding:12px 14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:10px;color:#000;background:${catColor[cat] || 'rgba(255,255,255,0.3)'}">${catLabel[cat] || '⚽'}</span>
                        ${timeAgo ? `<span style="font-size:10px;color:rgba(255,255,255,0.3);">${timeAgo}</span>` : ''}
                    </div>
                    <p style="margin:0;font-weight:700;font-size:13px;line-height:1.55;color:var(--text-primary);">${a.title}</p>
                    ${a.description ? `<p style="margin:6px 0 0;font-size:11px;color:rgba(255,255,255,0.45);line-height:1.5;">${a.description.substring(0, 120)}...</p>` : ''}
                    <p style="margin:8px 0 0;font-size:10px;color:var(--accent);font-weight:600;">📰 ${a.source || 'Football News'}</p>
                </div>
            </div>
        `;
    }).join('');
}

function getTimeAgo(timestamp) {
    const diffMs  = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 2)   return 'الآن';
    if (diffMin < 60)  return `${diffMin}د`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)    return `${diffH}س`;
    return `${Math.floor(diffH / 24)}ي`;
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

    let startTime = match.fixture.timestamp ? match.fixture.timestamp * 1000 : 0;
    if (!startTime && match.fixture.date) {
        startTime = new Date(match.fixture.date).getTime();
    }

    // V32.0: Removed hardcoded score overrides — scores come only from real Firebase data
    if (startTime > 0 && now > (startTime + 120 * 60 * 1000) && !isFinished(match.fixture.status.short)) {
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

  // V40.0: HAS_LIVE_STREAM badge — pulsing red when stream available
  const hasStream  = match.HAS_LIVE_STREAM || STATE.manualLinks[String(fixture.id)];
  const isLiveMatch = type === 'live';
  const streamBadge = hasStream
    ? `<div style="position:absolute;top:6px;left:6px;z-index:2;display:flex;align-items:center;gap:4px;background:rgba(255,45,85,0.15);border:1px solid rgba(255,45,85,0.4);color:#ff2d55;font-size:9px;font-weight:900;padding:3px 8px;border-radius:8px;letter-spacing:0.5px;"><span style="width:6px;height:6px;border-radius:50%;background:#ff2d55;display:inline-block;animation:livePulse 1.2s ease-in-out infinite;"></span>📡 LIVE</div>`
    : '';
  const liveBorder = isLiveMatch ? 'border-color:rgba(255,45,85,0.5);box-shadow:0 0 0 1px rgba(255,45,85,0.2);' : '';

  return `
    <div class="match-card ${type}" onclick="openMatchDetail('${fixture.id}')" style="position:relative;${liveBorder}">
      ${streamBadge}
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
          <div class="match-status">${isLiveMatch ? '<span style="color:#ff2d55;animation:livePulse 1.2s infinite;">● مباشر</span>' : (type === 'finished' ? 'FT' : '')}</div>
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
  fetchMatchEvents(fixtureId); // V33.0 Fetch realtime events

  // V36.0: Auto-switch to stream tab if a live link exists AND modal is freshly opened
  const hasStream = match && (match.HAS_LIVE_STREAM || STATE.manualLinks[String(fixtureId)]);
  STATE.activeModalTab = hasStream ? 'stream' : 'events';
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
              <span style="font-size:12px; color:var(--accent);">${isLive(match.fixture.status.short) && !isFinished(match.fixture.status.short) ? 'مباشر' : ''}</span>
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
    <div id="modal-stream" class="tab-content" style="display: ${STATE.activeModalTab === 'stream' ? 'block' : 'none'}; padding:0;">
        ${renderStreamPlayer(match)}
    </div>
  `;
  
  if (STATE.activeModalTab === 'stream') { /* player renders itself */ }
}

// 8.1 جلب الأحداث المباشرة من node match_events (V33.0)
function fetchMatchEvents(fixtureId) {
    if (typeof firebase === 'undefined' || !firebase.database) return;
    
    const eventsContainer = document.getElementById('modal-events');
    const match = STATE.allMatches.find(m => String(m.fixture.id) === String(fixtureId));
    
    firebase.database().ref(`match_events/${fixtureId}`).once('value').then(snapshot => {
        const data = snapshot.val();
        if (data && data.events && data.events.length > 0 && match) {
            // تحديث الأحداث في المودال إذا كنا لا نزال نفس المباراة
            if (String(STATE.openMatchId) === String(fixtureId)) {
                match.events = data.events; // Update local state
                if (eventsContainer) {
                    eventsContainer.innerHTML = renderEvents(data.events, match);
                }
            }
        } else {
            if (eventsContainer && (!match.events || match.events.length === 0)) {
                eventsContainer.innerHTML = `<div style="text-align:center; padding:50px 20px; color:rgba(255,255,255,0.4); font-size:13px;">لم تبدأ الأحداث بعد أو غير متوفرة لهذه المباراة</div>`;
            }
        }
    }).catch(err => console.error("Error fetching match events:", err));
}

// 9. الرندرة الفرعية (Events, Stats, Lineups) - V33.0 الأحداث الاحترافية
function renderEvents(events, match) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return `<div style="text-align:center; padding:50px 20px; color:rgba(255,255,255,0.4); font-size:13px;"><div class="loading-spinner" style="margin: 0 auto 15px;"></div>جاري جلب أحداث المباراة...</div>`;
  }
  
  // V34.0 Timeline UI — ⚽ icon shown with player name
  let html = `<div class="events-timeline" style="position:relative; padding:10px 0; display:flex; flex-direction:column; gap:16px;">
                 <div style="position:absolute; left:50%; top:0; bottom:0; width:2px; background:rgba(255,255,255,0.1); transform:translateX(-50%);"></div>`;
  
  events.forEach(e => {
    if (!e || typeof e !== 'object') return;

    const time = e.time || e.minute || '';
    const type = (e.type || '').toUpperCase();
    
    // V34.0: show ⚽ icon directly before player name for goals
    let player1 = e.playerName || e.detail || e.text || 'Unknown Player';
    if (player1.includes(' - ')) player1 = player1.split(' - ')[0]; // cleanup long strings
    if (player1.length > 30) player1 = player1.substring(0, 30) + '...';
    
    const player2 = e.playerOut || '';
    
    // Icon and type label
    let icon = e.icon || '⚽';
    let typeAr = type;
    
    if (type.includes('GOAL'))   { typeAr = 'هدف';   icon = '⚽'; }
    else if (type.includes('YELLOW')) { typeAr = 'إنذار'; icon = '🟨'; }
    else if (type.includes('RED'))    { typeAr = 'طرد';   icon = '🟥'; }
    else if (type.includes('SUB'))    { typeAr = 'تبديل'; icon = '🔄'; }

    // isHome check
    const isHome = e.isHome || (e.team && String(e.team.id) === String(match.teams?.home?.id));
    
    // V34.0: For goals specifically, show icon+name together
    const playerDisplay = type.includes('GOAL')
      ? `<span style="font-size:14px;margin-left:4px;">${icon}</span> <span style="font-size:13px; font-weight:700; color:#ffffff !important;">${player1}</span>`
      : `<span style="font-size:13px; font-weight:700; color:#ffffff !important;">${player1}</span>`;
    
    html += `
      <div class="event-row" style="display:flex; width:100%; align-items:center; position:relative; z-index:2;">
         <div style="flex:1; text-align:left; padding-right:15px; display:flex; flex-direction:column; align-items:flex-end;">
            ${isHome ? `
                <div style="display:flex; align-items:center; gap:5px;">
                   ${playerDisplay}
                </div>
                ${player2 ? `<span style="font-size:11px; color:rgba(255,255,255,0.5);">خروج: ${player2}</span>` : ''}
                <span style="font-size:11px; color:var(--accent); margin-top:2px;">${typeAr}</span>
            ` : ''}
         </div>
         
         <div style="width:40px; height:40px; border-radius:50%; background:var(--bg-card); display:flex; justify-content:center; align-items:center; border:2px solid rgba(255,255,255,0.1); flex-shrink:0;">
            <div style="display:flex; flex-direction:column; align-items:center;">
               <span style="font-size:14px; margin-bottom:2px;">${type.includes('GOAL') ? '⚽' : icon}</span>
               <span style="font-size:10px; font-weight:800; color:#fff; background:rgba(0,0,0,0.5); padding:1px 4px; border-radius:4px; margin-top:-8px; z-index:3;">${time}'</span>
            </div>
         </div>
         
         <div style="flex:1; text-align:right; padding-left:15px; display:flex; flex-direction:column; align-items:flex-start;">
            ${!isHome ? `
                <div style="display:flex; align-items:center; gap:5px;">
                   ${playerDisplay}
                </div>
                ${player2 ? `<span style="font-size:11px; color:rgba(255,255,255,0.5);">خروج: ${player2}</span>` : ''}
                <span style="font-size:11px; color:var(--accent); margin-top:2px;">${typeAr}</span>
            ` : ''}
         </div>
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

// ─────────────────────────────────────────────────────────────
// V40.0: Professional Server-Switcher Stream Player
// Renders server1/server2/server3 buttons exactly like the reference UI.
// ─────────────────────────────────────────────────────────────
function renderStreamPlayer(match) {
  const matchId = String(match.fixture.id);
  const manual  = STATE.manualLinks[matchId];
  const home    = encodeURIComponent(match.teams.home.name);
  const away    = encodeURIComponent(match.teams.away.name);

  // Gather servers from Firebase match_links object
  let servers = [];
  if (manual && typeof manual === 'object') {
    if (manual.server1) servers.push({ label: 'سيرفر 1 HD', url: manual.server1 });
    if (manual.server2) servers.push({ label: 'سيرفر 2 HD', url: manual.server2 });
    if (manual.server3) servers.push({ label: 'سيرفر 3 HD', url: manual.server3 });
    // Legacy single-url scraper format
    if (!servers.length && manual.url)  servers.push({ label: 'سيرفر 1 HD', url: manual.url });
    if (manual.alternate_url)           servers.push({ label: 'سيرفر 2 HD', url: manual.alternate_url });
  } else if (typeof manual === 'string' && manual) {
    servers.push({ label: 'سيرفر 1 HD', url: manual });
  }
  // Also check direct match fields
  if (!servers.length) {
    const fb = match.manual_link || match.stream_url || match.stream_link;
    if (fb) servers.push({ label: 'سيرفر 1 HD', url: fb });
  }

  if (!servers.length) {
    // ── No stream yet — show ⌛ preparing state ──
    return `
    <div style="padding:30px 20px;text-align:center;min-height:300px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;">
      <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,rgba(0,255,163,0.15),rgba(0,255,163,0.05));display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,255,163,0.2);animation:livePulse 2s infinite;">
        <span style="font-size:30px;">⌛</span>
      </div>
      <div>
        <p style="color:var(--accent);font-weight:800;font-size:16px;margin:0 0 6px;">⌛ جاري تجهيز البث...</p>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;">يتوفر البث تلقائياً قبل انطلاق المباراة بـ 30 دقيقة</p>
      </div>
      <button onclick="window.open('https://www.google.com/search?q=live+${home}+vs+${away}', '_blank')"
        style="background:rgba(0,255,163,0.1);color:var(--accent);border:1px solid rgba(0,255,163,0.25);padding:12px 24px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;">
        🔍 بحث عن بث مباشر
      </button>
    </div>`;
  }

  // ── Build professional server-switcher UI ──
  const serverBtns = servers.map((s, i) => `
    <button id="srv-btn-${matchId}-${i}"
      onclick="switchStreamServer('${matchId}', ${i})"
      style="flex:1;padding:14px 10px;font-size:14px;font-weight:800;cursor:pointer;border:none;
             background:${i === 0 ? 'linear-gradient(135deg,#1a0080,#3a00cc)' : '#0a0a0a'};
             color:${i === 0 ? '#fff' : 'rgba(255,255,255,0.6)'};
             border-right:${i < servers.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'};
             transition:all 0.2s;"
    >${s.label}${i === 0 ? ' <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#00ffa3;margin-right:4px;animation:livePulse 1s infinite;"></span>' : ''}</button>
  `).join('');

  // Top group tabs (سيرفر 1 / 2 / 3) — style from reference image (blue bg)
  const topTabs = servers.map((s, i) => `
    <button onclick="switchStreamServer('${matchId}', ${i})"
      style="flex:1;padding:12px;font-size:14px;font-weight:800;cursor:pointer;border:none;
             background:${i === 0 ? '#1a3fcf' : '#1240b0'};
             color:#fff;border-left:1px solid rgba(255,255,255,0.12);"
    >سيرفر ${i + 1}</button>
  `).join('');

  const firstUrl = servers[0].url;
  const safeUrl  = firstUrl.replace(/"/g, '&quot;');

  return `
    <div style="width:100%;background:#000;border-radius:0;overflow:hidden;">
      <!-- Top server group tabs (blue) -->
      <div style="display:flex;width:100%;">${topTabs}</div>

      <!-- HD sub-server pills -->
      <div style="display:flex;width:100%;border-bottom:1px solid rgba(255,255,255,0.08);">${serverBtns}</div>

      <!-- Player iframe -->
      <div id="stream-player-${matchId}" style="width:100%;height:300px;position:relative;background:#000;">
        <iframe id="stream-iframe-${matchId}"
          src="${safeUrl}"
          allowfullscreen allow="autoplay;encrypted-media;fullscreen"
          referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups"
          style="width:100%;height:100%;border:none;"
        ></iframe>
      </div>

      <!-- Controls bar (style from reference) -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#111;border-top:1px solid rgba(255,255,255,0.07);">
        <div style="display:flex;align-items:center;gap:12px;color:rgba(255,255,255,0.7);">
          <i class="fas fa-play" style="font-size:18px;"></i>
          <i class="fas fa-volume-up" style="font-size:16px;"></i>
          <span style="font-size:12px;font-weight:800;color:#ff2d55;letter-spacing:1px;">LIVE</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;color:rgba(255,255,255,0.7);">
          <i class="fas fa-cog" style="font-size:16px;"></i>
          <i class="fas fa-expand" style="font-size:16px;cursor:pointer;" onclick="document.getElementById('stream-iframe-${matchId}')?.requestFullscreen?.() || document.getElementById('stream-player-${matchId}')?.requestFullscreen?.()"></i>
        </div>
      </div>
    </div>`;
}

// Switch between servers in the stream player
function switchStreamServer(matchId, serverIdx) {
  const manual  = STATE.manualLinks[matchId];
  let servers   = [];
  if (manual && typeof manual === 'object') {
    if (manual.server1) servers.push(manual.server1);
    if (manual.server2) servers.push(manual.server2);
    if (manual.server3) servers.push(manual.server3);
    if (!servers.length && manual.url) servers.push(manual.url);
    if (manual.alternate_url) servers.push(manual.alternate_url);
  } else if (typeof manual === 'string' && manual) {
    servers.push(manual);
  }
  if (!servers[serverIdx]) return;

  const iframe = document.getElementById(`stream-iframe-${matchId}`);
  if (iframe) iframe.src = servers[serverIdx];

  // Update sub-button styles
  servers.forEach((_, i) => {
    const btn = document.getElementById(`srv-btn-${matchId}-${i}`);
    if (!btn) return;
    btn.style.background = i === serverIdx ? 'linear-gradient(135deg,#1a0080,#3a00cc)' : '#0a0a0a';
    btn.style.color      = i === serverIdx ? '#fff' : 'rgba(255,255,255,0.6)';
  });
  console.log(`[V40.0] Switched to server ${serverIdx + 1}:`, servers[serverIdx]);
}

// V40.0: initHlsPlayer is replaced by renderStreamPlayer (iframe-only).
// Kept as no-op stub so any legacy calls don't break.
function initHlsPlayer() {}


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
        if (match) {
            // Re-render server player into the stream tab
            const streamTab = document.getElementById('modal-stream');
            if (streamTab) streamTab.innerHTML = renderStreamPlayer(match);
        }
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

// ─────────────────────────────────────────────────────────────
// V36.0: TV CHANNELS — Firebase-driven + demo fallback
// Admin manages real links in RTDB: live_tv_links/{id}
// Shape: { name, emoji, color, streamUrl, category }
// ─────────────────────────────────────────────────────────────
// V38.5: 100% iframe/embed — HLS completely removed (DNS/CORS failures)
// All channels use iframeMode:true. No HLS.js manifests, no 404s.
// URLs are aggregator embed pages (StreamEast/VidSrc/SportStream style).
var TV_CHANNELS_DEFAULT = [
  { name: 'beIN Sports 1',    emoji: '⚽', color: '#8b3fff', category: 'Football',
    streamUrl: 'https://vidsrc.me/embed/soccer/', iframeMode: true },
  { name: 'beIN Sports 2',    emoji: '⚽', color: '#5b3fff', category: 'Football',
    streamUrl: 'https://vidsrc.me/embed/soccer/', iframeMode: true },
  { name: 'SSC Sport 1',      emoji: '🏟️', color: '#00c896', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/1/', iframeMode: true },
  { name: 'SSC Sport 2',      emoji: '🏟️', color: '#00a878', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/2/', iframeMode: true },
  { name: 'Abu Dhabi Sports', emoji: '🇦🇪', color: '#00b4d8', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/3/', iframeMode: true },
  { name: 'Sky Sports',       emoji: '🎙️', color: '#0074cc', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/4/', iframeMode: true },
  { name: 'Al Kass Sport',    emoji: '🇶🇦', color: '#c08000', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/5/', iframeMode: true },
  { name: 'MBC Sport',        emoji: '🎬', color: '#ff5722', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/6/', iframeMode: true },
  { name: 'Eurosport 1',      emoji: '🏆', color: '#ff8c00', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/7/', iframeMode: true },
  { name: 'DAZN / Sport 24',  emoji: '📹', color: '#ff0066', category: 'Football',
    streamUrl: 'https://embedstream.me/channel/8/', iframeMode: true },
];

// Runtime channel list — replaced by Firebase data when available
var TV_CHANNELS = TV_CHANNELS_DEFAULT.slice();

// Load real channel URLs from Firebase live_tv_links/{id}
function loadTVChannelsFromFirebase() {
  if (typeof firebase === 'undefined' || !firebase.database) return;
  firebase.database().ref('live_tv_links').once('value').then(function(snap) {
    var data = snap.val();
    if (!data || typeof data !== 'object') {
      console.log('[TV] No live_tv_links in Firebase — using demo streams');
      return;
    }
    var channels = Array.isArray(data) ? data : Object.values(data);
    channels = channels.filter(function(c) { return c && c.name && c.streamUrl; });
    if (channels.length > 0) {
      TV_CHANNELS = channels;
      console.log('[TV] Loaded ' + channels.length + ' real channels from Firebase live_tv_links');
    } else {
      console.log('[TV] live_tv_links exists but empty — keeping demo streams');
    }
  }).catch(function(e) {
    console.warn('[TV] Firebase live_tv_links fetch failed:', e.message);
  });
}

function renderLiveTVChannels(gridId, countId) {
  gridId  = gridId  || 'channels-grid';
  countId = countId || 'tv-count';
  var grid = document.getElementById(gridId);
  if (!grid) return;
  var countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = TV_CHANNELS.length;

  var html = '';
  for (var i = 0; i < TV_CHANNELS.length; i++) {
    var ch = TV_CHANNELS[i];
    var modeBadge = ch.iframeMode
      ? '<div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:2px;">iframe</div>'
      : '';
    html += '<div class="tv-channel-card" data-idx="' + i + '"'
          + ' style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;'
          + 'padding:18px 12px;cursor:pointer;text-align:center;'
          + 'transition:transform 0.15s,box-shadow 0.15s;position:relative;overflow:hidden;">'
          + '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:' + ch.color + ';"></div>'
          + '<div style="font-size:32px;margin-bottom:8px;">' + ch.emoji + '</div>'
          + '<div style="font-size:12px;font-weight:800;color:#fff;margin-bottom:4px;">' + ch.name + '</div>'
          + '<div style="font-size:10px;color:' + ch.color + ';font-weight:600;">' + ch.category + '</div>'
          + '<div style="margin-top:8px;display:inline-flex;align-items:center;gap:4px;'
          + 'background:rgba(255,45,85,0.15);border-radius:8px;padding:3px 8px;">'
          + '<span style="width:6px;height:6px;border-radius:50%;background:#ff2d55;display:inline-block;"></span>'
          + '<span style="font-size:9px;font-weight:900;color:#ff2d55;">LIVE</span>'
          + '</div>' + modeBadge + '</div>';
  }
  grid.innerHTML = html;

  // Delegated click — iframeMode flag passed through
  grid.onclick = function(ev) {
    var card = ev.target;
    while (card && !card.classList.contains('tv-channel-card')) {
      card = card.parentElement;
    }
    if (!card) return;
    var idx = parseInt(card.getAttribute('data-idx'), 10);
    var ch = TV_CHANNELS[idx];
    if (ch) openTVChannel(ch.streamUrl, ch.name, ch.iframeMode);
  };
}

function openTVChannel(streamUrl, channelName, iframeMode) {
  var modal = document.getElementById('match-modal');
  var modalBody = document.getElementById('modal-body');
  if (!modal || !modalBody) return;

  if (window.activeHls) { try { window.activeHls.destroy(); } catch(e){} window.activeHls = null; }

  modal.style.cssText = 'display:flex !important;position:fixed;top:0;left:0;width:100%;height:100%;'
    + 'background:rgba(0,0,0,0.92);z-index:100000;justify-content:center;align-items:center;backdrop-filter:blur(5px);';
  document.body.style.overflow = 'hidden';

  // V37.0: iframeMode channels skip HLS entirely — avoids CORS/manifest errors
  var isHls = !iframeMode && streamUrl.indexOf('.m3u8') !== -1;
  var playerHtml = isHls
    ? '<video id="tv-hls-video" controls autoplay playsinline referrerpolicy="no-referrer" crossorigin="anonymous" style="width:100%;height:100%;background:#000;"></video>'
    + '<div id="tv-hls-overlay" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.75);color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;pointer-events:none;">'
    + '&#9719; جاري تحميل البث...</div>'
    : '<iframe src="' + streamUrl.replace(/"/g, '&quot;') + '" allowfullscreen allow="autoplay;encrypted-media;fullscreen" '
    + 'referrerpolicy="no-referrer" '
    + 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups" '
    + 'style="width:100%;height:100%;border:none;"></iframe>';

  modalBody.innerHTML =
      '<div style="width:100%;max-width:680px;padding:0;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding:15px;border-bottom:1px solid rgba(255,255,255,0.1);">'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<span style="font-size:18px;">📺</span>'
    + '<h3 style="margin:0;font-size:16px;">' + channelName + '</h3>'
    + '<span style="background:#ff2d55;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:900;">LIVE</span>'
    + '</div>'
    + '<button onclick="closeModal()" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;">&#xD7;</button>'
    + '</div>'
    + '<div id="tv-player-container" style="width:100%;height:360px;background:#000;position:relative;">'
    + playerHtml
    + '</div></div>';

  if (!isHls) return; // iframe branch done

  var video = document.getElementById('tv-hls-video');
  if (!video) return;
  var overlay = document.getElementById('tv-hls-overlay');

  var hideOverlay = function() { if (overlay) overlay.style.display = 'none'; };

  // Fallback to iframe when HLS totally fails
  var switchToIframe = function(reason) {
    if (window.activeHls) { try { window.activeHls.destroy(); } catch(e){} window.activeHls = null; }
    var container = document.getElementById('tv-player-container');
    if (!container) return;
    console.warn('[TV-HLS] Falling back to iframe — reason:', reason);
    container.innerHTML = '<iframe src="' + streamUrl.replace(/"/g, '&quot;') + '" allowfullscreen allow="autoplay;encrypted-media;fullscreen" '
      + 'referrerpolicy="no-referrer" '
      + 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups" '
      + 'style="width:100%;height:100%;border:none;"></iframe>';
  };

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    // Production HLS.js config: CORS bypass + aggressive retry
    var hls = new Hls({
      enableWorker:           true,
      lowLatencyMode:         true,
      startLevel:             -1,        // auto quality selection
      capLevelToPlayerSize:   true,
      maxBufferLength:        30,
      maxBufferSize:          60 * 1000 * 1000,
      maxMaxBufferLength:     60,
      fragLoadingMaxRetry:    6,
      fragLoadingRetryDelay:  1000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 1500,
      xhrSetup: function(xhr, url) {
        xhr.withCredentials = false; // Prevent CORS credential errors
      }
    });
    window.activeHls = hls;

    // Safety timeout — if manifest hasn't parsed in 12s, switch to iframe
    var safetyTimer = setTimeout(function() {
      switchToIframe('manifest parse timeout (12s)');
    }, 12000);

    hls.loadSource(streamUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      clearTimeout(safetyTimer);
      hideOverlay();
      video.play().catch(function(e) { console.warn('[TV-HLS] Autoplay blocked:', e.message); });
    });

    hls.on(Hls.Events.ERROR, function(event, data) {
      if (data.fatal || data.details === 'manifestLoadError' || data.details === 'manifestParsingError') {
        clearTimeout(safetyTimer);
        console.error('[TV-HLS] Fatal error:', data.type, data.details);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Try to recover once before falling back
          hls.startLoad();
          setTimeout(function() { switchToIframe(data.details); }, 4000);
        } else {
          switchToIframe(data.details);
        }
      } else {
        console.warn('[TV-HLS] Non-fatal:', data.type, data.details);
      }
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari / iOS)
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', function() { hideOverlay(); video.play(); });
    video.addEventListener('error', function() { switchToIframe('native HLS error'); });
  } else {
    // Browser has no HLS support at all
    switchToIframe('HLS not supported');
  }
}
window.openTVChannel = openTVChannel;

console.log("Korra Live SDK V40.0-PRO-LIVE Loaded ✅");

// ── Global assignments (after all function declarations) ──────
window.selectMatchDay    = selectMatchDay;
window.filterByLeague    = filterByLeague;
window.refreshData       = refreshData;
window.toggleLanguage    = toggleLanguage;
window.closeModal        = closeModal;
window.switchModalTab    = switchModalTab;
window.openMatchDetail   = openMatchDetail;
window.openInstallWizard = openInstallWizard;
window.closeInstallWizard= closeInstallWizard;
window.switchPage        = switchPage;
window.fetchStandings    = fetchStandings;
window.switchStreamServer= switchStreamServer;

// 12. التشغيل
window.onload = () => {
    // Set STATE.currentDate to today fresh on load
    STATE.currentDate = new Date();
    loadTVChannelsFromFirebase(); // V36.0: pull real channel URLs from Firebase
    fetchMatches();
    setupManualStreamListener();
    setInterval(() => { if (document.visibilityState === 'visible') {
        STATE.currentDate = new Date();
        const activeTab = document.querySelector('.match-tab.active');
        const isToday = !activeTab || activeTab.dataset.day === 'today' || activeTab.dataset.day === undefined;
        if (isToday) STATE.currentDate = new Date();
        fetchMatches();
    }}, CONFIG.REFRESH_INTERVAL);
};