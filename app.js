/**
 * 화면 렌더링 코드.
 * - 사이트 목록: data/sites.json (정적 파일) + localStorage에 저장된 사용자 추가 사이트
 * - RSS 최신 기사: data/articles-cache.json (GitHub Actions가 2시간마다 갱신)
 * 데이터 구조를 몰라도 되도록 "대분류>세부분류" tags 문자열만 이용해 트리를 만든다.
 */
(function () {
  const CUSTOM_KEY = "mynews_custom_sites";
  const ALL_CATEGORY = "__all__";

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

  const CATEGORY_TONES = {
    "경제·산업": "#e7d9c0",
    "증권·기업정보": "#d9e2d6",
    "AI·IT": "#d8dfe8",
    "유튜브·크리에이터": "#f0d9d9",
    "수익화·광고": "#ece0c8",
    "창업·스타트업": "#dbd6e8",
    "트렌드": "#f0ded0",
    "정부지원·정책": "#d6e0e2",
    "생활정보": "#e5e5d5",
  };

  const TYPE_PURPOSE = {
    RSS: "기사 수집용",
    WEBSITE: "원문 사이트 바로가기용",
  };

  let selectedCategory = ALL_CATEGORY;
  let activeView = "feed"; // 'sites' | 'feed'
  let searchQuery = "";
  let typeFilter = "ALL"; // 'ALL' | 'RSS' | 'WEBSITE'
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

  function getOrderedCategories(tree) {
    const known = Object.keys(CATEGORY_ICONS).filter((c) => tree[c]);
    const extra = Object.keys(tree)
      .filter((c) => !CATEGORY_ICONS[c])
      .sort();
    return known.concat(extra);
  }

  function siteMatchesFilters(site) {
    if (typeFilter !== "ALL" && site.type !== typeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        site.name.toLowerCase().includes(q) || site.url.toLowerCase().includes(q)
      );
    }
    return true;
  }

  function renderCategoryCircles(tree) {
    const wrap = document.getElementById("category-circles");
    const categories = getOrderedCategories(tree);

    if (selectedCategory !== ALL_CATEGORY && !tree[selectedCategory]) {
      selectedCategory = ALL_CATEGORY;
    }

    const entries = [{ key: ALL_CATEGORY, icon: "✨", label: "전체" }].concat(
      categories.map((c) => ({ key: c, icon: CATEGORY_ICONS[c] || "📁", label: c }))
    );

    wrap.innerHTML = "";
    entries.forEach((entry) => {
      const isActive = entry.key === selectedCategory;
      const item = document.createElement("div");
      item.className = "category-circle-wrap" + (isActive ? " active" : "");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-circle" + (isActive ? " active" : "");
      btn.style.background = entry.key === ALL_CATEGORY ? "#f1ece0" : CATEGORY_TONES[entry.key] || "#eee";
      btn.textContent = entry.icon;
      btn.addEventListener("click", () => {
        selectedCategory = entry.key;
        render();
      });

      const label = document.createElement("span");
      label.className = "category-circle-label";
      label.textContent = entry.label;

      item.appendChild(btn);
      item.appendChild(label);
      wrap.appendChild(item);
    });

    const datalist = document.getElementById("category-options");
    datalist.innerHTML = categories
      .map((c) => `<option value="${escapeHtml(c)}"></option>`)
      .join("");
  }

  function renderSubgroups(container, subMap) {
    let rendered = 0;
    Object.keys(subMap)
      .sort()
      .forEach((sub) => {
        const seen = new Set();
        const filtered = [];
        subMap[sub].forEach((site) => {
          if (seen.has(site.url)) return;
          if (!siteMatchesFilters(site)) return;
          seen.add(site.url);
          filtered.push(site);
        });
        if (!filtered.length) return;
        rendered++;

        const group = document.createElement("div");
        group.className = "subgroup";
        const h3 = document.createElement("h3");
        h3.textContent = sub;
        group.appendChild(h3);

        const grid = document.createElement("div");
        grid.className = "site-grid";
        filtered.forEach((site) => grid.appendChild(renderSiteCard(site)));
        group.appendChild(grid);

        container.appendChild(group);
      });
    return rendered;
  }

  function renderSitesView(tree) {
    const header = document.getElementById("content-header");
    const body = document.getElementById("content-body");
    body.innerHTML = "";

    if (selectedCategory === ALL_CATEGORY) {
      header.innerHTML = `<h2>✨ 전체 사이트</h2>`;
      let total = 0;
      getOrderedCategories(tree).forEach((cat) => {
        const section = document.createElement("div");
        section.className = "category-section";
        const title = document.createElement("h2");
        title.className = "content-header";
        title.style.marginTop = "8px";
        title.innerHTML = `${CATEGORY_ICONS[cat] || "📁"} ${escapeHtml(cat)}`;
        section.appendChild(title);
        const count = renderSubgroups(section, tree[cat]);
        if (count) {
          total += count;
          body.appendChild(section);
        }
      });
      if (!body.children.length) {
        body.innerHTML = '<p class="empty">검색 결과가 없습니다.</p>';
      }
      return;
    }

    const subMap = tree[selectedCategory];
    if (!subMap) {
      header.innerHTML = "";
      body.innerHTML = '<p class="empty">등록된 사이트가 없습니다. 사이트를 추가해보세요.</p>';
      return;
    }
    header.innerHTML = `<h2>${CATEGORY_ICONS[selectedCategory] || "📁"} ${escapeHtml(selectedCategory)}</h2><span class="meta">${countSites(subMap)}개 사이트</span>`;
    renderSubgroups(body, subMap);
    if (!body.children.length) {
      body.innerHTML = '<p class="empty">검색 결과가 없습니다.</p>';
    }
  }

  function renderFeedView() {
    const header = document.getElementById("content-header");
    const body = document.getElementById("content-body");

    let articles = [];
    Object.values(ARTICLE_CACHE.feeds || {}).forEach((feed) => {
      if (selectedCategory !== ALL_CATEGORY && feed.category !== selectedCategory) return;
      (feed.items || []).forEach((item) => {
        articles.push({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          siteName: feed.name,
          category: feed.category,
          subcategory: feed.subcategory,
        });
      });
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      articles = articles.filter(
        (a) => a.title.toLowerCase().includes(q) || a.siteName.toLowerCase().includes(q)
      );
    }

    articles.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
    articles = articles.slice(0, 60);

    header.innerHTML = `<h2>📰 최신 뉴스</h2><span class="meta">${articles.length}건</span>`;
    body.innerHTML = "";

    if (!articles.length) {
      body.innerHTML = '<p class="empty">표시할 기사가 없습니다.</p>';
      return;
    }

    const grid = document.createElement("div");
    grid.className = "news-grid";
    articles.forEach((article) => grid.appendChild(renderNewsCard(article)));
    body.appendChild(grid);
  }

  function renderNewsCard(article) {
    const a = document.createElement("a");
    a.className = "news-card";
    a.href = article.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const tone = CATEGORY_TONES[article.category] || "#eee";
    const icon = CATEGORY_ICONS[article.category] || "📰";
    const dateStr = formatPubDate(article.pubDate);

    a.innerHTML = `
      <div class="news-card-meta">
        <span>${escapeHtml(dateStr || "")}</span>
        <span>${escapeHtml(article.siteName)}</span>
      </div>
      <div class="news-card-photo" style="background:${tone}">${icon}</div>
      <h3 class="news-card-title">${escapeHtml(article.title)}</h3>
      <div class="news-card-footer">
        <span>${escapeHtml(article.subcategory || "")}</span>
        <span class="news-card-link">원문 보기 →</span>
      </div>
    `;
    return a;
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
    renderCategoryCircles(tree);

    document.querySelectorAll(".hero-nav-btn[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === activeView);
    });
    document.getElementById("type-filter").hidden = activeView === "feed";

    if (activeView === "feed") {
      renderFeedView();
    } else {
      renderSitesView(tree);
    }
    renderStatusBar();
  }

  function setupAddForm() {
    const panel = document.getElementById("add-form-panel");
    const toggle = () => {
      panel.hidden = !panel.hidden;
    };
    document.getElementById("hero-menu-btn").addEventListener("click", toggle);
    document.getElementById("hero-add-btn").addEventListener("click", toggle);

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
          activeView = "sites";
          render();
        }
      });
    }

    handleSubmit(document.getElementById("rss-form"), "RSS");
    handleSubmit(document.getElementById("website-form"), "WEBSITE");
  }

  function setupToolbar() {
    document.querySelectorAll(".hero-nav-btn[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeView = btn.dataset.view;
        render();
      });
    });

    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value.trim();
      render();
    });

    document.querySelectorAll(".chip[data-type]").forEach((chip) => {
      chip.addEventListener("click", () => {
        typeFilter = chip.dataset.type;
        document.querySelectorAll(".chip[data-type]").forEach((c) => c.classList.toggle("active", c === chip));
        render();
      });
    });
  }

  async function init() {
    setupAddForm();
    setupToolbar();

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
