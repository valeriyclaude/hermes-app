// Hermes OS · мини-апп: канбан задач + входящие из PLAUD.
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

  // ── авторизация: initData из Telegram или dev-ключ ────────────────────────
  // Ключ из ?key= сразу прячем в localStorage и вычищаем из адресной строки,
  // чтобы он не оседал в истории браузера и логах туннеля.
  const params = new URLSearchParams(location.search);
  let DEV_KEY = params.get("key") || "";
  try {
    if (DEV_KEY) {
      localStorage.setItem("hermesos_key", DEV_KEY);
      params.delete("key");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : ""));
    } else {
      DEV_KEY = localStorage.getItem("hermesos_key") || "";
    }
  } catch (e) {}

  // База API. Фронт живёт на GitHub Pages (стабильный адрес для кнопки бота),
  // backend — на Mac mini за туннелем, чей адрес меняется. Свежий адрес приходит
  // в ?api= (кнопку обновляет tunnel_manager при каждом переподключении);
  // запасной путь — localStorage от прошлого визита.
  let API_BASE = params.get("api") || "";
  try {
    if (API_BASE) localStorage.setItem("hermesos_api", API_BASE);
    else if (!location.hostname.startsWith("127.") && location.hostname !== "localhost")
      API_BASE = localStorage.getItem("hermesos_api") || "";
  } catch (e) {}
  API_BASE = API_BASE.replace(/\/+$/, "");

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    const initData = tg && tg.initData;
    if (initData) h["X-Telegram-Init-Data"] = initData;
    else if (DEV_KEY) h["X-Dev-Key"] = DEV_KEY;
    return h;
  }

  async function api(path, opts) {
    const res = await fetch(API_BASE + path, Object.assign({ headers: authHeaders() }, opts));
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) toast("⛔ Нет доступа (открой из Telegram)");
    return { ok: res.ok, status: res.status, data };
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  // ── сферы: цветовые классы ────────────────────────────────────────────────
  const SPHERES = ["Работа-Карьера", "Финансы", "Здоровье", "Отношения", "Рост-Обучение",
                   "Проекты", "Идеи-Заметки", "Путешествия", "Хобби-Творчество"];
  function sphereClass(t) {
    if (t.category === "project") return "sph-project";
    const i = SPHERES.findIndex((s) => t.sphere && (t.sphere.includes(s) || s.includes(t.sphere)));
    return i >= 0 ? `sph-${i + 1}` : "sph-0";
  }

  // ── вкладки ───────────────────────────────────────────────────────────────
  let ACTIVE_TAB = "pult";
  document.querySelectorAll(".bnav .tab").forEach((b) => b.addEventListener("click", () => {
    ACTIVE_TAB = b.dataset.tab;
    document.querySelectorAll(".bnav .tab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tabpane").forEach((p) => p.classList.add("hidden"));
    $("tab-" + ACTIVE_TAB).classList.remove("hidden");
    if (ACTIVE_TAB === "pult") loadControl();
    if (ACTIVE_TAB === "agents") loadAgents();
    if (ACTIVE_TAB === "modules") { loadModules(); loadCalendar(); }
  }));

  // ══ ПУЛЬТ ═════════════════════════════════════════════════════════════════
  function fmtTs(iso) {
    return iso ? String(iso).slice(11, 16) : "";
  }

  async function loadControl() {
    const [st, fd] = await Promise.all([api("/api/control/status"), api("/api/control/feed?limit=40")]);
    const s = st.data || {};
    $("host-led").classList.toggle("off", !s.gateway);
    $("host-status").textContent = `mac-mini · ${s.gateway ? "онлайн" : "гейтвей лежит"}` +
      (s.credits_ok === false ? " · без кредитов" : "");
    const nw = $("now-working");
    if (s.running && s.running.length) {
      nw.innerHTML = s.running.map((r) => `<div class="now-card">
        <div class="now-title">${esc(r.title)}</div>
        <div class="now-meta"><span>исполнитель: ${esc(r.assignee || "default")}</span>
        <span>с ${esc(fmtTs(r.since))}</span></div>
        <div class="progress"><div></div></div></div>`).join("");
    } else {
      nw.innerHTML = `<div class="muted">агенты отдыхают — очередь пуста</div>`;
    }
    $("queue").innerHTML = (s.queue && s.queue.length)
      ? s.queue.map((q, i) => `<div class="queue-item"><span class="queue-n">${i + 1}</span><span>${esc(q.title)}</span></div>`).join("")
      : `<div class="muted">пусто</div>`;
    const feed = (fd.data && fd.data.feed) || [];
    $("pulse").innerHTML = feed.length ? feed.map((ev) => `
      <div class="pulse-item ${ev.ok === false ? "err" : ""}">
        <span class="pulse-dot" style="color:${esc(ev.agent_color)};background:${esc(ev.agent_color)}"></span>
        <div class="pulse-body">
          <div class="pulse-action"><span class="who">${esc(ev.agent_name)}:</span> ${esc(ev.action)}</div>
          <div class="pulse-ts">${esc(String(ev.ts || "").replace("T", " ").slice(0, 16))}</div>
        </div>
      </div>`).join("") : `<div class="muted">событий пока нет</div>`;
  }

  // ══ АГЕНТЫ ════════════════════════════════════════════════════════════════
  async function loadAgents() {
    const { data } = await api("/api/control/agents");
    const list = (data && data.agents) || [];
    $("agents-list").innerHTML = list.map((a) => `
      <div class="agent-card">
        <div class="agent-head">
          <span class="agent-dot" style="color:${esc(a.color)};background:${esc(a.color)};${a.enabled ? "" : "opacity:.35;box-shadow:none"}"></span>
          <span class="agent-name">${esc(a.name)}</span>
          <span class="tag conf">${a.enabled ? "активен" : "спит"}</span>
        </div>
        <div class="agent-role">${esc(a.role)}</div>
        <div class="agent-last">${a.last ? esc(String(a.last.ts).replace("T", " ").slice(0, 16) + " · " + a.last.action) : "ещё не действовал"}</div>
        <div class="agent-actions">
          ${a.modules.map((m) => m.runnable
            ? `<button class="btn ghost" data-runmod="${esc(m.id)}">▶ ${esc(m.name)}</button>`
            : `<span class="tag sphere">${esc(m.name)} (заготовка)</span>`).join("")}
        </div>
      </div>`).join("") || `<div class="muted" style="padding:14px">нет агентов</div>`;
  }

  // ══ МОДУЛИ ════════════════════════════════════════════════════════════════
  async function loadModules() {
    const { data } = await api("/api/modules");
    const list = (data && data.modules) || [];
    $("modules-list").innerHTML = list.map((m) => `
      <div class="module-row ${m.enabled ? "" : "dim"}">
        <div class="module-head">
          <span class="agent-dot" style="color:${esc(m.agent_color)};background:${esc(m.agent_color)}"></span>
          <span class="module-name">${esc(m.name)}</span>
          <span class="sched-chip">${esc(m.schedule_human)}</span>
          <label class="switch"><input type="checkbox" data-modtoggle="${esc(m.id)}" ${m.enabled ? "checked" : ""}><i></i></label>
        </div>
        <div class="module-desc">${esc(m.description)}</div>
        <div class="module-meta">${m.stub ? "заготовка — код ещё не написан" :
          `последний: ${m.last_run ? esc(String(m.last_run).replace("T", " ").slice(0, 16)) : "не запускался"}` +
          (m.next_run ? ` · следующий: ${esc(String(m.next_run).replace("T", " ").slice(0, 16))}` : "")}</div>
      </div>`).join("") || `<div class="muted" style="padding:14px">нет модулей</div>`;
  }

  // ══ КАНБАН ════════════════════════════════════════════════════════════════
  let TASKS = [];
  let FILTER = null; // null=все, "project"=проекты, иначе имя сферы

  function taskCard(t) {
    const chip = t.category === "project"
      ? `<span class="tag proj">📦 ${esc(t.project || "проект")}</span>`
      : (t.sphere ? `<span class="tag sphere">${esc(t.sphere)}</span>` : "");
    const src = { plaud: "🎙", hermes: "🤖", claude_code: "💻" }[t.source] || "";
    const due = t.due ? `<span class="tag due">⏰ ${esc(fmtDate(t.due))}</span>` : "";
    const agent = t.hermes_ref ? `<span class="tag proj">🤖 ${esc(t.hermes_status || "у Hermes")}</span>` : "";
    let actions = "";
    if (t.readonly)
      actions = ""; // зеркало карточки агента — управляется из TG-чата с Hermes
    else if (t.status === "todo")
      actions = `<button class="btn primary" data-tact="move" data-to="in_progress" data-id="${t.id}">▶ В работу</button>
                 <button class="btn accent" data-tact="dispatch" data-id="${t.id}" title="Отдать агенту">🤖</button>
                 <button class="btn ghost" data-tact="edit" data-id="${t.id}">✎</button>
                 <button class="btn ghost" data-tact="move" data-to="archived" data-id="${t.id}">🗑</button>`;
    else if (t.status === "in_progress")
      actions = `<button class="btn primary" data-tact="move" data-to="done" data-id="${t.id}">✓ Готово</button>
                 <button class="btn ghost" data-tact="move" data-to="todo" data-id="${t.id}">⟵</button>
                 <button class="btn ghost" data-tact="edit" data-id="${t.id}">✎</button>`;
    else if (t.status === "done")
      actions = `<button class="btn ghost" data-tact="move" data-to="in_progress" data-id="${t.id}">⟵ Вернуть</button>
                 <button class="btn ghost" data-tact="move" data-to="archived" data-id="${t.id}">🗑</button>`;
    return `<div class="card ${sphereClass(t)}">
      <div class="type-row">${chip}${agent}${due}<span class="tag conf">${src}</span></div>
      <div class="title">${esc(t.title)}</div>
      ${t.description ? `<div class="summary">${esc(t.description)}</div>` : ""}
      ${t.agent_brief ? `<div class="detail"><span class="lbl">Бриф для Hermes:</span>\n${esc(t.agent_brief)}</div>` : ""}
      <div class="actions">${actions}</div>
    </div>`;
  }

  function renderFilters() {
    const present = new Set(TASKS.filter((t) => t.category !== "project" && t.sphere).map((t) => t.sphere));
    let html = `<button class="chip ${FILTER === null ? "on" : ""}" data-f="">Все</button>`;
    if (TASKS.some((t) => t.category === "project"))
      html += `<button class="chip proj ${FILTER === "project" ? "on" : ""}" data-f="project">📦 Проекты</button>`;
    for (const s of SPHERES) if (present.has(s))
      html += `<button class="chip ${FILTER === s ? "on" : ""}" data-f="${esc(s)}">${esc(s)}</button>`;
    $("filters").innerHTML = html;
  }

  function renderBoard() {
    renderFilters();
    const vis = TASKS.filter((t) =>
      FILTER === null ? true : FILTER === "project" ? t.category === "project" : t.sphere === FILTER);
    for (const [st, col, cnt] of [["todo", "col-todo", "cnt-todo"],
                                  ["in_progress", "col-inprogress", "cnt-inprogress"],
                                  ["done", "col-done", "cnt-done"]]) {
      const list = vis.filter((t) => t.status === st);
      $(col).innerHTML = list.length ? list.map(taskCard).join("") : `<div class="muted">пусто</div>`;
      $(cnt).textContent = list.length;
    }
  }

  async function loadTasks() {
    const { data } = await api("/api/tasks?status=active");
    TASKS = (data && data.tasks) || [];
    renderBoard();
  }

  // ══ ВХОДЯЩИЕ (proposals) ══════════════════════════════════════════════════
  const TYPE_LABEL = { note: "Заметка", message: "Сообщение", calendar_event: "Событие", task: "Задача" };
  const EXEC_LABEL = { note: "📝 В Obsidian", message: "✉️ Отправить", calendar_event: "📅 В календарь" };

  function detailHtml(p) {
    const t = p.type, pl = p.payload || {};
    if (t === "note") return `<span class="lbl">Сфера:</span> ${esc(pl.sphere || "—")}\n\n${esc(pl.content || "")}`;
    if (t === "message") return `<span class="lbl">Кому:</span> ${esc(pl.recipient || "—")}\n<span class="lbl">Текст:</span>\n${esc(pl.text || "")}`;
    if (t === "calendar_event") return `<span class="lbl">Когда:</span> ${esc(fmtDate(pl.start) || "—")}${pl.end ? " – " + esc(fmtDate(pl.end)) : ""}\n${esc(pl.description || "")}`;
    return `${esc(pl.text || "")}${pl.datetime ? "\n<span class=\"lbl\">Срок:</span> " + esc(fmtDate(pl.datetime)) : ""}`;
  }

  function proposalCard(p) {
    const conf = p.confidence != null ? `<span class="tag conf">${Math.round(p.confidence * 100)}%</span>` : "";
    const sphere = p.sphere ? `<span class="tag sphere">${esc(p.sphere)}</span>` : "";
    let statusLine = "";
    const er = p.execution_result;
    if (er && er.ok === false) statusLine = `<div class="err">⚠ ${esc(er.message || er.error || "ошибка")}</div>`;
    let actions = "";
    if (p.status === "pending" || p.status === "edited") {
      const execBtn = p.type !== "task"
        ? `<button class="btn primary" data-act="accept" data-id="${p.id}">${EXEC_LABEL[p.type] || "Исполнить"}</button>` : "";
      actions = `${execBtn}
        <button class="btn accent" data-act="totask" data-id="${p.id}">📋 В задачи</button>
        <button class="btn ghost" data-act="edit" data-id="${p.id}">✎</button>
        <button class="btn danger" data-act="reject" data-id="${p.id}">✕</button>`;
    } else if (p.status === "rejected") {
      actions = `<button class="btn ghost" data-act="restore" data-id="${p.id}">Вернуть</button>`;
    }
    return `<div class="card">
      <div class="type-row"><span class="tag ${TYPE_LABEL[p.type] ? p.type : ""}">${esc(TYPE_LABEL[p.type] || p.type)}</span>${sphere}${conf}</div>
      <div class="title">${esc(p.title || "")}</div>
      ${p.summary ? `<div class="summary">${esc(p.summary)}</div>` : ""}
      <div class="detail">${detailHtml(p)}</div>
      ${statusLine}
      <div class="actions">${actions}</div>
    </div>`;
  }

  let PROPOSALS = [];
  async function loadInbox() {
    const [p1, p2, p3] = await Promise.all([
      api("/api/proposals?status=pending"), api("/api/proposals?status=edited"),
      api("/api/proposals?status=rejected"),
    ]);
    const pending = [...((p2.data && p2.data.proposals) || []), ...((p1.data && p1.data.proposals) || [])];
    PROPOSALS = pending.concat((p3.data && p3.data.proposals) || []);
    $("col-pending").innerHTML = pending.length ? pending.map(proposalCard).join("")
      : `<div class="muted">Входящих нет — надиктуй что-нибудь в PLAUD 🎙</div>`;
    $("cnt-inbox").textContent = pending.length;
    const rej = (p3.data && p3.data.proposals) || [];
    $("col-rejected").innerHTML = rej.length ? rej.map(proposalCard).join("") : `<div class="muted">пусто</div>`;
  }

  // ══ ИНФО ══════════════════════════════════════════════════════════════════
  async function loadCalendar() {
    const { data } = await api("/api/calendar?max=8");
    const el = $("cal-list");
    if (!data || !data.ok) { el.innerHTML = `<div class="muted">календарь недоступен</div>`; return; }
    const ev = data.events || [];
    el.innerHTML = ev.length ? ev.map((e) => {
      const when = (e.start && (e.start.dateTime || e.start.date)) || e.start || "";
      return `<div class="cal-item"><div class="cal-when">${esc(fmtDate(when))}</div>
              <div class="cal-sum">${esc(e.summary || e.title || "(без названия)")}</div></div>`;
    }).join("") : `<div class="muted">нет ближайших событий</div>`;
  }

  // ══ модалка (редактирование proposal / создание-редактирование task) ══════
  let modalCtx = null;

  function sphereSelect(id, val) {
    return `<select id="${id}">` + `<option value="">— сфера —</option>` +
      SPHERES.map((s) => `<option ${val && (s === val || s.includes(val) || val.includes(s)) ? "selected" : ""}>${s}</option>`).join("") + `</select>`;
  }

  function openTaskModal(task) {
    modalCtx = { kind: "task", id: task ? task.id : null };
    $("modal-title").textContent = task ? "Изменить задачу" : "Новая задача";
    $("modal-fields").innerHTML =
      `<div class="field"><label>Название</label><input id="f-title" value="${esc(task ? task.title : "")}"></div>
       <div class="field"><label>Описание</label><textarea id="f-desc">${esc(task ? task.description || "" : "")}</textarea></div>
       <div class="field"><label>Сфера жизни</label>${sphereSelect("f-sphere", task ? task.sphere : "")}</div>
       <div class="field"><label>Это проект? (имя проекта, пусто = быт)</label>
         <input id="f-project" placeholder="dimx / inferno / hermes-os…" value="${esc(task ? task.project || "" : "")}"></div>
       <div class="field"><label>Срок (необязательно, ГГГГ-ММ-ДД или ISO)</label>
         <input id="f-due" value="${esc(task ? task.due || "" : "")}"></div>`;
    $("modal").classList.remove("hidden");
  }

  function openToTaskModal(p) {
    modalCtx = { kind: "totask", id: p.id };
    $("modal-title").textContent = "📋 В задачи";
    $("modal-fields").innerHTML =
      `<div class="muted" style="margin-bottom:10px">«${esc(p.title || "")}»</div>
       <div class="field"><label>Комментарий для Hermes — что сделать сразу (напоминалки, сообщение, календарь). Пусто — просто карточка в «Надо».</label>
       <textarea id="f-comment" placeholder="напр.: поставь напоминалку 25-го в 10:00, напиши Татьяне и предложи встречу, за 2 часа напомни обоим"></textarea></div>
       <label class="checkline"><input type="checkbox" id="f-dispatch"> 🤖 Отдать Hermes даже без комментария</label>`;
    $("modal").classList.remove("hidden");
  }

  function openDispatchModal(t) {
    modalCtx = { kind: "dispatch", id: t.id };
    $("modal-title").textContent = "🤖 Отдать Hermes";
    $("modal-fields").innerHTML =
      `<div class="muted" style="margin-bottom:10px">«${esc(t.title)}»</div>
       <div class="field"><label>Что сделать? (пусто — агент действует по описанию задачи)</label>
       <textarea id="f-comment"></textarea></div>`;
    $("modal").classList.remove("hidden");
  }

  const PFIELDS = {
    note: [["note_title", "Заголовок", "input"], ["sphere", "Сфера", "input"], ["content", "Текст заметки", "textarea"]],
    message: [["recipient", "Получатель (@username / телефон)", "input"], ["text", "Текст сообщения", "textarea"]],
    calendar_event: [["summary", "Название", "input"], ["start", "Начало (ISO8601)", "input"], ["end", "Конец (ISO8601)", "input"], ["description", "Описание", "textarea"]],
    task: [["text", "Описание задачи", "textarea"], ["datetime", "Срок (ISO8601)", "input"]],
  };

  function openProposalModal(p) {
    modalCtx = { kind: "proposal", id: p.id, type: p.type };
    $("modal-title").textContent = "Изменить предложение";
    let html = `<div class="field"><label>Заголовок карточки</label><input id="f-title" value="${esc(p.title || "")}"></div>`;
    for (const [key, label, kind] of (PFIELDS[p.type] || [])) {
      const val = key === "sphere" ? (p.sphere || (p.payload || {}).sphere || "") : ((p.payload || {})[key] || "");
      html += `<div class="field"><label>${esc(label)}</label>` +
        (kind === "textarea" ? `<textarea id="f-${key}">${esc(val)}</textarea>`
                             : `<input id="f-${key}" value="${esc(val)}">`) + `</div>`;
    }
    $("modal-fields").innerHTML = html;
    $("modal").classList.remove("hidden");
  }

  async function saveModal() {
    if (!modalCtx) return;
    if (modalCtx.kind === "totask") {
      const comment = $("f-comment").value.trim();
      const dispatch = $("f-dispatch").checked || !!comment;
      const { ok, data } = await api(`/api/proposals/${modalCtx.id}/to_task`,
        { method: "POST", body: JSON.stringify({ comment, dispatch }) });
      closeModal();
      if (!ok) { toast("⚠ не удалось"); return; }
      const d = data && data.dispatch;
      toast(d ? (d.ok ? "🤖 Hermes взял в работу" : "📋 В задачах, но Hermes недоступен: " + (d.error || "")) : "📋 Задача в канбане");
      await Promise.all([loadInbox(), loadTasks()]);
      return;
    }
    if (modalCtx.kind === "dispatch") {
      const comment = $("f-comment").value.trim();
      const { ok, data } = await api(`/api/tasks/${modalCtx.id}/dispatch`,
        { method: "POST", body: JSON.stringify({ comment }) });
      closeModal();
      toast(ok ? "🤖 Hermes взял в работу" : "⚠ " + ((data || {}).detail || (data || {}).error || "Hermes недоступен"));
      await loadTasks();
      return;
    }
    if (modalCtx.kind === "task") {
      const body = {
        title: $("f-title").value.trim(), description: $("f-desc").value,
        sphere: $("f-sphere").value || null, project: $("f-project").value.trim() || null,
        category: $("f-project").value.trim() ? "project" : "life",
        due: $("f-due").value.trim() || null,
      };
      if (!body.title) { toast("Нужно название"); return; }
      if (modalCtx.id) await api(`/api/tasks/${modalCtx.id}/edit`, { method: "POST", body: JSON.stringify(body) });
      else await api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
      closeModal(); toast("Сохранено"); await loadTasks();
    } else {
      const payload = {};
      for (const [key] of (PFIELDS[modalCtx.type] || [])) {
        const el = $("f-" + key);
        if (el) payload[key] = el.value;
      }
      const body = { title: $("f-title").value, payload };
      if (modalCtx.type === "note" && payload.sphere != null) body.sphere = payload.sphere;
      await api(`/api/proposals/${modalCtx.id}/edit`, { method: "POST", body: JSON.stringify(body) });
      closeModal(); toast("Сохранено"); await loadInbox();
    }
  }
  function closeModal() { $("modal").classList.add("hidden"); modalCtx = null; }

  // ══ обработчики ═══════════════════════════════════════════════════════════
  document.addEventListener("click", async (e) => {
    const run = e.target.closest("[data-runmod]");
    if (run) {
      const { ok, data } = await api(`/api/control/run/${run.dataset.runmod}`, { method: "POST" });
      toast(ok ? "▶ Запущено" : "⚠ " + ((data || {}).detail || "не удалось"));
      setTimeout(loadControl, 1500);
      return;
    }
    const chip = e.target.closest(".chip");
    if (chip) { FILTER = chip.dataset.f === "" ? null : chip.dataset.f; renderBoard(); return; }

    const tb = e.target.closest("[data-tact]");
    if (tb) {
      const id = parseInt(tb.dataset.id);
      if (tb.dataset.tact === "move") {
        await api(`/api/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ status: tb.dataset.to }) });
        await loadTasks();
      } else if (tb.dataset.tact === "edit") {
        openTaskModal(TASKS.find((t) => t.id === id));
      } else if (tb.dataset.tact === "dispatch") {
        openDispatchModal(TASKS.find((t) => t.id === id));
      }
      return;
    }

    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = parseInt(b.dataset.id), act = b.dataset.act;
    if (act === "accept") {
      const { ok, data } = await api(`/api/proposals/${id}/accept`, { method: "POST" });
      toast(ok ? "✓ Исполнено" : "⚠ " + (((data || {}).result || {}).message || (data || {}).detail || "не удалось"));
      await loadInbox();
    } else if (act === "totask") {
      openToTaskModal(PROPOSALS.find((x) => x.id === id));
    } else if (act === "reject") {
      await api(`/api/proposals/${id}/reject`, { method: "POST" });
      toast("Отклонено"); await loadInbox();
    } else if (act === "restore") {
      await api(`/api/proposals/${id}/restore`, { method: "POST" });
      toast("Возвращено"); await loadInbox();
    } else if (act === "edit") {
      openProposalModal(PROPOSALS.find((x) => x.id === id));
    }
  });

  document.addEventListener("change", async (e) => {
    const t = e.target.closest("[data-modtoggle]");
    if (!t) return;
    const { ok, data } = await api(`/api/modules/${t.dataset.modtoggle}/toggle`,
      { method: "POST", body: JSON.stringify({ enabled: t.checked }) });
    if (!ok) { t.checked = !t.checked; toast("⚠ " + ((data || {}).detail || "не удалось")); return; }
    toast(t.checked ? "Модуль включён" : "Модуль выключен");
    await loadModules();
  });

  $("add-task").addEventListener("click", () => openTaskModal(null));
  $("refresh").addEventListener("click", async () => { await loadAll(); toast("Обновлено"); });
  $("modal-cancel").addEventListener("click", closeModal);
  $("modal-save").addEventListener("click", saveModal);

  function loadAll() {
    const jobs = [loadTasks(), loadInbox(), loadControl()];
    if (ACTIVE_TAB === "agents") jobs.push(loadAgents());
    if (ACTIVE_TAB === "modules") jobs.push(loadModules(), loadCalendar());
    return Promise.all(jobs);
  }
  loadAll();
  setInterval(() => { if (ACTIVE_TAB === "pult" && !document.hidden) loadControl(); }, 12000);
})();
