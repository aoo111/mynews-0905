/**
 * data/articles-cache.json의 최신 수집 결과를 카테고리별로 묶어 Discord
 * 웹후크로 요약 전송한다. 매일 오전 9시(KST) GitHub Actions에서 실행되며,
 * 로컬에서 테스트할 때는 .env에 DISCORD_WEBHOOK_URL을 넣고
 * `npm run send-discord`로 실행한다.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "..", "data", "articles-cache.json");
const TIMEZONE = "Asia/Seoul";
const ARTICLES_PER_FEED = 3;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch (e) {
    return { collectedAt: null, feeds: {} };
  }
}

function buildEmbeds(cache) {
  const byCategory = {};
  Object.values(cache.feeds || {}).forEach((feed) => {
    if (!feed.items || !feed.items.length) return;
    if (!byCategory[feed.category]) byCategory[feed.category] = [];
    byCategory[feed.category].push(feed);
  });

  return Object.keys(byCategory)
    .sort()
    .slice(0, 10)
    .map((category) => {
      const lines = [];
      byCategory[category].forEach((feed) => {
        lines.push(`**${feed.name}**`);
        feed.items.slice(0, ARTICLES_PER_FEED).forEach((item) => {
          const title =
            item.title.length > 90 ? item.title.slice(0, 90) + "…" : item.title;
          lines.push(`- [${title}](${item.link})`);
        });
      });
      return {
        title: category,
        description: lines.join("\n").slice(0, 4000),
        color: 0x2563eb,
      };
    });
}

async function sendDiscordSummary() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL 환경변수가 설정되어 있지 않습니다.");
  }

  const cache = loadCache();
  const embeds = buildEmbeds(cache);
  if (!embeds.length) {
    console.warn("[discord] 보낼 기사가 없어 전송을 건너뜁니다.");
    return { skipped: true };
  }

  const today = new Date().toLocaleDateString("ko-KR", { timeZone: TIMEZONE });
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `📰 **${today} 뉴스 요약**`,
      embeds,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord 전송 실패: HTTP ${res.status} ${text}`);
  }

  console.log("[discord] 요약 전송 완료");
  return { ok: true };
}

if (require.main === module) {
  sendDiscordSummary().catch((err) => {
    console.error("[discord]", err.message);
    process.exit(1);
  });
}

module.exports = { sendDiscordSummary, buildEmbeds };
