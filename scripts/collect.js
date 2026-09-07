/**
 * RSS 피드를 전부 수집해서 data/articles-cache.json에 저장한다.
 * - GitHub Actions(.github/workflows/collect.yml)에서 2시간마다 실행되고,
 *   로컬에서도 `npm run collect`로 동일하게 실행할 수 있다.
 * - 개별 피드가 실패해도 나머지 피드 수집은 계속 진행하고, 실패한 피드는
 *   이전에 성공했던 결과(있다면)를 유지한다.
 */
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");

const SITES_PATH = path.join(__dirname, "..", "data", "sites.json");
const CACHE_PATH = path.join(__dirname, "..", "data", "articles-cache.json");
const ARTICLES_PER_FEED = 5;
const FETCH_TIMEOUT_MS = 15000;

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

// RSS 항목에서 대표 이미지를 최대한 찾아본다: enclosure -> media:thumbnail
// -> media:content -> 본문 HTML 안의 첫 <img> 순으로 시도하고, 없으면 null.
function extractImage(item) {
  if (item.enclosure && item.enclosure.url) {
    const type = item.enclosure.type || "";
    if (!type || type.startsWith("image")) return item.enclosure.url;
  }

  const thumb = item.mediaThumbnail;
  if (thumb) {
    const url = (thumb.$ && thumb.$.url) || thumb.url;
    if (url) return url;
  }

  const mediaList = item.mediaContent
    ? Array.isArray(item.mediaContent)
      ? item.mediaContent
      : [item.mediaContent]
    : [];
  for (const media of mediaList) {
    const attrs = media.$ || media || {};
    const medium = attrs.medium || "";
    const type = attrs.type || "";
    if (attrs.url && (medium === "image" || type.startsWith("image") || (!medium && !type))) {
      return attrs.url;
    }
  }

  const html = item["content:encoded"] || item.content || item.summary || item.description || "";
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (match) return match[1];

  return null;
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, " ");
}

// 기사 요약: RSS가 제공하는 본문 스니펫을 최대한 활용한다 (자체 AI 요약이
// 아니라 RSS 원문의 설명/요약 필드를 정리해서 보여주는 것).
function extractSummary(item) {
  const raw =
    item.contentSnippet ||
    stripHtml(item["content:encoded"] || item.content || item.summary || item.description || "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

const KEYWORD_STOPWORDS = new Set([
  "그리고", "에서", "으로", "하는", "있다", "한다", "것으로", "대한", "위해",
  "통해", "이번", "오늘", "기자", "이후", "관련", "에게", "까지", "부터",
]);

// 기사별 키워드: RSS의 <category> 태그가 있으면 그대로 쓰고, 없으면
// 제목에서 의미 있어 보이는 단어를 뽑아 대신 사용한다.
function extractKeywords(item) {
  if (Array.isArray(item.categories) && item.categories.length) {
    return [...new Set(item.categories.map((c) => String(c).trim()).filter(Boolean))].slice(0, 6);
  }
  const title = item.title || "";
  const words = title
    .replace(/[\[\]"'“”‘’…!?,.·\-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !KEYWORD_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 5);
}

function loadSites() {
  return JSON.parse(fs.readFileSync(SITES_PATH, "utf-8"));
}

function loadPreviousCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch (e) {
    return { collectedAt: null, feeds: {} };
  }
}

// 쿼리 문자열에 URL-인코딩되지 않은 비ASCII 문자(한글 등)가 섞여 있어도
// 안전하게 요청할 수 있도록, 이미 인코딩된 부분(%xx, &, =, +)은 건드리지
// 않고 비ASCII 문자만 percent-encoding 한다.
function toFetchableUrl(url) {
  return url.replace(/[^\x00-\x7F]/g, (ch) => encodeURIComponent(ch));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(toFetchableUrl(url), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MyNewsBot/1.0",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      throw new Error("RSS가 아닌 HTML 페이지가 반환됨 (피드 주소를 다시 확인하세요)");
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(site) {
  const xml = await fetchText(site.url);
  const feed = await parser.parseString(xml);
  return (feed.items || []).slice(0, ARTICLES_PER_FEED).map((item) => ({
    title: (item.title || "(제목 없음)").trim(),
    link: item.link || site.url,
    pubDate: item.isoDate || item.pubDate || null,
    image: extractImage(item),
    summary: extractSummary(item),
    keywords: extractKeywords(item),
  }));
}

async function collectAllFeeds() {
  const sites = loadSites().filter((s) => s.type === "RSS");
  const previous = loadPreviousCache();
  console.log(`[collect] ${sites.length}개 RSS 피드 수집 시작`);

  const feeds = {};
  for (const site of sites) {
    try {
      const items = await fetchFeed(site);
      feeds[site.url] = {
        name: site.name,
        category: site.category,
        subcategory: site.subcategory,
        items,
        fetchedAt: new Date().toISOString(),
        error: null,
      };
      console.log(`[collect] OK  - ${site.name} (${items.length}건)`);
    } catch (err) {
      const prev = previous.feeds ? previous.feeds[site.url] : null;
      feeds[site.url] = {
        name: site.name,
        category: site.category,
        subcategory: site.subcategory,
        items: prev ? prev.items : [],
        fetchedAt: prev ? prev.fetchedAt : null,
        error: err.message,
      };
      console.error(`[collect] FAIL - ${site.name} (${site.url}) - ${err.message}`);
    }
  }

  const cache = { collectedAt: new Date().toISOString(), feeds };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8");
  console.log(`[collect] 완료 - ${CACHE_PATH} 저장`);
  return cache;
}

if (require.main === module) {
  collectAllFeeds().catch((err) => {
    console.error("[collect] 치명적 오류", err);
    process.exit(1);
  });
}

module.exports = { collectAllFeeds };
