const admin = require('firebase-admin');
const axios = require('axios');
const fsMod = require('fs');

// ============================================================
//  NEWS SYNC SCRIPT V9.0
//  - Fetches RSS from SkySports + BBC Football
//  - Auto-translates to Arabic via Google Translate (free)
//  - Saves to Firestore 'news' collection
//  - Generates sitemap.xml
// ============================================================

const RSS_SOURCES = [
  { url: 'https://www.skysports.com/rss/12040',         source: 'Sky Sports' },
  { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport' },
  { url: 'https://www.goal.com/en/feeds/news?fmt=rss',  source: 'Goal.com' },
];

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (fsMod.existsSync('./football_live_score_web/functions/service-account.json.json')) {
  serviceAccount = require('./football_live_score_web/functions/service-account.json.json');
} else {
  console.error("❌ Missing service account"); process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// FREE TRANSLATION: Google Translate API (unofficial/free)
// ─────────────────────────────────────────────────────────────
async function translate(text, from = 'en', to = 'ar') {
  if (!text) return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text.substring(0, 500))}`;
    const res = await axios.get(url, { timeout: 5000 });
    // Response: [[["translated","original",...],...],...]
    return res.data[0].map(item => item[0]).join('');
  } catch(e) {
    return text; // fallback to original
  }
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
// PARSE RSS XML
// ─────────────────────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const extractTag = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\/${tag}>`, 's'));
      return m ? m[1].trim() : '';
    };
    const title = extractTag('title') || '';
    const link  = extractTag('link') || '';
    const desc  = extractTag('description') || '';
    const pub   = extractTag('pubDate') || '';
    const thumb = (item.match(/<media:thumbnail[^>]+url="([^"]+)"/) || [])[1] || 
                  (item.match(/<enclosure[^>]+url="([^"]+)"/) || [])[1] || '';
    if (title && link) {
      items.push({ title, link, description: desc.replace(/<[^>]+>/g, '').substring(0, 300), publishedAt: pub, thumbnail: thumb });
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────
// GENERATE SITEMAP.XML
// ─────────────────────────────────────────────────────────────
async function generateSitemap(newsItems, matchDates) {
  const baseUrl = 'https://korra-b5d32.web.app';
  const today = new Date().toISOString().split('T')[0];

  let urls = [
    `<url><loc>${baseUrl}/</loc><changefreq>hourly</changefreq><priority>1.0</priority><lastmod>${today}</lastmod></url>`,
  ];

  // Static pages
  ['news', 'replays', 'standings'].forEach(page => {
    urls.push(`<url><loc>${baseUrl}/?page=${page}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  });

  // News article URLs
  newsItems.forEach(n => {
    if (n.slug) {
      urls.push(`<url><loc>${baseUrl}/news/${n.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority><lastmod>${today}</lastmod></url>`);
    }
  });

  // Match replay URLs
  matchDates.forEach(d => {
    urls.push(`<url><loc>${baseUrl}/replays/${d}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fsMod.writeFileSync('./football_live_score_web/public/sitemap.xml', sitemap, 'utf8');
  console.log(`✅ sitemap.xml generated with ${urls.length} URLs`);
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function syncNews() {
  console.log(`\n📰 [News Sync V9.0] START: ${new Date().toISOString()}`);

  const allNews = [];
  const seenTitles = new Set();

  for (const source of RSS_SOURCES) {
    try {
      console.log(`\n  📡 Fetching: ${source.source}...`);
      const res = await axios.get(source.url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KorraBot/1.0)' }
      });

      const items = parseRSS(res.data);
      console.log(`    ✅ Found ${items.length} items`);

      let count = 0;
      for (const item of items.slice(0, 8)) { // Max 8 per source
        if (seenTitles.has(item.title)) continue;
        seenTitles.add(item.title);

        // Translate title and description
        const titleAr  = await translate(item.title);
        await delay(300);
        const descAr   = await translate(item.description);
        await delay(300);
        
        const slug = slugify(item.title);
        const docId = slug.substring(0, 50) + '-' + Date.now().toString(36);

        allNews.push({
          id: docId,
          slug,
          titleEn: item.title,
          titleAr,
          descEn: item.description,
          descAr,
          link: item.link,
          thumbnail: item.thumbnail,
          source: source.source,
          publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : new Date().toISOString(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        count++;
        console.log(`    🌐 "${titleAr.substring(0, 50)}..."`);
      }

      console.log(`    ✨ Translated ${count} articles from ${source.source}`);
    } catch(e) {
      console.warn(`    ⚠️  ${source.source} failed: ${e.message}`);
    }
  }

  // Save to Firestore
  if (allNews.length > 0) {
    const batch = db.batch();
    // Save individual docs
    allNews.forEach(n => {
      batch.set(db.collection('news').doc(n.id), n);
    });
    // Save index (latest 30 for fast front-page load)
    batch.set(db.collection('news_index').doc('latest'), {
      items: allNews.slice(0, 30).map(n => ({
        id: n.id, slug: n.slug, titleAr: n.titleAr, titleEn: n.titleEn,
        descAr: n.descAr.substring(0, 120), thumbnail: n.thumbnail,
        source: n.source, publishedAt: n.publishedAt
      })),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    console.log(`\n✅ Saved ${allNews.length} articles to Firestore`);
  }

  // Get match dates for sitemap
  let matchDates = [];
  try {
    const snap = await db.collection('archive').listDocuments();
    matchDates = snap.map(d => d.id);
  } catch(e) {}

  // Generate sitemap
  await generateSitemap(allNews, matchDates);

  console.log(`\n🎉 News Sync Complete! Articles: ${allNews.length}`);
  process.exit(0);
}

syncNews();
