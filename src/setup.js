// WhereInTheWorld Setup panel (all settings are stored on this device) and update notifications.
"use strict";
(function(){
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const FIELDS = [
  {section: "Tautulli", hint: "WhereInTheWorld gets everything from your Tautulli: activity, user aliases, locations and posters."},
  {key: "tautulli_url", label: "Tautulli address", type: "url", placeholder: "http://192.168.1.10:8181", wide: true},
  {key: "tautulli_apikey", label: "API key", type: "password", placeholder: "Tautulli → Settings → Web Interface → API key", wide: true},
  {key: "insecure_tls", label: "Accept a self-signed HTTPS certificate", type: "check", wide: true},
  {key: "poll_interval", label: "Refresh every (seconds)", type: "number", min: 2, max: 60, step: 1},
  {buttons: [["test", "Test connection"]], result: "test-result"},

  {section: "Your server", hint: "Where the arcs start. Use Detect, tap Pick on map, or type the coordinates."},
  {key: "server_name", label: "Name", type: "text", placeholder: "e.g. Home Server"},
  {key: "server_label", label: "Place label", type: "text", placeholder: "e.g. Chicago, US"},
  {key: "server_lat", label: "Latitude", type: "number", step: "any", placeholder: "41.8781"},
  {key: "server_lon", label: "Longitude", type: "number", step: "any", placeholder: "-87.6298"},
  {buttons: [["detect", "Detect from public IP"], ["pick", "Pick on map"]], result: "loc-result"},

  {section: "Map"},
  {key: "map_center_lon", label: "Centre longitude", type: "number", min: -180, max: 180, step: 1},
  {key: "map_top_lat", label: "Northern edge (latitude)", type: "number", min: 50, max: 85, step: 1},
  {key: "show_recent", label: "Show recent plays", type: "check"},
  {key: "history_hours", label: "Recent = last (hours)", type: "number", min: 1, max: 720, step: 1},

  {section: "Display"},
  {key: "time_format", label: "Clock", type: "select", options: [["24h", "24-hour"], ["12h", "12-hour"]]},
  {key: "ui_scale", label: "Text size", type: "select", options: [["0.8","Small"],["1","Normal"],["1.15","Large"],["1.3","Larger"],["1.5","Huge"]]},
  {key: "scroll_speed", label: "Card scroll speed (px/s)", type: "number", min: 5, max: 200, step: 5},
  {key: "hide_ip", label: "Hide IP addresses", type: "check"},
  {key: "start_fullscreen", label: "Start full screen (F11 toggles)", type: "check", desktop: true},
  {key: "dim_from", label: "Dim screen from", type: "time"},
  {key: "dim_to", label: "until", type: "time"},

  {section: "Updates"},
  {key: "check_updates", label: "Check GitHub for new versions", type: "check"},
  {buttons: [["update", "Check now"]], result: "update-result"},

  {section: "Demo"},
  {key: "demo", label: "Demo mode - show made-up streams instead of Tautulli", type: "check", wide: true},
];

// ------------------------------------------------------------------ build the panel
const panel = document.createElement("div");
panel.id = "setup";
panel.innerHTML = `<div class="sheet" role="dialog" aria-label="WhereInTheWorld settings">
  <div class="sh-head"><h2>Settings</h2><span class="ver" id="setup-ver"></span></div>
  <div class="welcome" id="setup-welcome">Welcome! Enter your Tautulli address and API key to get started, or turn on demo mode to look around.</div>
  <form id="setup-form" autocomplete="off"></form>
  <div class="sh-foot"><button type="button" class="ghost" id="setup-cancel">Cancel</button><button type="button" class="primary" id="setup-save">Save</button></div>
</div>`;
document.body.appendChild(panel);

const isMobile = PM.platform() === "android";
const form = $("setup-form");
let html = "", open = false;
for (const f of FIELDS){
  if (f.desktop && isMobile) continue;
  if (f.section){ html += `<h3>${esc(f.section)}</h3>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ""}`; continue; }
  if (f.buttons){
    html += `<div class="row wide btns">${f.buttons.map(([id, t]) => `<button type="button" id="btn-${id}">${esc(t)}</button>`).join("")}<span class="result" id="${f.result}"></span></div>`;
    continue;
  }
  const id = "f-" + f.key, cls = "row" + (f.wide ? " wide" : "");
  if (f.type === "check") html += `<label class="${cls} check"><input type="checkbox" id="${id}"><span>${esc(f.label)}</span></label>`;
  else if (f.type === "select") html += `<label class="${cls}"><span>${esc(f.label)}</span><select id="${id}">${f.options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>`;
  else {
    const attrs = ["min", "max", "step", "placeholder"].filter(a => f[a] !== undefined).map(a => `${a}="${esc(f[a])}"`).join(" ");
    const input = `<input id="${id}" type="${f.type}" ${attrs} spellcheck="false" autocapitalize="off">`;
    html += `<label class="${cls}"><span>${esc(f.label)}</span>${f.type === "password" ? `<span class="pw">${input}<button type="button" class="eye" data-for="${id}">Show</button></span>` : input}</label>`;
  }
}
form.innerHTML = html;
form.querySelectorAll(".eye").forEach(b => b.addEventListener("click", () => {
  const i = $(b.dataset.for); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Show" : "Hide";
}));

function fill(s){
  for (const f of FIELDS){
    if (!f.key) continue;
    const el = $("f-" + f.key); if (!el) continue;
    if (f.type === "check") el.checked = !!s[f.key];
    else el.value = s[f.key] === null || s[f.key] === undefined ? "" : String(s[f.key]);
  }
}
function read(){
  const s = Object.assign({}, PM.settings);
  for (const f of FIELDS){
    if (!f.key) continue;
    const el = $("f-" + f.key); if (!el) continue;
    if (f.type === "check") s[f.key] = el.checked;
    else if (f.type === "number"){
      const v = el.value.trim();
      s[f.key] = v === "" ? (["server_lat", "server_lon"].includes(f.key) ? null : PM.DEFAULTS[f.key]) : +v;
    } else s[f.key] = el.value.trim();
  }
  if (s.server_lat !== null && (s.server_lat < -90 || s.server_lat > 90)) throw new Error("Latitude must be between -90 and 90");
  if (s.server_lon !== null && (s.server_lon < -180 || s.server_lon > 180)) throw new Error("Longitude must be between -180 and 180");
  return s;
}
function result(id, msg, kind){ const el = $(id); el.textContent = msg; el.className = "result " + (kind || ""); }

PM.openSetup = () => {
  fill(PM.settings);
  $("setup-welcome").style.display = PM.configured() ? "none" : "block";
  ["test-result", "loc-result", "update-result"].forEach(id => result(id, ""));
  panel.classList.add("open"); open = true;
};
function close(){ panel.classList.remove("open"); open = false; }

$("setup-cancel").addEventListener("click", close);
$("setup-save").addEventListener("click", () => {
  let s;
  try { s = read(); } catch (e){ result("test-result", e.message, "bad"); return; }
  if (!s.demo && (!s.tautulli_url || !s.tautulli_apikey)){
    result("test-result", "Enter the Tautulli address and API key (or turn on demo mode).", "bad");
    $("f-tautulli_url").scrollIntoView({block: "center"}); return;
  }
  const fsChanged = s.start_fullscreen !== PM.settings.start_fullscreen;
  PM.saveSettings(s);
  if (fsChanged) PM.setFullscreen(!!s.start_fullscreen).catch(() => {});
  close();
  window.APP.refresh();
  scheduleUpdateCheck(5000);
});
addEventListener("keydown", e => { if (e.key === "Escape" && open) close(); });

$("btn-test").addEventListener("click", async () => {
  let s; try { s = read(); } catch (e){ return result("test-result", e.message, "bad"); }
  if (!s.tautulli_url || !s.tautulli_apikey) return result("test-result", "Enter the address and API key first.", "bad");
  result("test-result", "Connecting…");
  try {
    const r = await PM.testConnection(s);
    result("test-result", `Connected to Tautulli ${r.version || ""}${r.server ? " · Plex server: " + r.server : ""}`, "good");
    const name = $("f-server_name"); if (name && !name.value && r.server) name.value = r.server;
  } catch (e){ result("test-result", e.message || String(e), "bad"); }
});

$("btn-detect").addEventListener("click", async () => {
  let s; try { s = read(); } catch (e){ return result("loc-result", e.message, "bad"); }
  if (!s.tautulli_url || !s.tautulli_apikey) return result("loc-result", "Fill in Tautulli first - it does the lookup.", "bad");
  result("loc-result", "Looking up…");
  try {
    const g = await PM.detectLocation(s);
    $("f-server_lat").value = g.lat.toFixed(4); $("f-server_lon").value = g.lon.toFixed(4);
    if (!$("f-server_label").value) $("f-server_label").value = g.label;
    result("loc-result", "Found " + (g.label || "a location") + ". Fine-tune if your ISP places you elsewhere.", "good");
  } catch (e){ result("loc-result", e.message || String(e), "bad"); }
});

$("btn-pick").addEventListener("click", () => {
  panel.classList.remove("open");
  window.APP.banner("Tap your server's location on the map");
  window.onMapPick = ll => {
    window.APP.banner("");
    if (ll){ $("f-server_lat").value = ll[1].toFixed(4); $("f-server_lon").value = ll[0].toFixed(4); result("loc-result", "Location picked - press Save to keep it.", "good"); }
    panel.classList.add("open");
  };
});

$("btn-update").addEventListener("click", async () => {
  result("update-result", "Checking…");
  try {
    const u = await PM.checkUpdate();
    if (u){ result("update-result", `Version ${u.version} is available.`, "good"); showUpdate(u, true); }
    else result("update-result", "You have the latest version.", "good");
  } catch (e){ result("update-result", e.message || String(e), "bad"); }
});

// ------------------------------------------------------------------ gear button
const gear = document.createElement("button");
gear.id = "gear"; gear.title = "Settings"; gear.setAttribute("aria-label", "Settings");
gear.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3.3h-4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1-2 3.5L6.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>`;
gear.addEventListener("click", PM.openSetup);
document.querySelector("header").appendChild(gear);

PM.version().then(v => { $("setup-ver").textContent = "WhereInTheWorld " + v; });

// ------------------------------------------------------------------ update notice
const toast = document.createElement("div");
toast.id = "update";
document.body.appendChild(toast);
function showUpdate(u, force){
  let dismissed = ""; try { dismissed = localStorage.getItem("whereintheworld.dismissedUpdate") || ""; } catch {}
  if (!force && dismissed === u.version) return;
  toast.innerHTML = `<b>WhereInTheWorld ${esc(u.version)} is available</b><button class="primary" id="upd-get">Download</button><button class="ghost" id="upd-notes">What's new</button><button class="x" id="upd-x" aria-label="Dismiss">✕</button>`;
  toast.classList.add("show");
  $("upd-get").onclick = () => PM.openUrl(u.url);
  $("upd-notes").onclick = () => PM.openUrl(u.page);
  $("upd-x").onclick = () => { toast.classList.remove("show"); try { localStorage.setItem("whereintheworld.dismissedUpdate", u.version); } catch {} };
}
let updTimer = null;
function scheduleUpdateCheck(delay){
  clearTimeout(updTimer);
  if (!PM.isApp || !PM.settings.check_updates) return;
  updTimer = setTimeout(async () => {
    try { const u = await PM.checkUpdate(); if (u) showUpdate(u, false); } catch (e){ console.warn("update check", e); }
    scheduleUpdateCheck(6 * 3600e3);
  }, delay);
}
scheduleUpdateCheck(15000);

if (!PM.configured() || new URLSearchParams(location.search).has("setup")) setTimeout(PM.openSetup, 300);
})();
