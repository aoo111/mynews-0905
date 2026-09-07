/**
 * 화면 렌더링 코드.
 * - 사이트 목록: 서버 /api/sites (data/sites.json) + localStorage에 저장된 사용자 추가 사이트
 * - RSS 최신 기사: 서버 /api/articles (2시간마다 서버가 수집해 캐시한 결과)
 * 데이터 구조를 몰라도 되도록 "대분류>세부분류" tags 문자열만 이용해 트리를 만든다.
 */
(function () {
  const CUSTOM_KEY = "mynews_custom_sites";

  const CATEGORY_ICONS = {
    "경제·산업": "📊",
    "증권·기업정보": "📈",
    "AI·IT": "🤖",
    "유튜브·크리에이터": "🎬",
    "수익화·광고": "💰",
    "창업·스타트업": "🚀",
    "트렌드": "🔥",
    "정부지원·정책": "🏛️",
    "생활정보": "☀️",
  };

  const TYPE_PURPOSE = {
    RSS: "기사 수집용",
    WEBSITE: "원문 사이트 바로가기용",
  };

  let selectedCategory = null;
  let BASE_SITES = [];
  let ARTICLE_CACHE = { collectedAt: null, feeds: {} };

  function loadCustomSites() {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveCustomSites(list) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  function getAllSites() {
    const base = BASE_SITES.map((s) => ({ ...s, custom: false }));
    const custom = loadCustomSites().map((s) => ({ ...s, custom: true }));
    return base.concat(custom);
  }

  // 대분류 -> 세부분류 -> site[] 트리를 만든다. 같은 site가 여러 tag를
  // 가지면 해당하는 모든 대분류/세부분류 아래에 각각 노출된다.
  function buildTree(sites) {
    const tree = {};
    sites.forEach((site) => {
      const tags =
        Array.isArray(site.tags) && site.tags.length
          ? site.tags
          : [`${site.category}>${site.subcategory}`];
      tags.forEach((tag) => {
        const [cat, sub] = tag.split(">");
        if (!cat || !sub) return;
        if (!tree[cat]) tree[cat] = {};
        if (!tree[cat][sub]) tree[cat][sub] = [];
        tree[cat][sub].push(site);
      });
    });
    return tree;
  }

  function countSites(subMap) {
    const seen = new Set();
    Object.values(subMap).forEach((list) =>
      list.forEach((s) => seen.add(s.url))
    );
    return seen.size;
  }

  function renderSidebar(tree) {
    const list = document.getElementById("category-list");
    const known = Object.keys(CATEGORY_ICONS).filter((c) => tree[c]);
    const extra = Object.keys(tree)
      .filter((c) => !CATEGORY_ICONS[c])
      .sort();
    const categories = known.concat(extra);

    if (!selectedCategory || !tree[selectedCategory]) {
      selectedCategory = categories[0] || null;
    }

    list.innerHTML = "";
    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-btn" + (cat === selectedCategory ? " active" : "");
      btn.innerHTML = `<span>${CATEGORY_ICONS[cat] || "📁"} ${escapeHtml(cat)}</span><span class="count">${countSites(tree[cat])}</span>`;
      btn.addEventListener("click", () => {
        selectedCategory = cat;
        render();
      });
      list.appendChild(btn);
    });

    const datalist = document.getElementById("category-options");
    datalist.innerHTML = categories
      .map((c) => `<option value="${escapeHtml(c)}"></option>`)
      .join("");
  }

  function renderContent(tree) {
    const header = document.getElementById("content-header");
    const body = document.getElementById("content-body");

    if (!selectedCategory) {
      header.innerHTML = "";
      body.innerHTML = '<p class="empty">등록된 사이트가 없습니다. 사이트를 추가해보세요.</p>';
      return;
    }

    const subMap = tree[selectedCategory];
    header.innerHTML = `<h2>${CATEGORY_ICONS[selectedCategory] || "📁"} ${escapeHtml(selectedCategory)}</h2><span class="meta">${countSites(subMap)}개 사이트</span>`;

    body.innerHTML = "";
    Object.keys(subMap)
      .sort()
      .forEach((sub) => {
        const group = document.createElement("div");
        group.className = "subgroup";

        const h3 = document.createElement("h3");
        h3.textContent = sub;
        group.appendChild(h3);

        const grid = document.createElement("div");
        grid.className = "site-grid";

        const seen = new Set();
        subMap[sub].forEach((site) => {
          if (seen.has(site.url)) return;
          seen.add(site.url);
          grid.appendChild(renderSiteCard(site));
        });

        group.appendChild(grid);
        body.appendChild(group);
      });
  }

  function formatPubDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function renderSiteCard(site) {
    const card = document.createElement("div");
    card.className = "site-card";

    const top = document.createElement("div");
    top.className = "row-top";
    top.innerHTML = `<span class="name">${escapeHtml(site.name)}</span><span class="badge ${site.type}">${site.type}</span>`;
    card.appendChild(top);

    const purpose = document.createElement("div");
    purpose.className = "purpose";
    purpose.textContent = TYPE_PURPOSE[site.type] || "";
    card.appendChild(purpose);

    const link = document.createElement("a");
    link.className = "url";
    link.href = site.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = site.url;
    card.appendChild(link);

    if (site.type === "RSS") {
      card.appendChild(renderArticleList(site));
    }

    if (site.custom) {
      const bottom = document.createElement("div");
      bottom.className = "row-bottom";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete-btn";
      del.textContent = "삭제";
      del.addEventListener("click", () => removeCustomSite(site.url));
      bottom.appendChild(del);
      card.appendChild(bottom);
    }

    return card;
  }

  function renderArticleList(site) {
    const wrap = document.createElement("div");
    wrap.className = "article-list";

    const feed = ARTICLE_CACHE.feeds ? ARTICLE_CACHE.feeds[site.url] : null;

    if (!feed) {
      wrap.innerHTML = '<p class="article-empty">수집 대기 중...</p>';
      return wrap;
    }
    if (feed.error && (!feed.items || !feed.items.length)) {
      wrap.innerHTML = `<p class="article-empty">수집 실패: ${escapeHtml(feed.error)}</p>`;
      return wrap;
    }
    if (!feed.items || !feed.items.length) {
      wrap.innerHTML = '<p class="article-empty">최근 기사가 없습니다.</p>';
      return wrap;
    }

    const ul = document.createElement("ul");
    feed.items.forEach((item) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = item.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = item.title;
      li.appendChild(a);
      const date = formatPubDate(item.pubDate);
      if (date) {
        const span = document.createElement("span");
        span.className = "article-date";
        span.textContent = date;
        li.appendChild(span);
      }
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function removeCustomSite(url) {
    const list = loadCustomSites().filter((s) => s.url !== url);
    saveCustomSites(list);
    render();
  }

  function addCustomSite(site) {
    const all = getAllSites();
    if (all.some((s) => s.url === site.url)) {
      alert("이미 등록된 주소입니다.");
      return false;
    }
    const list = loadCustomSites();
    list.push(site);
    saveCustomSites(list);
    return true;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function renderStatusBar() {
    const bar = document.getElementById("status-bar");
    const collectedAt = ARTICLE_CACHE.collectedAt
      ? new Date(ARTICLE_CACHE.collectedAt).toLocaleString("ko-KR")
      : "아직 없음";
    bar.textContent = `마지막 수집(GitHub Actions): ${collectedAt} · 2시간 간격 자동 수집 · 매일 오전 9시 디스코드 전송`;
  }

  function render() {
    const tree = buildTree(getAllSites());
    renderSidebar(tree);
    renderContent(tree);
    renderStatusBar();
  }

  function setupAddForm() {
    const toggleBtn = document.getElementById("toggle-add-form");
    const panel = document.getElementById("add-form-panel");
    toggleBtn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggleBtn.textContent = panel.hidden ? "+ 사이트 추가" : "− 사이트 추가 닫기";
    });

    function handleSubmit(form, type) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = new FormData(form);
        const name = data.get("name").trim();
        const category = data.get("category").trim();
        const subcategory = data.get("subcategory").trim();
        const url = data.get("url").trim();
        if (!name || !category || !subcategory || !url) return;

        const ok = addCustomSite({
          name,
          url,
          type,
          category,
          subcategory,
          tags: [`${category}>${subcategory}`],
        });
        if (ok) {
          form.reset();
          selectedCategory = category;
          render();
        }
      });
    }

    handleSubmit(document.getElementById("rss-form"), "RSS");
    handleSubmit(document.getElementById("website-form"), "WEBSITE");
  }

  async function init() {
    setupAddForm();

    const [sites, articles] = await Promise.all([
      fetch("data/sites.json").then((r) => r.json()),
      fetch("data/articles-cache.json").then((r) => r.json()),
    ]);
    BASE_SITES = sites;
    ARTICLE_CACHE = articles;
    render();

    // GitHub Actions가 2시간마다 커밋하는 최신 데이터를 반영하기 위해
    // 주기적으로 캐시 파일을 다시 읽어온다 (페이지를 계속 열어둔 경우).
    setInterval(async () => {
      ARTICLE_CACHE = await fetch("data/articles-cache.json", { cache: "no-store" }).then((r) => r.json());
      render();
    }, 5 * 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
