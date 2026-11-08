(() => {
  "use strict";
  const A = window.FollowerLensAudience;
  const PAGE_SIZE = 50;
  const $ = (id) => document.getElementById(id);
  let dataset = null;
  let customDomains = "";
  let analysis = null;
  let filtered = [];
  let page = 0;
  let busy = false;
  let loadSequence = 0;
  let reloadTimer = null;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function number(value) { return value === null || value === undefined ? "未知" : Number(value).toLocaleString("zh-CN"); }
  function date(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
  }
  function percentage(count, total) { return total ? (count / total * 100).toFixed(1) + "%" : "—"; }
  function error(message) { $("errorMessage").textContent = message || ""; $("errorMessage").hidden = !message; }
  function validHandle(value) {
    const handle = String(value || "").trim().replace(/^@/, "").toLowerCase();
    return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
  }
  async function rpc(action, extra) {
    const response = await chrome.runtime.sendMessage(Object.assign({ type: "fl-audience", action }, extra));
    if (!response || !response.ok) throw new Error(response && response.error || "操作未完成，请重新打开扩展后再试。");
    return response.dataset || null;
  }
  function buttons() {
    $("startCapture").disabled = busy;
    $("ownerHandle").disabled = busy;
    $("pauseCapture").disabled = busy || !dataset || !dataset.active;
    $("clearData").disabled = busy || !dataset || !dataset.ownerHandle;
    $("exportCsv").disabled = !filtered.length;
    $("startCapture").textContent = dataset && dataset.active ? "打开关注者页" : dataset && dataset.ownerHandle ? "继续记录" : "开始记录";
  }
  function renderStatus() {
    const count = dataset && dataset.records ? dataset.records.length : 0;
    const owner = dataset && dataset.ownerHandle;
    const labels = { idle: "尚未开始", recording: "正在记录浏览样本", paused: "已暂停记录", limit: "已达到本地保存上限", error: "记录遇到问题" };
    $("captureStatus").textContent = owner ? "@" + owner + " · " + (labels[dataset.status] || (dataset.active ? labels.recording : labels.paused)) + " · " + number(count) + " 个账号" : "尚未记录粉丝样本";
    $("statusDot").classList.toggle("active", !!(dataset && dataset.active));
    const meta = [];
    if (dataset && dataset.startedAt) meta.push("开始于 " + date(dataset.startedAt));
    if (dataset && dataset.updatedAt) meta.push("最近保存 " + date(dataset.updatedAt));
    if (dataset && dataset.pages) meta.push("已接收 " + number(dataset.pages) + " 页列表响应");
    if (dataset && dataset.error) meta.push(dataset.error);
    $("captureMeta").textContent = meta.join(" · ");
    buttons();
  }
  function bandOf(value) {
    if (value === null || value === undefined) return "unknown";
    return value < 100 ? "lt100" : value < 1000 ? "lt1k" : value < 10000 ? "lt10k" : value < 100000 ? "lt100k" : "gte100k";
  }
  function selectFilter(id, value) {
    $(id).value = value;
    page = 0;
    renderPeople();
    $("peopleTitle").scrollIntoView({ block: "start", behavior: "auto" });
  }
  function bars(targetId, rows, denominator, onClick) {
    const target = $(targetId);
    target.replaceChildren();
    if (!rows.length) { target.append(el("p", "暂无可识别的数据", "chart-empty")); return; }
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const item = el(onClick ? "button" : "div", null, "bar-item");
      if (onClick) { item.type = "button"; item.addEventListener("click", () => onClick(row)); }
      const caption = el("span", null, "bar-caption");
      caption.append(el("span", row.label || row.name, "bar-label"), el("span", number(row.count) + " · " + percentage(row.count, denominator), "bar-value"));
      const track = el("span", null, "bar-track");
      const fill = el("span", null, "bar-fill");
      fill.style.width = (denominator ? Math.min(100, Math.max(0, row.count / denominator * 100)) : 0) + "%";
      track.append(fill); item.append(caption, track); fragment.append(item);
    }
    target.append(fragment);
  }
  function renderOverview() {
    const hasData = analysis.total > 0;
    $("emptyState").hidden = hasData;
    $("report").hidden = !hasData;
    $("totalCount").textContent = number(analysis.total);
    $("knownRate").textContent = percentage(analysis.knownCount, analysis.total);
    $("knownCount").textContent = number(analysis.knownCount) + " 个已知 · " + number(analysis.unknownCount) + " 个未知";
    $("medianFollowers").textContent = analysis.medianFollowers === null ? "—" : number(analysis.medianFollowers);
    $("largeCount").textContent = number(analysis.profiles.filter((profile) => profile.followers !== null && profile.followers >= 10000).length);
    bars("bandsChart", analysis.bands, analysis.knownCount, (row) => selectFilter("bandFilter", row.key));
    bars("topicsChart", analysis.topics, analysis.total, (row) => selectFilter("topicFilter", row.key));
    bars("locationsChart", analysis.locations.slice(0, 8), analysis.total);
    $("unknownFollowers").textContent = "粉丝数未知：" + number(analysis.unknownCount) + " 个";
    $("unknownTopics").textContent = "未识别主题：" + number(analysis.unknownTopics) + " 个";
    $("unknownLocations").textContent = "未填写地区：" + number(analysis.unknownLocations) + " 个" + (analysis.locations.length > 8 ? " · 显示前 8 个地区" : "");
    const selected = $("topicFilter").value;
    $("topicFilter").replaceChildren(new Option("全部主题", "all"), new Option("未识别主题", "unknown"));
    for (const topic of analysis.topics) $("topicFilter").add(new Option(topic.name, topic.key));
    $("topicFilter").value = Array.from($("topicFilter").options).some((option) => option.value === selected) ? selected : "all";
  }
  function renderPeople() {
    if (!analysis) return;
    const query = $("search").value.trim().toLocaleLowerCase();
    const band = $("bandFilter").value;
    const topic = $("topicFilter").value;
    filtered = analysis.profiles.filter((profile) => {
      if (query && ![profile.name, profile.handle, profile.bio].some((value) => String(value || "").toLocaleLowerCase().includes(query))) return false;
      if (band !== "all" && bandOf(profile.followers) !== band) return false;
      if (topic === "unknown" && profile.domains.length) return false;
      if (topic !== "all" && topic !== "unknown" && !profile.domains.some((domain) => domain.key === topic)) return false;
      return true;
    });
    const direction = $("sortOrder").value === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (a.followers === null && b.followers !== null) return 1;
      if (a.followers !== null && b.followers === null) return -1;
      return ((a.followers || 0) - (b.followers || 0)) * direction || String(a.handle).localeCompare(String(b.handle));
    });
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    $("filterSummary").textContent = "符合条件 " + number(filtered.length) + " 个 / 全部样本 " + number(analysis.total) + " 个";
    $("peopleRows").replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const profile of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const row = el("tr");
      const account = el("td", null, "account-cell");
      account.append(el("span", profile.name || profile.handle, "account-name"));
      const handle = validHandle(profile.handle);
      const link = el(handle ? "a" : "span", "@" + profile.handle, "account-handle");
      if (handle) { link.href = "https://x.com/" + handle; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      account.append(link);
      if (profile.bio) {
        if (profile.bio.length > 90) {
          const details = el("details", null, "bio");
          details.append(el("summary", profile.bio.slice(0, 90) + "…"), el("p", profile.bio));
          account.append(details);
        } else account.append(el("p", profile.bio, "bio"));
      } else account.append(el("p", "未填写简介", "bio"));
      account.append(el("small", "记录于 " + date(profile.observedAt), "observed-at"));
      const topicCell = el("td");
      const topics = el("div", null, "topic-list");
      for (const domain of profile.domains) {
        const chip = el("button", domain.name, "topic-chip");
        chip.type = "button"; chip.title = "简介关键词匹配；点击筛选该主题";
        chip.addEventListener("click", () => selectFilter("topicFilter", domain.key));
        topics.append(chip);
      }
      topicCell.append(profile.domains.length ? topics : el("span", "未识别", "muted"));
      row.append(account, el("td", number(profile.followers), "number"), el("td", number(profile.following), "number"), topicCell, el("td", profile.location || "未填写", "location-cell"));
      fragment.append(row);
    }
    $("peopleRows").append(fragment);
    $("noMatches").hidden = !!filtered.length;
    $("pageInfo").textContent = "第 " + (page + 1) + " / " + pages + " 页 · 每页 " + PAGE_SIZE + " 个";
    $("previousPage").disabled = page === 0;
    $("nextPage").disabled = page + 1 >= pages;
    buttons();
  }
  function render() {
    const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
    analysis = A.analyze(records, customDomains);
    renderStatus(); renderOverview(); renderPeople();
  }
  async function reload() {
    if (busy) return;
    const sequence = ++loadSequence;
    try {
      const [nextDataset, settings] = await Promise.all([rpc("get"), chrome.storage.local.get("fl_settings")]);
      if (sequence !== loadSequence) return;
      dataset = nextDataset;
      customDomains = settings.fl_settings && settings.fl_settings.customDomains || "";
      if (!$("ownerHandle").value && dataset && dataset.ownerHandle) $("ownerHandle").value = dataset.ownerHandle;
      render();
    } catch (e) { if (sequence === loadSequence) error("无法读取报告：" + e.message); }
  }
  async function action(task) {
    if (busy) return;
    busy = true; loadSequence++; error(""); buttons();
    try { await task(); }
    catch (e) { error(e.message || "操作失败，请重试。"); }
    finally { busy = false; buttons(); reload(); }
  }
  $("captureForm").addEventListener("submit", (event) => {
    event.preventDefault();
    action(async () => {
      const ownerHandle = validHandle($("ownerHandle").value);
      if (!ownerHandle) throw new Error("请输入有效的 X 用户名（1–15 个英文字母、数字或下划线）。");
      if (dataset && dataset.ownerHandle && dataset.ownerHandle !== ownerHandle) {
        if (!window.confirm("切换账号会清除 @" + dataset.ownerHandle + " 的本地粉丝样本。需要保留时请先导出。继续切换吗？")) return;
        dataset = await rpc("clear");
      }
      dataset = await rpc("start", { ownerHandle });
      $("ownerHandle").value = ownerHandle;
      render();
      try { await chrome.tabs.create({ url: "https://x.com/" + ownerHandle + "/followers" }); }
      catch (_) { throw new Error("记录已开启，但未能打开 X。请手动打开 https://x.com/" + ownerHandle + "/followers 并刷新后浏览。"); }
    });
  });
  $("pauseCapture").addEventListener("click", () => action(async () => { dataset = await rpc("pause"); render(); }));
  $("clearData").addEventListener("click", () => action(async () => {
    if (!window.confirm("清除本报告的所有粉丝样本并停止记录？此操作不会删除原有粉丝数历史或设置。需要保留时请先导出。")) return;
    dataset = await rpc("clear"); page = 0; render();
  }));
  $("search").addEventListener("input", () => { page = 0; renderPeople(); });
  for (const id of ["bandFilter", "topicFilter", "sortOrder"]) $(id).addEventListener("change", () => { page = 0; renderPeople(); });
  $("unknownFollowers").addEventListener("click", () => selectFilter("bandFilter", "unknown"));
  $("unknownTopics").addEventListener("click", () => selectFilter("topicFilter", "unknown"));
  $("resetFilters").addEventListener("click", () => {
    $("search").value = ""; $("bandFilter").value = "all"; $("topicFilter").value = "all"; $("sortOrder").value = "desc"; page = 0; renderPeople();
  });
  $("previousPage").addEventListener("click", () => { page--; renderPeople(); });
  $("nextPage").addEventListener("click", () => { page++; renderPeople(); });
  $("exportCsv").addEventListener("click", () => {
    if (!filtered.length) return;
    try {
      const blob = new Blob(["\uFEFF", A.toCSV(filtered, customDomains)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = el("a");
      link.href = url;
      link.download = "follower-lens-" + (validHandle(dataset && dataset.ownerHandle) || "sample") + "-sample-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { error("导出失败：" + e.message); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.fl_audience) return;
    clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 250);
  });
  window.addEventListener("focus", reload);
  reload();
})();
