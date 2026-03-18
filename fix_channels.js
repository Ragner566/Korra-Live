const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'football_live_score_web', 'app_v5.js');
let content = fs.readFileSync(filePath, 'utf8');

// --- Locate the old section ---
const S_COMMENT = '// V34.0: TV CHANNELS PAGE';
const E_MARKER  = 'window.openTVChannel = openTVChannel;';

const startIdx = content.indexOf(S_COMMENT);
// find the FIRST occurrence of E_MARKER from startIdx
const endIdx   = content.indexOf(E_MARKER, startIdx) + E_MARKER.length;

if (startIdx === -1 || endIdx < E_MARKER.length) {
  console.error('Markers not found! start:', startIdx, 'end:', endIdx);
  process.exit(1);
}

console.log('Replacing chars', startIdx, '-', endIdx, '(', endIdx - startIdx, 'bytes)');

// ---- New crash-proof replacement ----
const newBlock = `// ─────────────────────────────────────────────────────────────
// V34.1: TV CHANNELS  —  renderLiveTVChannels (crash-proof)
// Uses data-idx attributes + delegated onclick — no HTML escaping issues
// ─────────────────────────────────────────────────────────────
var TV_CHANNELS = [
  { name: 'beIN Sports 1',    emoji: '\u{1F4FA}', color: '#8b3fff', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8', category: 'Football' },
  { name: 'beIN Sports 2',    emoji: '\u{1F4FA}', color: '#5b3fff', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i2/i2-clr.isml/index.m3u8', category: 'Football' },
  { name: 'SSC 1',            emoji: '\u{1F3DF}\uFE0F', color: '#00c896', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8', category: 'Football' },
  { name: 'SSC 2',            emoji: '\u{1F3DF}\uFE0F', color: '#00a878', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i2/i2-clr.isml/index.m3u8', category: 'Football' },
  { name: 'Sky Sports',       emoji: '\u{1F399}\uFE0F', color: '#0074cc', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8', category: 'Football' },
  { name: 'ESPN',             emoji: '\u{1F1FA}\u{1F1F8}', color: '#e7252d', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8', category: 'Multi-Sport' },
  { name: 'Al Jazeera Sport', emoji: '\u{1F1F6}\u{1F1E6}', color: '#c08000', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8', category: 'Football' },
  { name: 'MBC Action',       emoji: '\u{1F3AC}',           color: '#ff5722', streamUrl: 'https://live02-seg.msf.cdn.mediaset.net/live/ch-i1/i1-clr.isml/index.m3u8', category: 'Entertainment' }
];

function renderLiveTVChannels(gridId, countId) {
  gridId  = gridId  || 'channels-grid';
  countId = countId || 'tv-count';
  var grid = document.getElementById(gridId);
  if (!grid) return;
  var countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = TV_CHANNELS.length;

  // String concatenation — no regex-escape, no template-literal HTML quoting issues
  var html = '';
  for (var i = 0; i < TV_CHANNELS.length; i++) {
    var ch = TV_CHANNELS[i];
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
          + '</div></div>';
  }
  grid.innerHTML = html;

  // Delegated click — URL lives in JS array, never in HTML attributes
  grid.onclick = function(ev) {
    var card = ev.target;
    while (card && !card.classList.contains('tv-channel-card')) {
      card = card.parentElement;
    }
    if (!card) return;
    var idx = parseInt(card.getAttribute('data-idx'), 10);
    var ch = TV_CHANNELS[idx];
    if (ch) openTVChannel(ch.streamUrl, ch.name);
  };
}

function openTVChannel(streamUrl, channelName) {
  var modal = document.getElementById('match-modal');
  var modalBody = document.getElementById('modal-body');
  if (!modal || !modalBody) return;

  modal.style.cssText = 'display:flex !important;position:fixed;top:0;left:0;width:100%;height:100%;'
    + 'background:rgba(0,0,0,0.92);z-index:100000;justify-content:center;align-items:center;backdrop-filter:blur(5px);';
  document.body.style.overflow = 'hidden';

  var isHls = streamUrl.indexOf('.m3u8') !== -1;
  var playerHtml = isHls
    ? '<video id="tv-hls-video" controls autoplay style="width:100%;height:100%;background:#000;"></video>'
    : '<iframe src="' + streamUrl.replace(/"/g, '&quot;') + '" allowfullscreen allow="autoplay;encrypted-media" style="width:100%;height:100%;border:none;"></iframe>';

  modalBody.innerHTML =
      '<div style="width:100%;max-width:600px;padding:0;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding:15px;border-bottom:1px solid rgba(255,255,255,0.1);">'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<span style="font-size:18px;">\u{1F4FA}</span>'
    + '<h3 style="margin:0;font-size:16px;">' + channelName + '</h3>'
    + '<span style="background:#ff2d55;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:900;">LIVE</span>'
    + '</div>'
    + '<button onclick="closeModal()" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;">&#xD7;</button>'
    + '</div>'
    + '<div id="tv-player-container" style="width:100%;height:320px;background:#000;position:relative;">'
    + playerHtml
    + '</div></div>';

  if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
    var video = document.getElementById('tv-hls-video');
    if (video) {
      var hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function(){}); });
    }
  }
}
window.openTVChannel = openTVChannel;`;

const result = content.substring(0, startIdx) + newBlock + content.substring(endIdx);
fs.writeFileSync(filePath, result, 'utf8');
console.log('✅ Done! New file:', result.length, 'bytes,', result.split('\n').length, 'lines');
