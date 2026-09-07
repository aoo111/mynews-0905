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
  let translateEnabled = false;
  let selectedDate = null; // "YYYY-MM-DD" | null
  let trendingScope = "domestic"; // 'domestic' | 'global'
  let calendarMonth = new Date(); // 달력에 표시 중인 달(일 단위는 무시)
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
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        site.name.toLowerCase().includes(q) || site.url.toLowerCase().includes(q)
      );
    }
    return true;
  }

  function updateCategoryOptions(tree) {
    const categories = getOrderedCategories(tree);
    if (selectedCategory !== ALL_CATEGORY && !tree[selectedCategory]) {
      selectedCategory = ALL_CATEGORY;
    }
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

  // 사이트 하나가 여러 대분류에 걸쳐 있을 수 있으므로(tags), 피드 뷰의
  // 카테고리 필터도 대표 category 하나가 아니라 전체 tags 기준으로 맞춘다.
  // (사이트 모음 뷰와 동일한 기준을 쓰기 위함 - 예: Tubefilter는
  // 유튜브·크리에이터의 대표 사이트지만 트렌드 카테고리에도 태그되어 있다.)
  function getSiteCategoriesByUrl(url) {
    const site = getAllSites().find((s) => s.url === url);
    if (!site) return [];
    const tags =
      Array.isArray(site.tags) && site.tags.length
        ? site.tags
        : [`${site.category}>${site.subcategory}`];
    return [...new Set(tags.map((t) => t.split(">")[0]))];
  }

  function getCategoryArticleCounts() {
    const counts = {};
    let total = 0;
    Object.entries(ARTICLE_CACHE.feeds || {}).forEach(([url, feed]) => {
      const n = (feed.items || []).length;
      if (!n) return;
      total += n;
      getSiteCategoriesByUrl(url).forEach((cat) => {
        counts[cat] = (counts[cat] || 0) + n;
      });
    });
    return { counts, total };
  }

  function renderCategorySidebar(tree) {
    const sidebar = document.getElementById("category-sidebar");
    const categories = getOrderedCategories(tree);
    const { counts, total } = getCategoryArticleCounts();

    sidebar.innerHTML = "";
    const entries = [{ key: ALL_CATEGORY, icon: "✨", label: "전체", count: total }].concat(
      categories.map((c) => ({ key: c, icon: CATEGORY_ICONS[c] || "📁", label: c, count: counts[c] || 0 }))
    );

    entries.forEach((entry) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-nav-btn" + (entry.key === selectedCategory ? " active" : "");
      btn.innerHTML = `<span>${entry.icon} ${escapeHtml(entry.label)}</span><span class="count">${entry.count}</span>`;
      btn.addEventListener("click", () => {
        selectedCategory = entry.key;
        render();
      });
      sidebar.appendChild(btn);
    });
  }

  function toDateKey(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDateKeyLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return `${y}년 ${m}월 ${d}일`;
  }

  function getAvailableDateSet() {
    const set = new Set();
    Object.values(ARTICLE_CACHE.feeds || {}).forEach((feed) => {
      (feed.items || []).forEach((item) => {
        const key = toDateKey(item.pubDate);
        if (key) set.add(key);
      });
    });
    return set;
  }

  function renderCalendar() {
    const grid = document.getElementById("calendar-grid");
    const label = document.getElementById("calendar-month-label");
    const clearBtn = document.getElementById("calendar-clear");

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    label.textContent = `${year}년 ${month + 1}월`;
    clearBtn.hidden = !selectedDate;

    const availableDates = getAvailableDateSet();
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({ day: daysInPrevMonth - i, otherMonth: true, key: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ day, otherMonth: false, key });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: cells.length, otherMonth: true, key: null });
    }

    grid.innerHTML = "";
    cells.forEach((cell) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = cell.day;
      const classes = ["calendar-day"];
      if (cell.otherMonth) classes.push("other-month");
      if (cell.key && availableDates.has(cell.key)) classes.push("has-articles");
      if (cell.key && cell.key === selectedDate) classes.push("selected");
      btn.className = classes.join(" ");
      if (!cell.otherMonth) {
        btn.addEventListener("click", () => {
          selectedDate = selectedDate === cell.key ? null : cell.key;
          render();
        });
      } else {
        btn.disabled = true;
      }
      grid.appendChild(btn);
    });
  }

  function setupCalendar() {
    document.getElementById("calendar-prev").addEventListener("click", () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById("calendar-next").addEventListener("click", () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById("calendar-clear").addEventListener("click", () => {
      selectedDate = null;
      render();
    });
  }

  const TRENDING_CHANGE_SYMBOL = { up: "▲", down: "▼", new: "NEW", same: "–" };

  function renderTrendingKeywords() {
    const list = document.getElementById("trending-list");
    const trending =
      (trendingScope === "global" ? ARTICLE_CACHE.trendingGlobal : ARTICLE_CACHE.trendingDomestic) || [];

    list.innerHTML = "";
    if (!trending.length) {
      list.innerHTML = '<li class="trending-empty">아직 집계된 키워드가 없습니다.</li>';
      return;
    }

    trending.forEach((t) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "trending-item";
      const symbol = TRENDING_CHANGE_SYMBOL[t.change] || "–";
      const label = translateEnabled && t.labelKo ? t.labelKo : t.label;
      btn.innerHTML = `
        <span class="trending-rank${t.rank <= 3 ? " top3" : ""}">${t.rank}</span>
        <span class="trending-label">${escapeHtml(label)}</span>
        <span class="trending-change ${t.change}">${symbol}</span>
      `;
      btn.addEventListener("click", () => {
        document.getElementById("search-input").value = label;
        searchQuery = label;
        activeView = "feed";
        render();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function setupTrending() {
    document.querySelectorAll(".trending-tab[data-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        trendingScope = btn.dataset.scope;
        document
          .querySelectorAll(".trending-tab[data-scope]")
          .forEach((b) => b.classList.toggle("active", b === btn));
        renderTrendingKeywords();
      });
    });
  }

  function renderFeedView() {
    const header = document.getElementById("content-header");
    const body = document.getElementById("content-body");

    let articles = [];
    Object.entries(ARTICLE_CACHE.feeds || {}).forEach(([url, feed]) => {
      if (
        selectedCategory !== ALL_CATEGORY &&
        !getSiteCategoriesByUrl(url).includes(selectedCategory)
      )
        return;
      (feed.items || []).forEach((item) => {
        articles.push({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          image: item.image || null,
          summary: item.summary || "",
          keywords: item.keywords || [],
          isForeign: !!item.isForeign,
          titleKo: item.titleKo || null,
          summaryKo: item.summaryKo || null,
          siteName: feed.name,
          category: feed.category,
          subcategory: feed.subcategory,
        });
      });
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      articles = articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.titleKo && a.titleKo.toLowerCase().includes(q)) ||
          a.siteName.toLowerCase().includes(q) ||
          (a.keywords || []).some((k) => k.toLowerCase().includes(q))
      );
    }

    if (selectedDate) {
      articles = articles.filter((a) => toDateKey(a.pubDate) === selectedDate);
    }

    articles.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
    articles = articles.slice(0, 60);

    const title = selectedDate ? `📰 ${formatDateKeyLabel(selectedDate)} 뉴스` : "📰 최신 뉴스";
    header.innerHTML = `<h2>${title}</h2><span class="meta">${articles.length}건</span>`;
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

  function getDisplayTitle(article) {
    return translateEnabled && article.titleKo ? article.titleKo : article.title;
  }

  function getDisplaySummary(article) {
    return translateEnabled && article.summaryKo ? article.summaryKo : article.summary;
  }

  function renderNewsCard(article) {
    const card = document.createElement("div");
    card.className = "news-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.addEventListener("click", () => openArticleModal(article));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openArticleModal(article);
      }
    });

    const tone = CATEGORY_TONES[article.category] || "#eee";
    const icon = CATEGORY_ICONS[article.category] || "📰";
    const dateStr = formatPubDate(article.pubDate);

    const img = article.image
      ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" onerror="this.remove()" />`
      : "";

    const foreignBadge = article.isForeign ? '<span class="lang-badge">EN</span>' : "";

    card.innerHTML = `
      <div class="news-card-meta">
        <span>${escapeHtml(dateStr || "")}</span>
        <span>${foreignBadge}${escapeHtml(article.siteName)}</span>
      </div>
      <div class="news-card-photo" style="background:${tone}">${img}<span class="news-card-icon">${icon}</span></div>
      <h3 class="news-card-title">${escapeHtml(getDisplayTitle(article))}</h3>
      <div class="news-card-footer">
        <span>${escapeHtml(article.subcategory || "")}</span>
        <span class="news-card-link">자세히 보기 →</span>
      </div>
    `;
    return card;
  }

  function openArticleModal(article) {
    document.getElementById("modal-date").textContent = formatPubDate(article.pubDate) || "";
    document.getElementById("modal-source").textContent = article.siteName;

    document.getElementById("modal-keywords").innerHTML = (article.keywords || [])
      .map((k) => `<span class="keyword-chip">#${escapeHtml(k)}</span>`)
      .join("");

    const imgWrap = document.getElementById("modal-image-wrap");
    imgWrap.innerHTML = article.image
      ? `<img src="${escapeHtml(article.image)}" alt="" onerror="this.parentElement.innerHTML=''" />`
      : "";

    document.getElementById("modal-title").textContent = getDisplayTitle(article);

    const summaryText = getDisplaySummary(article);
    document.getElementById("modal-summary").textContent =
      summaryText && summaryText.trim()
        ? summaryText
        : "이 기사는 요약 정보를 제공하지 않습니다. 아래 원문 링크에서 전체 내용을 확인해주세요.";

    document.getElementById("modal-link").href = article.link;

    document.getElementById("article-modal").hidden = false;
  }

  function closeArticleModal() {
    document.getElementById("article-modal").hidden = true;
  }

  function setupModal() {
    const overlay = document.getElementById("article-modal");
    document.getElementById("modal-close").addEventListener("click", closeArticleModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeArticleModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) closeArticleModal();
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

  function render() {
    const tree = buildTree(getAllSites());
    updateCategoryOptions(tree);

    document.querySelectorAll(".category-nav-btn[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === activeView);
    });
    const panelOpen = !document.getElementById("add-form-panel").hidden;
    const showFeedExtras = activeView === "feed" && !panelOpen;

    const categorySidebar = document.getElementById("category-sidebar");
    categorySidebar.hidden = !showFeedExtras;
    if (showFeedExtras) renderCategorySidebar(tree);

    const rightColumn = document.getElementById("right-column");
    rightColumn.hidden = !showFeedExtras;
    if (showFeedExtras) {
      renderCalendar();
      renderTrendingKeywords();
    }

    if (activeView === "feed") {
      renderFeedView();
    } else {
      renderSitesView(tree);
    }
  }

  function setupAddForm() {
    const panel = document.getElementById("add-form-panel");
    const toggle = () => {
      panel.hidden = !panel.hidden;
      render();
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
    document.querySelectorAll(".category-nav-btn[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeView = btn.dataset.view;
        if (activeView !== "feed") selectedCategory = ALL_CATEGORY;
        render();
      });
    });

    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value.trim();
      render();
    });

    document.getElementById("translate-toggle").addEventListener("change", (e) => {
      translateEnabled = e.target.checked;
      render();
    });
  }

  async function init() {
    setupAddForm();
    setupToolbar();
    setupModal();
    setupCalendar();
    setupTrending();

    if (location.protocol === "file:") {
      document.getElementById("content-body").innerHTML =
        '<p class="empty">이 페이지는 파일을 직접 열면(file://) 브라우저 보안 정책 때문에 데이터를 불러올 수 없습니다.<br>' +
        "터미널에서 <code>npm run preview</code>를 실행한 뒤 http://localhost:8811 로 접속해주세요.</p>";
      return;
    }

    let sites, articles;
    try {
      [sites, articles] = await Promise.all([
        fetch("data/sites.json").then((r) => r.json()),
        fetch("data/articles-cache.json").then((r) => r.json()),
      ]);
    } catch (err) {
      document.getElementById("content-body").innerHTML =
        '<p class="empty">데이터를 불러오지 못했습니다: ' + escapeHtml(err.message) + "</p>";
      return;
    }
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
