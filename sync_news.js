const admin = require('firebase-admin');
const axios = require('axios');
const fsMod = require('fs');

// ============================================================
//  NEWS SYNC SCRIPT V32.0 — Football News Only
//  Fetches RSS from SkySports, BBC, Goal.com
//  Filters to: Transfers, Injuries, Signings, Club News
//  Saves to Firebase RTDB 'news' node + Firestore 'news' collection
//  Structure: { title, description, image_url, source_link, timestamp }
// ============================================================

const RSS_SOURCES = [
  { url: 'https://www.skysports.com/rss/12040',             source: 'Sky Sports',  lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport',   lang: 'en' },
  { url: 'https://www.goal.com/en/feeds/news?fmt=rss',      source: 'Goal.com',   lang: 'en' },
  { url: 'https://www.skysports.com/rss/11695',             source: 'Sky Sports Transfers', lang: 'en' }, // Transfer Centre
];

// ─────────────────────────────────────────────────────────────
// FOOTBALL NEWS KEYWORDS FILTER
// Only keep articles that match at least one of these keywords
// ─────────────────────────────────────────────────────────────
const FOOTBALL_KEYWORDS = [
  // Transfers & Signings
  'transfer', 'sign', 'signing', 'signed', 'deal', 'fee', 'bid', 'contract',
  'move', 'swap', 'loan', 'permanent', 'target', 'linked', 'agree', 'medical',
  'unveil', 'announce', 'done deal', 'arrival', 'departure', 'exit', 'sell',
  // Injuries & Medical
  'injury', 'injured', 'fitness', 'recover', 'return', 'out', 'ruled out',
  'muscle', 'knock', 'suspend', 'ban', 'hamstring', 'cruciate', 'surgery',
  'rehabilitation', 'absent', 'doubt', 'miss',
  // Club News
  'sack', 'appoint', 'resign', 'manager', 'coach', 'announce', 'statement',
  'press conference', 'squad', 'squad list', 'squad number', 'formation',
  'club', 'stadium', 'owner', 'chairman', 'financial', 'budget',
  // Match & Key Events
  'premier league', 'la liga', 'champions league', 'bundesliga', 'serie a',
  'ligue 1', 'fa cup', 'europa league', 'world cup', 'euro', 'international',
  'goal', 'hat-trick', 'penalty', 'red card', 'yellow card', 'referee',
  'var', 'offside', 'fixture', 'result', 'match', 'game', 'score'
];

function isFootballNews(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return FOOTBALL_KEYWORDS.some(kw => text.includes(kw));
}

// ─────────────────────────────────────────────────────────────
// TAG CATEGORISER — returns article category
// ─────────────────────────────────────────────────────────────
function categoriseArticle(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  if (['transfer', 'sign', 'signing', 'deal', 'fee', 'bid', 'contract', 'medical', 'loan', 'move', 'target', 'linked', 'agree', 'done deal'].some(k => text.includes(k))) return 'transfer';
  if (['injury', 'injured', 'recover', 'fitness', 'out', 'ruled out', 'miss', 'suspend', 'ban', 'hamstring', 'surgery', 'absence'].some(k => text.includes(k))) return 'injury';
  if (['sack', 'appoint', 'resign', 'manager', 'coach', 'statement', 'owner', 'chairman'].some(k => text.includes(k))) return 'club';
  return 'general';
}

// ─────────────────────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./service-account.json')) {
  serviceAccount = require('./service-account.json');
} else {
  console.error("❌ Missing service account"); process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://korra-b5d32-default-rtdb.firebaseio.com"
  });
}
const db   = admin.firestore();
const rtdb = admin.database();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// PARSE RSS XML (robust CDATA-aware parser)
// ─────────────────────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const extractTag = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
      return m ? m[1].trim() : '';
    };
    const title = extractTag('title') || '';
    const link  = extractTag('link') || '';
    const desc  = extractTag('description') || '';
    const pub   = extractTag('pubDate') || '';

    // Try multiple image sources
    const thumb =
      (item.match(/<media:thumbnail[^>]+url="([^"]+)"/) || [])[1] ||
      (item.match(/<media:content[^>]+url="([^"]+)"/) || [])[1] ||
      (item.match(/<enclosure[^>]+url="([^"]+)"/) || [])[1] ||
      (desc.match(/<img[^>]+src="([^"]+)"/) || [])[1] ||
      '';

    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 300);

    if (title && link) {
      items.push({ title, link, description: cleanDesc, publishedAt: pub, thumbnail: thumb });
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────
// SLUG GENERATOR
// ─────────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80);
}

// ─────────────────────────────────────────────────────────────
// GENERATE SITEMAP.XML
// ─────────────────────────────────────────────────────────────
async function generateSitemap(newsItems) {
  const baseUrl = 'https://korra-b5d32.web.app';
  const today = new Date().toISOString().split('T')[0];

  let urls = [
    `<url><loc>${baseUrl}/</loc><changefreq>hourly</changefreq><priority>1.0</priority><lastmod>${today}</lastmod></url>`,
  ];

  ['news', 'standings'].forEach(page => {
    urls.push(`<url><loc>${baseUrl}/?page=${page}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  });

  newsItems.forEach(n => {
    if (n.slug) {
      urls.push(`<url><loc>${baseUrl}/news/${n.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority><lastmod>${today}</lastmod></url>`);
    }
  });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  const sitemapPath = './football_live_score_web/public/sitemap.xml';
  if (fsMod.existsSync('./football_live_score_web/public')) {
    fsMod.writeFileSync(sitemapPath, sitemap, 'utf8');
    console.log(`✅ sitemap.xml generated with ${urls.length} URLs`);
  } else {
    // Try alternate path
    const altPath = './football_live_score_web/sitemap.xml';
    fsMod.writeFileSync(altPath, sitemap, 'utf8');
    console.log(`✅ sitemap.xml written to ${altPath}`);
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function syncNews() {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  NEWS SYNC V32.0 — Football News Only                ║`);
  console.log(`║  Timestamp: ${new Date().toISOString()}  ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);

  const allNews = [];
  const seenTitles = new Set();
  let totalFetched = 0;
  let totalFiltered = 0;

  for (const source of RSS_SOURCES) {
    try {
      console.log(`\n  📡 Fetching: ${source.source} (${source.url})`);
      const res = await axios.get(source.url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KorraLiveBot/32.0; +https://korra-b5d32.web.app)' }
      });

      const items = parseRSS(res.data);
      totalFetched += items.length;
      console.log(`    ✅ Parsed ${items.length} raw items`);

      let count = 0;
      for (const item of items.slice(0, 12)) { // Up to 12 per source
        if (seenTitles.has(item.title.toLowerCase())) continue;

        // ── STRICT FOOTBALL KEYWORD FILTER ──────────────────
        if (!isFootballNews(item.title, item.description)) {
          console.log(`    ⛔ Skipped (non-football): "${item.title.substring(0, 60)}..."`);
          continue;
        }

        seenTitles.add(item.title.toLowerCase());
        totalFiltered++;

        const slug   = slugify(item.title);
        const docId  = slug.substring(0, 45) + '-' + Date.now().toString(36);
        const category = categoriseArticle(item.title, item.description);
        const pubTs  = item.publishedAt ? new Date(item.publishedAt).getTime() : Date.now();

        // ── REQUIRED DATABASE STRUCTURE ──────────────────────
        // { title, description, image_url, source_link, timestamp }
        const newsItem = {
          id:           docId,
          slug,
          title:        item.title,
          description:  item.description || '',
          image_url:    item.thumbnail || '',
          source_link:  item.link,
          timestamp:    pubTs,
          source:       source.source,
          category,     // 'transfer' | 'injury' | 'club' | 'general'
          publishedAt:  new Date(pubTs).toISOString()
        };

        allNews.push(newsItem);
        count++;
        console.log(`    ✅ [${category.toUpperCase()}] "${item.title.substring(0, 70)}"`);
      }

      console.log(`    📊 Accepted ${count} / ${items.length} articles from ${source.source}`);
      await delay(500); // polite to servers

    } catch(e) {
      if (e.response) {
        console.warn(`    ⚠️  ${source.source} HTTP ${e.response.status}: ${e.message}`);
      } else {
        console.warn(`    ⚠️  ${source.source} failed: ${e.message}`);
      }
    }
  }

  console.log(`\n  📰 Total: Fetched ${totalFetched} | Accepted ${totalFiltered} football articles`);

  if (allNews.length === 0) {
    console.log("  ℹ️  No articles passed the filter. Writing empty placeholder to RTDB.");
    await rtdb.ref('news').set({
      _meta: { lastUpdated: Date.now(), source: "V32.0", status: "no_articles" }
    });
    process.exit(0);
  }

  // Sort by timestamp (newest first)
  allNews.sort((a, b) => b.timestamp - a.timestamp);

  // ── WRITE TO FIREBASE RTDB (Primary for UI) ─────────────────
  // Structure: news/{ articleId: { title, description, image_url, source_link, timestamp } }
  const rtdbPayload = {};
  allNews.slice(0, 40).forEach(n => {
    rtdbPayload[n.id] = {
      title:       n.title,
      description: n.description,
      image_url:   n.image_url,
      source_link: n.source_link,
      timestamp:   n.timestamp,
      source:      n.source,
      category:    n.category
    };
  });
  rtdbPayload['_meta'] = { lastUpdated: Date.now(), source: "V32.0", count: allNews.length };

  await rtdb.ref('news').set(rtdbPayload);
  console.log(`\n  ✅ RTDB 'news' node written (${allNews.length} articles)`);

  // ── WRITE TO FIRESTORE (Archive) ─────────────────────────────
  const batch = db.batch();
  allNews.forEach(n => {
    batch.set(db.collection('news').doc(n.id), {
      ...n,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  // Fast-load index (top 30)
  batch.set(db.collection('news_index').doc('latest'), {
    items: allNews.slice(0, 30).map(n => ({
      id:          n.id,
      slug:        n.slug,
      title:       n.title,
      description: n.description.substring(0, 150),
      image_url:   n.image_url,
      source_link: n.source_link,
      timestamp:   n.timestamp,
      source:      n.source,
      category:    n.category
    })),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });
  await batch.commit();
  console.log(`  ✅ Firestore 'news' collection updated (${allNews.length} docs)`);

  // ── GENERATE SITEMAP ─────────────────────────────────────────
  await generateSitemap(allNews);

  // ── SUMMARY ─────────────────────────────────────────────────
  const byCategory = allNews.reduce((acc, n) => {
    acc[n.category] = (acc[n.category] || 0) + 1;
    return acc;
  }, {});
  console.log(`\n  📊 Category Breakdown:`);
  Object.entries(byCategory).forEach(([cat, count]) => {
    console.log(`     ${cat.padEnd(10)} → ${count} articles`);
  });

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  ✅ V32.0 News Sync Complete! Total: ${String(allNews.length).padEnd(14)}║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  process.exit(0);
}

syncNews().catch(e => {
  console.error('[V32.0] Fatal sync error:', e?.message || e);
  process.exit(1);
});
