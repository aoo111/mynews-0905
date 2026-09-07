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

// Discord 제약: 메시지 하나에 포함된 모든 임베드의 글자수 합계가 6000자를
// 넘을 수 없고, 임베드도 최대 10개까지만 허용된다. 카테고리가 많으면
// 한 메시지에 다 안 들어가므로, 여유 있게 여러 메시지로 나눠 보낸다.
const MAX_TOTAL_CHARS_PER_MESSAGE = 5500;
const MAX_EMBEDS_PER_MESSAGE = 10;

function embedLength(embed) {
  return (embed.title || "").length + (embed.description || "").length;
}

function batchEmbeds(embeds) {
  const batches = [];
  let current = [];
  let currentLen = 0;
  embeds.forEach((embed) => {
    const len = embedLength(embed);
    if (
      current.length &&
      (current.length >= MAX_EMBEDS_PER_MESSAGE || currentLen + len > MAX_TOTAL_CHARS_PER_MESSAGE)
    ) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(embed);
    currentLen += len;
  });
  if (current.length) batches.push(current);
  return batches;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postToDiscord(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord 전송 실패: HTTP ${res.status} ${text}`);
  }
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
  const batches = batchEmbeds(embeds);

  for (let i = 0; i < batches.length; i++) {
    const content = i === 0 ? `📰 **${today} 뉴스 요약**` : undefined;
    await postToDiscord(webhookUrl, { content, embeds: batches[i] });
    console.log(`[discord] ${i + 1}/${batches.length}번째 메시지 전송 완료 (임베드 ${batches[i].length}개)`);
    if (i < batches.length - 1) await sleep(500);
  }

  return { ok: true };
}

if (require.main === module) {
  sendDiscordSummary().catch((err) => {
    console.error("[discord]", err.message);
    process.exit(1);
  });
}

module.exports = { sendDiscordSummary, buildEmbeds, batchEmbeds };
