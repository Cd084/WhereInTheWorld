// WhereInTheWorld data layer: settings, Tautulli client, GeoIP cache, posters, demo data and update check.
// Produces the "snapshot" object that app.js renders.
"use strict";
(function(){
const PM = window.PM = {};
const T = window.__TAURI__;
PM.isApp = !!(T && T.core);
PM.REPO = "Cd084/WhereInTheWorld";                     // GitHub repo checked for new releases

// ------------------------------------------------------------------ storage helpers
function load(key, fallback){ try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ------------------------------------------------------------------ settings
PM.DEFAULTS = {
  tautulli_url: "", tautulli_apikey: "", insecure_tls: false, poll_interval: 5,
  server_name: "", server_label: "", server_lat: null, server_lon: null,
  map_center_lon: 0, map_top_lat: 80,
  show_recent: true, history_hours: 24,
  time_format: "24h", hide_ip: false,
  scroll_speed: 35, ui_scale: 1, start_fullscreen: false,
  dim_from: "", dim_to: "",
  check_updates: true,
  demo: false,
};
PM.settings = Object.assign({}, PM.DEFAULTS, load("whereintheworld.settings", {}));
if (!PM.isApp || new URLSearchParams(location.search).has("demo")) PM.settings.demo = true;   // plain browser: demo only
PM.saveSettings = s => { PM.settings = Object.assign({}, PM.DEFAULTS, s); save("whereintheworld.settings", PM.settings); PM.reset(); };
PM.configured = () => PM.settings.demo || (PM.settings.tautulli_url && PM.settings.tautulli_apikey);

// ------------------------------------------------------------------ native HTTP (no CORS in the app)
async function httpText(url, insecure){
  if (!PM.isApp) throw new Error("Only available in the WhereInTheWorld app");
  return T.core.invoke("http_text", {url, insecure: !!insecure});
}
async function httpBytes(url, insecure){
  if (!PM.isApp) throw new Error("Only available in the WhereInTheWorld app");
  return T.core.invoke("http_bytes", {url, insecure: !!insecure});
}

// ------------------------------------------------------------------ Tautulli
function apiURL(s, cmd, params = {}){
  let base = (s.tautulli_url || "").trim().replace(/\/+$/, "");
  if (base && !/^https?:\/\//i.test(base)) base = "http://" + base;
  const u = new URL(base + "/api/v2");
  u.searchParams.set("apikey", (s.tautulli_apikey || "").trim());
  u.searchParams.set("cmd", cmd);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  return u.toString();
}
async function api(cmd, params = {}, s = PM.settings){
  const r = await httpText(apiURL(s, cmd, params), s.insecure_tls);
  let body = null;
  try { body = JSON.parse(r.body); } catch {}
  const resp = body && body.response;
  if (!resp){
    if (r.status === 404) throw new Error("Tautulli API not found at that address (HTTP 404) - check the URL");
    throw new Error(r.status >= 400 ? `HTTP ${r.status} - is this your Tautulli address?` : "That address didn't answer like Tautulli - check the URL");
  }
  if (resp.result !== "success") throw new Error(resp.message || `Tautulli ${cmd} failed`);
  return resp.data;
}
PM.api = api;

/** Used by Setup's "Test connection" button. */
PM.testConnection = async (s) => {
  const info = await api("get_tautulli_info", {}, s).catch(e => { throw e; });
  let server = "";
  try { server = await api("get_server_friendly_name", {}, s); } catch {}
  return {version: info && info.tautulli_version, server: typeof server === "string" ? server : ""};
};

// ------------------------------------------------------------------ helpers
const asInt = (v, d = 0) => { const n = parseInt(parseFloat(v), 10); return Number.isFinite(n) ? n : d; };
const truthy = v => ["1", "true", "yes"].includes(String(v).trim().toLowerCase());
const up = s => (s || "").toUpperCase();
const cap = s => { s = s || ""; return s.charAt(0).toUpperCase() + s.slice(1); };
const rate = kbps => { kbps = asInt(kbps); return kbps >= 1000 ? (kbps / 1000).toFixed(1) + " Mbps" : kbps + " kbps"; };
const decision = d => ({transcode: "Transcode", copy: "Direct Stream", "direct play": "Direct Play"})[(d || "").toLowerCase()] || cap(d);

function isPublicIP(ip){
  if (!ip) return false;
  ip = String(ip).trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m){
    const [a, b] = [+m[1], +m[2]];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (ip.includes(":")){
    if (ip === "::1" || ip === "::" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) return false;
    return true;
  }
  return false;
}
PM.isPublicIP = isPublicIP;

// ------------------------------------------------------------------ GeoIP cache (via Tautulli)
const GEO_OK = 14 * 86400e3, GEO_FAIL = 3600e3;
let geoCache = load("whereintheworld.geo", {}), geoDirty = false;
async function geo(ip){
  if (!isPublicIP(ip)) return null;
  const hit = geoCache[ip];
  if (hit && hit.exp > Date.now()) return hit.geo;
  let g = null;
  try {
    const d = await api("get_geoip_lookup", {ip_address: ip});
    if (d && d.latitude !== null && d.latitude !== undefined && d.latitude !== "")
      g = {lat: +d.latitude, lon: +d.longitude, city: d.city || "", region: d.region || "", country: d.country || "", code: d.code || ""};
  } catch {}
  geoCache[ip] = {geo: g, exp: Date.now() + (g ? GEO_OK : GEO_FAIL)};
  geoDirty = true;
  const keys = Object.keys(geoCache);
  if (keys.length > 3000) keys.sort((a, b) => geoCache[a].exp - geoCache[b].exp).slice(0, 600).forEach(k => delete geoCache[k]);
  return g;
}
function saveGeo(){ if (geoDirty){ save("whereintheworld.geo", geoCache); geoDirty = false; } }

/** Setup's "Detect" button: where is this network's public IP? */
PM.detectLocation = async (s) => {
  const r = await httpText("https://api.ipify.org?format=json", false);
  const ip = JSON.parse(r.body).ip;
  const d = await api("get_geoip_lookup", {ip_address: ip}, s);
  if (!d || d.latitude === undefined || d.latitude === null) throw new Error("Tautulli couldn't locate " + ip);
  return {lat: +d.latitude, lon: +d.longitude, label: [d.city, d.code].filter(Boolean).join(", ")};
};

// ------------------------------------------------------------------ images (fetched natively, shown as blob URLs)
const images = new Map();
PM.onImage = null;
function img(kind, src, rk){
  if (!src) return "";
  const key = kind + "|" + src + "|" + (rk || "");
  let e = images.get(key);
  if (e){ images.delete(key); images.set(key, e); return e.url; }       // keep recently used at the end
  e = {url: ""}; images.set(key, e);
  if (String(src).startsWith("demo:")){ e.url = demoPoster(src); return e.url; }
  const s = PM.settings;
  const url = kind === "avatar" ? src : apiURL(s, "pms_image_proxy", {
    img: src, rating_key: rk, width: 300, height: kind === "square" ? 300 : 450, fallback: kind === "square" ? "cover" : "poster"});
  httpBytes(url, kind !== "avatar" && s.insecure_tls).then(buf => {
    e.url = URL.createObjectURL(new Blob([buf]));
    if (PM.onImage) PM.onImage();
  }).catch(() => {});
  while (images.size > 150){
    const [k, old] = images.entries().next().value;
    if (old.url && old.url.startsWith("blob:")) URL.revokeObjectURL(old.url);
    images.delete(k);
  }
  return e.url;
}

// ------------------------------------------------------------------ session -> card data (mirrors Tautulli's activity card)
function formatSession(s, g){
  const mt = s.media_type || "";
  let poster, shape = "poster";
  if (mt === "episode") poster = img("poster", s.grandparent_thumb || s.thumb, s.grandparent_rating_key);
  else if (mt === "track"){ poster = img("square", s.parent_thumb || s.thumb, s.parent_rating_key); shape = "square"; }
  else poster = img("poster", s.thumb, s.rating_key);

  const tdec = (s.transcode_decision || "").toLowerCase();
  let stream = decision(tdec);
  if (tdec === "transcode" && truthy(s.transcode_throttled)) stream += " (Throttled)";
  else if (tdec === "transcode" && s.transcode_speed) stream += ` (Speed: ${s.transcode_speed})`;

  const cdec = (s.stream_container_decision || "").toLowerCase();
  const container = cdec === "transcode"
    ? `Converting (${up(s.container)} → ${up(s.stream_container)})`
    : `${decision(cdec || "direct play")} (${up(s.container)})`;

  let video = "";
  if (["movie", "episode", "clip"].includes(mt) || s.video_codec){
    const vdec = (s.video_decision || s.stream_video_decision || "").toLowerCase();
    const hwD = truthy(s.transcode_hw_decoding) ? " (HW)" : "", hwE = truthy(s.transcode_hw_encoding) ? " (HW)" : "";
    const src = `${up(s.video_codec)}${hwD} ${s.video_full_resolution || ""}`.trim();
    if (vdec === "transcode") video = `Transcode (${src} → ${`${up(s.stream_video_codec)}${hwE} ${s.stream_video_full_resolution || ""}`.trim()})`;
    else if (vdec) video = `${decision(vdec)} (${src})`;
  }

  const adec = (s.audio_decision || s.stream_audio_decision || "").toLowerCase();
  let srcA = `${up(s.audio_codec)} ${cap(s.audio_channel_layout)}`.trim();
  if (s.audio_language) srcA = `${s.audio_language} - ${srcA}`;
  const audio = adec === "transcode"
    ? `Transcode (${srcA} → ${`${up(s.stream_audio_codec)} ${cap(s.stream_audio_channel_layout)}`.trim()})`
    : `${decision(adec || "direct play")} (${srcA})`;

  let subtitle = "None";
  if (truthy(s.subtitles) || s.subtitle_decision){
    const sdec = (s.subtitle_decision || "").toLowerCase();
    const what = [s.subtitle_language, up(s.subtitle_codec)].filter(Boolean).join(" - ");
    if (sdec === "transcode") subtitle = `Transcode (${what} → ${up(s.stream_subtitle_codec)})`;
    else if (sdec === "burn") subtitle = `Burn (${what})`;
    else subtitle = `${decision(sdec || "direct play")} (${what})`;
  }

  const qp = s.quality_profile || "";
  const quality = s.stream_bitrate ? `${qp} (${rate(s.stream_bitrate)})` : qp;
  const loc = (s.location || "").toLowerCase();
  const lan = loc === "lan" || truthy(s.local);

  let title, sub;
  if (mt === "episode"){ title = `${s.grandparent_title || ""} - ${s.title || ""}`; sub = `S${s.parent_media_index ?? "?"} · E${s.media_index ?? "?"}`; }
  else if (mt === "track"){ title = `${s.grandparent_title || ""} - ${s.title || ""}`; sub = s.parent_title || ""; }
  else if (mt === "movie"){ title = s.title || ""; sub = String(s.year || ""); }
  else { title = s.full_title || s.title || ""; sub = s.library_name || ""; }
  if (truthy(s.live)) sub = s.channel_call_sign || s.channel_title || "Live TV";

  return {
    key: String(s.session_key || s.session_id || s.rating_key + ":" + s.user),
    user: s.friendly_name || s.username || s.user || "Unknown",          // friendly_name = your Tautulli alias
    avatar: (s.user_thumb || "").startsWith("http") ? img("avatar", s.user_thumb) : "",
    state: s.state || "playing", media_type: mt, title, subtitle: sub, poster, poster_shape: shape,
    product: s.product || "", player: s.player || "", platform: s.platform || s.platform_name || "",
    quality, stream, transcode: tdec, container, video, audio, subtitle_line: subtitle,
    bandwidth: asInt(s.bandwidth), lan,
    location: lan ? "LAN" : (loc === "cellular" ? "Cellular" : "WAN"),
    ip: PM.settings.hide_ip ? "" : (s.ip_address || ""),
    secure: truthy(s.secure), relayed: truthy(s.relayed),
    view_offset: asInt(s.view_offset), duration: asInt(s.duration) || asInt(s.stream_duration),
    transcode_progress: asInt(s.transcode_progress), live: truthy(s.live), geo: g,
  };
}

// ------------------------------------------------------------------ polling
let state = {activity: null, recent: [], error: null, updated: 0}, lastHistory = 0, demo = null;
PM.reset = () => { state = {activity: null, recent: [], error: null, updated: 0}; lastHistory = 0; demo = null; };

async function recent(){
  const s = PM.settings, cutoff = Date.now() / 1000 - s.history_hours * 3600;
  let rows;
  if (s.demo) rows = demo.history();
  else {
    const d = await api("get_history", {length: 300, order_column: "date", order_dir: "desc"});
    rows = (d && d.data) || [];
  }
  const places = new Map();
  for (const r of rows){
    const when = asInt(r.date || r.started);
    if (when < cutoff) continue;
    let g;
    if (s.demo) g = r._geo;
    else { if ((r.location || "").toLowerCase() === "lan") continue; g = await geo(r.ip_address); }
    if (!g) continue;
    const k = g.lat.toFixed(1) + "," + g.lon.toFixed(1);
    const p = places.get(k) || {lat: g.lat, lon: g.lon, city: g.city, code: g.code, plays: 0, users: [], last: 0};
    p.plays++; p.last = Math.max(p.last, when);
    const u = r.friendly_name || r.user;
    if (u && !p.users.includes(u)) p.users.push(u);
    places.set(k, p);
  }
  return [...places.values()].sort((a, b) => b.last - a.last);
}

async function poll(){
  const s = PM.settings;
  if (s.demo && !demo) demo = new Demo();
  const act = s.demo ? demo.activity() : await api("get_activity");
  const sessions = [];
  for (const x of act.sessions || []){
    const lan = (x.location || "").toLowerCase() === "lan" || truthy(x.local);
    const ip = isPublicIP(x.ip_address_public) ? x.ip_address_public : x.ip_address;
    const g = s.demo ? x._geo : (lan ? null : await geo(ip));
    sessions.push(formatSession(x, g));
  }
  const activity = {
    stream_count: asInt(act.stream_count, sessions.length), transcodes: asInt(act.stream_count_transcode),
    total_bandwidth: asInt(act.total_bandwidth), wan_bandwidth: asInt(act.wan_bandwidth), lan_bandwidth: asInt(act.lan_bandwidth),
    sessions,
  };
  if (s.show_recent && Date.now() - lastHistory > 300e3){
    try { state.recent = await recent(); lastHistory = Date.now(); } catch (e) { console.warn("history", e); }
  }
  saveGeo();
  state.activity = activity; state.error = null; state.updated = Date.now() / 1000;
}

/** Poll Tautulli once and return everything the map needs. */
PM.snapshot = async () => {
  if (PM.configured()){
    try { await poll(); }
    catch (e){ state.error = "Can't reach Tautulli: " + (e && e.message || e); }
  }
  const s = PM.settings;
  const demoSrv = s.demo && s.server_lat == null;
  return {
    activity: state.activity, recent: state.recent, error: state.error, updated: state.updated, now: Date.now() / 1000,
    server: demoSrv ? {lat: 41.88, lon: -87.63, label: "Chicago, US", name: s.server_name || "Plex"}
                    : {lat: s.server_lat, lon: s.server_lon, label: s.server_label || "", name: s.server_name || "Plex"},
    config: {center_lon: +s.map_center_lon || 0, bounds: null, top_lat: +s.map_top_lat || 80, time_format: s.time_format,
             poll_interval: +s.poll_interval || 5, history_hours: +s.history_hours || 24, show_recent: !!s.show_recent},
  };
};

// ------------------------------------------------------------------ updates (GitHub releases)
PM.version = async () => { try { return PM.isApp ? await T.app.getVersion() : "dev"; } catch { return "?"; } };
const vparts = v => String(v).replace(/^v/i, "").split(/[.+-]/).map(n => parseInt(n, 10) || 0);
PM.newer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++){ if ((x[i]||0) !== (y[i]||0)) return (x[i]||0) > (y[i]||0); } return false; };
PM.platform = () => /Android/i.test(navigator.userAgent) ? "android" : /Windows/i.test(navigator.userAgent) ? "windows" : "linux";
/** Returns {version, url, notes} when a newer release exists, otherwise null. */
PM.checkUpdate = async () => {
  const r = await httpText(`https://api.github.com/repos/${PM.REPO}/releases/latest`, false);
  if (r.status === 404) return null;                  // no releases yet
  if (r.status !== 200) throw new Error("GitHub said HTTP " + r.status);
  const rel = JSON.parse(r.body), latest = (rel.tag_name || "").replace(/^v/i, ""), current = await PM.version();
  if (!latest || !PM.newer(latest, current)) return null;
  const assets = rel.assets || [], plat = PM.platform();
  const pick = (...exts) => { for (const e of exts){ const a = assets.find(a => a.name.toLowerCase().endsWith(e)); if (a) return a.browser_download_url; } };
  const url = (plat === "android" ? pick(".apk") : plat === "windows" ? pick("-setup.exe", ".msi") : pick(".deb", ".appimage")) || rel.html_url;
  return {version: latest, url, page: rel.html_url, notes: rel.body || ""};
};
PM.openUrl = (url) => { if (PM.isApp && T.opener) return T.opener.openUrl(url); window.open(url, "_blank"); };
PM.setFullscreen = async (on) => {
  if (!PM.isApp || !T.window) return;
  const w = T.window.getCurrentWindow();
  if (on === undefined) on = !(await w.isFullscreen());
  await w.setFullscreen(on);
};

// ------------------------------------------------------------------ demo data
class Demo {
  constructor(){ this.start = Date.now() / 1000; }
  static PEOPLE = [
    ["Jordan Blake", "Toronto", "CA", 43.65, -79.38, "Plex for Roku", "Roku Streambar", "Roku"],
    ["Anna Keller", "Berlin", "DE", 52.52, 13.40, "Plex for Android (TV)", "SHIELD Android TV", "Android"],
    ["Tom Rivera", "Austin", "US", 30.27, -97.74, "Plex Web", "Chrome", "Chrome"],
    ["Mia Chen", "Sydney", "AU", -33.87, 151.21, "Plex for iOS", "iPad", "iOS"],
    ["Liam O'Brien", "Dublin", "IE", 53.35, -6.26, "Plex for LG", "OLED65C2", "webOS"],
    ["Sofia Rossi", "Milan", "IT", 45.46, 9.19, "Plexamp", "Pixel 8", "Android"],
    ["Home", "", "", null, null, "Plex HTPC", "Living Room", "Windows"],
  ];
  static MEDIA = [
    ["episode", "Doc McStuffins", "Welcome to McStuffinsville", 4, 1, 1350000, "#7b3fa0"],
    ["movie", "", "Arrival", null, null, 6960000, "#2b4c6f"],
    ["episode", "The Expanse", "Leviathan Wakes", 1, 10, 2640000, "#203a2c"],
    ["movie", "", "Paddington 2", null, null, 6240000, "#8a3b2a"],
    ["episode", "Bluey", "Sleepytime", 2, 26, 420000, "#3a78b5"],
    ["track", "Daft Punk", "Instant Crush", null, null, 337000, "#555555"],
    ["movie", "", "Interstellar", null, null, 10140000, "#1d2433"],
  ];
  activity(){
    const t = Date.now() / 1000 - this.start;
    const fixed = parseInt(new URLSearchParams(location.search).get("streams"), 10);
    const n = fixed > 0 ? Math.min(7, fixed) : 1 + (3 + Math.floor(t / 40)) % 7;
    const sessions = [];
    for (let i = 0; i < n; i++){
      const w = Demo.PEOPLE[i], [kind, show, title, season, ep, dur, color] = Demo.MEDIA[i];
      const lan = w[3] === null, trans = ["transcode", "direct play", "copy"][i % 3];
      const st = i === 2 ? "paused" : (i === 4 && Math.floor(t) % 20 < 4 ? "buffering" : "playing");
      const thumb = `demo:${title}|${show}|${color}`;
      const x = {
        session_key: String(100 + i), media_type: kind, title, grandparent_title: kind === "episode" ? show : kind === "track" ? "Daft Punk" : "",
        parent_title: "Random Access Memories", parent_media_index: season, media_index: ep, year: 2016 + i,
        thumb, grandparent_thumb: thumb, parent_thumb: thumb, friendly_name: w[0], product: w[5], player: w[6], platform: w[7],
        quality_profile: trans === "transcode" ? "2 Mbps 720p" : "Original", stream_bitrate: trans === "transcode" ? 1900 : 8200 + i * 900,
        bandwidth: trans === "transcode" ? 2000 : 9000 + i * 1000, transcode_decision: trans, transcode_throttled: i === 0 ? 1 : 0,
        transcode_hw_decoding: 1, transcode_hw_encoding: 1, transcode_progress: 80, container: "mkv", stream_container: "mkv",
        stream_container_decision: trans === "transcode" ? "transcode" : "direct play", video_decision: trans, video_codec: "hevc",
        stream_video_codec: "hevc", video_full_resolution: "1080p", stream_video_full_resolution: trans === "transcode" ? "480p" : "1080p",
        audio_decision: trans, audio_language: "English", audio_codec: "aac", audio_channel_layout: "stereo", stream_audio_codec: "aac",
        stream_audio_channel_layout: "stereo", subtitle_decision: "", subtitles: 0, location: lan ? "lan" : "wan", local: lan ? 1 : 0,
        ip_address: lan ? "192.168.1.60" : `203.0.113.${10 + i}`, secure: 1, relayed: i === 3 ? 1 : 0, state: st,
        view_offset: Math.floor((dur * (0.15 + 0.1 * i) + (st === "playing" ? t * 1000 : 0)) % dur), duration: dur,
        _geo: lan ? null : {lat: w[3], lon: w[4], city: w[1], region: "", country: w[2], code: w[2]},
      };
      if (kind === "track") Object.assign(x, {video_codec: "", video_decision: "", audio_codec: "flac", quality_profile: "Original", container: "flac", stream_container: "flac"});
      sessions.push(x);
    }
    const sum = f => sessions.filter(f).reduce((a, x) => a + x.bandwidth, 0);
    return {stream_count: n, stream_count_transcode: sessions.filter(x => x.transcode_decision === "transcode").length,
            total_bandwidth: sum(() => true), wan_bandwidth: sum(x => x.location === "wan"), lan_bandwidth: sum(x => x.location === "lan"), sessions};
  }
  history(){
    const c = [["New York","US",40.71,-74.0],["Vancouver","CA",49.28,-123.12],["London","GB",51.5,-0.12],["Lisbon","PT",38.72,-9.14],
      ["Cape Town","ZA",-33.92,18.42],["Tokyo","JP",35.68,139.69],["São Paulo","BR",-23.55,-46.63],["Oslo","NO",59.91,10.75],["Denver","US",39.74,-104.99]];
    const now = Date.now() / 1000;
    return c.map((x, i) => ({date: now - 3600 * (i * 2 + 1), friendly_name: "User " + i, _geo: {lat: x[2], lon: x[3], city: x[0], code: x[1]}}));
  }
}

function demoPoster(ref){
  const [title, show, color] = (ref.slice(5).split("|").concat(["", "", "#333"])).slice(0, 3);
  const words = (show || title).split(/\s+/), lines = [];
  let cur = "";
  for (const w of words){ if ((cur + " " + w).trim().length > 11){ lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  lines.push(cur);
  const esc = x => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const text = lines.map((l, i) => `<text x="150" y="${200 + i * 46}" font-size="40" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/>${text}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg).replace(/'/g, "%27");
}
})();
