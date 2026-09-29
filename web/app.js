const FILTERS = [
  ["apps", "Apps", ["app.open", "app.close"], "seen"],
  ["focus", "Focus", ["app.focus"], "seen"],
  ["download", "Downloads", ["download"], "seen"],
  ["build", "Builds", ["build"], "signals"],
  ["cpu", "CPU", ["cpu.spike"], "signals"],
  ["mem", "Memory", ["mem.spike"], "signals"],
  ["crash", "Crashes", ["crash"], "signals"],
  ["pin", "Pins", ["error.user"], "signals"],
];

const KIND_LABEL = {
  "app.open": "Opened",
  "app.close": "Closed",
  "app.focus": "Focus",
  download: "Download",
  build: "Build",
  "cpu.spike": "CPU",
  "mem.spike": "Memory",
  crash: "Crash",
  "error.user": "Pin",
};

const KIND_TONE = {
  "app.open": "open",
  "app.close": "open",
  "app.focus": "focus",
  download: "download",
  build: "build",
  "cpu.spike": "cpu",
  "mem.spike": "mem",
  crash: "crash",
  "error.user": "pin",
};

const state = {
  token: localStorage.getItem("fr-token") || "",
  filters: new Set(),
  hours: 2,
  q: "",
  events: [],
  demo: false,
  paused: false,
  background: false,
};

const $ = (id) => document.getElementById(id);

function headers() {
  const h = { "Content-Type": "application/json" };
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (res.status === 401) {
    show("pair");
    throw new Error("pairing required");
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function show(id) {
  const el = $(id);
  el.hidden = false;
  el.classList.remove("hidden");
}

function hide(id) {
  const el = $(id);
  el.hidden = true;
  el.classList.add("hidden");
}

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtFull(ts) {
  return new Date(ts).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ago(ts) {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function selectedKinds() {
  const kinds = [];
  for (const [id, , list] of FILTERS) {
    if (state.filters.has(id)) kinds.push(...list);
  }
  return kinds;
}

function tone(kind) {
  return KIND_TONE[kind] || "download";
}

function label(kind) {
  return KIND_LABEL[kind] || kind;
}

function setStatus() {
  const eye = $("live");
  const text = $("status-label");
  eye.classList.toggle("live", !state.paused);
  eye.classList.toggle("paused", state.paused);
  if (state.paused) text.textContent = state.demo ? "Demo · paused" : "Paused";
  else text.textContent = state.demo ? "Demo reel" : "Listening";
}

function render() {
  const root = $("timeline");
  const count = $("count");
  const n = state.events.length;
  const windowLabel = state.hours === 2 ? "2 hours" : state.hours === 24 ? "24 hours" : "7 days";
  count.textContent = n === 1 ? `1 moment in the last ${windowLabel}` : `${n} moments in the last ${windowLabel}`;

  if (!n) {
    const filtered = state.q || state.filters.size;
    root.innerHTML = filtered
      ? `<div class="empty"><h2>Nothing in this slice.</h2><p>The window is quiet for that search. <button type="button" class="linkish" id="clear-filters">Show every kind</button></p></div>`
      : `<div class="empty"><h2>The sky is empty.</h2><p>Open an app, download a file, or pin the moment something feels wrong.</p></div>`;
    $("clear-filters")?.addEventListener("click", () => {
      state.filters.clear();
      state.q = "";
      $("q").value = "";
      chips();
      load().catch(() => {});
    });
    return;
  }

  const groups = [];
  for (const event of state.events) {
    const key = new Date(event.ts).toDateString();
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: dayLabel(event.ts), events: [] };
      groups.push(group);
    }
    group.events.push(event);
  }

  root.innerHTML = groups
    .map(
      (group) => `
      <section>
        <h2 class="day-label">${escapeHtml(group.label)}</h2>
        <ul class="day-list">
          ${group.events.map((e) => eventButton(e)).join("")}
        </ul>
      </section>`,
    )
    .join("");

  root.querySelectorAll(".event").forEach((btn) => {
    btn.addEventListener("click", () => openDetail(btn.dataset.id));
  });
}

function eventButton(e, extra = "") {
  return `
    <li>
      <button type="button" class="event ${extra}" data-id="${e.id}" data-tone="${tone(e.kind)}">
        <span class="when">${fmtClock(e.ts)}<span class="ago">${ago(e.ts)}</span></span>
        <span>
          <p class="title">${escapeHtml(e.title)}</p>
          ${e.pid ? `<p class="meta">pid ${e.pid}</p>` : ""}
        </span>
        <span class="kind">${escapeHtml(label(e.kind))}</span>
      </button>
    </li>`;
}

function detailFacts(event) {
  const rows = [
    ["When", fmtFull(event.ts)],
    ["Kind", label(event.kind)],
    ["Severity", event.severity],
  ];
  if (event.pid) rows.push(["Process", String(event.pid)]);
  const detail = event.detail || {};
  for (const [key, value] of Object.entries(detail)) {
    if (value == null || value === "") continue;
    rows.push([prettyKey(key), prettyValue(key, value)]);
  }
  return `<dl class="facts">${rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("")}</dl>`;
}

function prettyKey(key) {
  return key.replaceAll(/[A-Z]/g, (m) => ` ${m}`).replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function prettyValue(key, value) {
  if (key.toLowerCase().includes("workingset") && typeof value === "number") {
    const gb = value / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function load() {
  const to = Date.now();
  const from = to - state.hours * 3600 * 1000;
  const params = new URLSearchParams({ from: String(from), to: String(to), limit: "200" });
  if (state.q) params.set("q", state.q);
  for (const kind of selectedKinds()) params.append("kind", kind);
  const data = await api(`/api/events?${params}`);
  state.events = data.events;
  render();
}

async function openDetail(id) {
  const [{ event }, nearby] = await Promise.all([
    api(`/api/events/${id}`),
    api(`/api/events/${id}/nearby`),
  ]);
  const others = nearby.events.filter((e) => e.id !== event.id);
  $("detail-body").innerHTML = `
    <p class="eyebrow">${escapeHtml(label(event.kind))}</p>
    <h2 id="detail-title">${escapeHtml(event.title)}</h2>
    ${detailFacts(event)}
    <h2>Within two minutes</h2>
    ${
      others.length
        ? `<ul class="nearby">${others.map((e) => eventButton(e)).join("")}</ul>`
        : `<p class="hint">Nothing else landed in those two minutes.</p>`
    }`;
  show("detail");
  $("detail-body").querySelectorAll(".event").forEach((btn) => {
    btn.addEventListener("click", () => openDetail(btn.dataset.id));
  });
}

function chips(focusId) {
  const root = $("chips");
  const allOn = state.filters.size === 0;
  const cluster = (group, label) => {
    const buttons = FILTERS.filter((row) => row[3] === group)
      .map(
        ([id, name]) =>
          `<button type="button" class="chip ${state.filters.has(id) ? "on" : ""}" data-filter="${id}" aria-pressed="${state.filters.has(id)}">${name}</button>`,
      )
      .join("");
    return `<div class="chip-cluster" role="group" aria-label="${label}">${buttons}</div>`;
  };
  root.innerHTML = `
    <button type="button" class="chip chip-all ${allOn ? "on" : ""}" data-filter="" aria-pressed="${allOn}">All</button>
    <div class="chip-rail">
      ${cluster("seen", "What you did")}
      ${cluster("signals", "What strained the machine")}
    </div>`;
  const rail = root.querySelector(".chip-rail");
  rail.addEventListener(
    "wheel",
    (event) => {
      if (rail.scrollWidth <= rail.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      rail.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );
  root.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.filter;
      if (!id) state.filters.clear();
      else if (state.filters.has(id)) state.filters.delete(id);
      else state.filters.add(id);
      chips(id);
      load().catch(() => {});
    });
  });
  if (focusId && rail) {
    const target = root.querySelector(`[data-filter="${focusId}"]`);
    if (target) {
      const delta = target.getBoundingClientRect().left - rail.getBoundingClientRect().left;
      rail.scrollLeft += delta - 8;
    }
  }
}

let socketGen = 0;

function live() {
  const gen = ++socketGen;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = state.token ? `?token=${encodeURIComponent(state.token)}` : "";
  const ws = new WebSocket(`${proto}://${location.host}/ws${token}`);
  ws.onopen = () => {
    if (gen === socketGen) setStatus();
  };
  ws.onclose = () => {
    if (gen !== socketGen) return;
    $("live").classList.remove("live");
    if (!state.paused) $("status-label").textContent = "Reconnecting";
    setTimeout(live, 2500);
  };
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.type === "wipe") {
        state.events = [];
        render();
        return;
      }
      if (data.type === "event" && data.event) {
        const event = data.event;
        const kinds = selectedKinds();
        const matchesKind = kinds.length === 0 || kinds.includes(event.kind);
        const matchesQuery = !state.q || `${event.title} ${JSON.stringify(event.detail || {})}`.toLowerCase().includes(state.q.toLowerCase());
        if (matchesKind && matchesQuery) {
          state.events = [event, ...state.events.filter((e) => e.id !== event.id)];
          render();
        }
      }
    } catch {
      // ignore malformed frames
    }
  };
}

function paintRetention(value) {
  document.querySelectorAll("#retention-seg button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.retention === value);
  });
}

function paintPaused() {
  const btn = $("paused");
  btn.setAttribute("aria-pressed", String(state.paused));
  $("paused-label").textContent = state.paused ? "Paused" : "On";
  setStatus();
}

function paintBackground() {
  const btn = $("background");
  btn.setAttribute("aria-pressed", String(state.background));
  $("background-label").textContent = state.background ? "Included" : "Ignored";
}

$("q").addEventListener("input", debounce(() => {
  state.q = $("q").value.trim();
  load().catch(() => {});
}, 200));

document.querySelectorAll(".seg").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    state.hours = Number(btn.dataset.hours);
    load().catch(() => {});
  });
});

$("mark").addEventListener("click", () => {
  $("pin-error").textContent = "";
  $("note").value = "";
  show("composer");
  $("note").focus();
});

$("pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = $("note").value.trim() || "moment";
  $("pin-error").textContent = "";
  try {
    await api("/api/events", {
      method: "POST",
      body: JSON.stringify({ title: `Marked: ${note}`, note }),
    });
    hide("composer");
    await load();
  } catch (err) {
    $("pin-error").textContent = String(err.message || err);
  }
});

$("btn-settings").addEventListener("click", async () => {
  const [meta, config] = await Promise.all([api("/api/meta"), api("/api/config")]);
  state.demo = Boolean(meta.demo);
  state.paused = Boolean(config.paused);
  state.background = Boolean(config.includeBackground);
  $("meta-line").textContent = `${meta.host} · ${meta.count} events${meta.demo ? " · sample reel" : ""}`;
  paintRetention(config.retention);
  paintPaused();
  paintBackground();
  $("pair-line").textContent = meta.pairing?.code || "Shown on the PC only";
  $("wipe-confirm").hidden = true;
  $("wipe-confirm").classList.add("hidden");
  show("settings");
});

document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => hide(el.dataset.close));
});
$("close-settings").addEventListener("click", () => hide("settings"));
$("close-detail").addEventListener("click", () => hide("detail"));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const id of ["composer", "detail", "settings"]) {
    if (!$(id).hidden) hide(id);
  }
});

document.querySelectorAll("#retention-seg button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const retention = btn.dataset.retention;
    await api("/api/config", { method: "PUT", body: JSON.stringify({ retention }) });
    paintRetention(retention);
  });
});

$("paused").addEventListener("click", async () => {
  state.paused = !state.paused;
  await api(state.paused ? "/api/pause" : "/api/resume", { method: "POST" });
  paintPaused();
});

$("background").addEventListener("click", async () => {
  state.background = !state.background;
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ includeBackground: state.background }),
  });
  paintBackground();
});

$("btn-wipe").addEventListener("click", () => {
  $("wipe-confirm").hidden = false;
  $("wipe-confirm").classList.remove("hidden");
});
$("btn-wipe-yes").addEventListener("click", async () => {
  await api("/api/wipe", { method: "POST" });
  hide("settings");
  await load();
});
$("btn-pair").addEventListener("click", async () => {
  const data = await api("/api/pair/refresh", { method: "POST" });
  $("pair-line").textContent = data.code;
});
$("btn-export").addEventListener("click", async () => {
  const data = await api("/api/export?hours=24");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "flight-recorder-24h.json";
  a.click();
});

$("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("pair-error").textContent = "";
  try {
    const data = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: $("pair-code").value }),
    }).then((r) => r.json());
    if (!data.token) throw new Error(data.error || "Pairing failed");
    state.token = data.token;
    localStorage.setItem("fr-token", data.token);
    hide("pair");
    await boot();
  } catch (err) {
    $("pair-error").textContent = String(err.message || err);
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function boot() {
  try {
    const meta = await api("/api/meta");
    state.demo = Boolean(meta.demo);
    state.paused = Boolean(meta.paused);
    setStatus();
  } catch {
    show("pair");
    return;
  }
  chips();
  await load();
  live();
}

chips();
boot();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
