"use strict";
const qs = new URLSearchParams(location.search);
if (qs.has("kiosk") || qs.has("nocursor")) document.body.classList.add("nocursor");

const PALETTE = ["#e5a00d","#3ec5f0","#ff6b8b","#8be36b","#b98bff","#ffd166","#45d4b0","#ff9f43","#f78fb3","#70a1ff","#c4e05a","#ff7a59"];
const PLAT = [
  ["roku","Roku","#662d91"],["plexamp","Plexamp","#cc7b19"],["android","Android","#2f8f55"],["shield","SHIELD","#5a8a00"],
  ["tvos","Apple TV","#4a4a4f"],["ios","iOS","#4a4a4f"],["iphone","iOS","#4a4a4f"],["ipad","iPad","#4a4a4f"],["macos","macOS","#4a4a4f"],["mac","macOS","#4a4a4f"],
  ["chromecast","Cast","#d84f2a"],["chrome","Chrome","#2f6fd6"],["firefox","Firefox","#e0582b"],["safari","Safari","#1e88e5"],["edge","Edge","#0a7cc4"],
  ["windows","Windows","#0a6fc2"],["linux","Linux","#3b3b3b"],["xbox","Xbox","#107c10"],["playstation","PlayStation","#003791"],
  ["tizen","Samsung","#1428a0"],["samsung","Samsung","#1428a0"],["webos","LG","#a50034"],["lg","LG","#a50034"],
  ["vizio","Vizio","#333"],["fire","Fire TV","#e47911"],["amazon","Fire TV","#e47911"],["kodi","Kodi","#17b2e7"],["web","Web","#444"]
];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mbps = kbps => kbps >= 1000 ? (kbps/1000).toFixed(1) + " Mbps" : (kbps||0) + " kbps";
function fmtDur(ms){ ms = Math.max(0, ms|0); const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}` : `${m}:${String(x).padStart(2,"0")}`; }
function fmtClock(d, cfg){ const h12 = (cfg?.time_format || "24h") === "12h";
  return d.toLocaleTimeString([], {hour: h12 ? "numeric" : "2-digit", minute:"2-digit", hour12: h12}); }
function initials(n){ return (n||"?").trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase(); }
function avatar(s, color){ return `<span class="av" style="--c:${color}">${esc(initials(s.user))}${s.avatar ? `<img src="${s.avatar}" onerror="this.remove()">` : ""}</span>`; }
function platform(s){ const hay = `${s.platform} ${s.product} ${s.player}`.toLowerCase();
  for (const [k,label,col] of PLAT) if (hay.includes(k)) return [label,col]; return [s.platform || "Plex", "#444"]; }
function chip(s){
  if (s.state === "buffering") return `<span class="chip bf">BUFFERING</span>`;
  if (s.state === "paused") return `<span class="chip ps">PAUSED</span>`;
  if (s.transcode === "transcode") return `<span class="chip tc">TRANSCODE</span>`;
  if (s.transcode === "copy") return `<span class="chip ds">DIRECT STREAM</span>`;
  return `<span class="chip dp">DIRECT PLAY</span>`;
}
function placeName(g){ return g ? [g.city, g.code || g.country].filter(Boolean).join(", ") : ""; }

// ---------------------------------------------------------------- state
let ST = null, polledAt = Date.now(), world = null, proj, geoPath;
let colors = new Map(), focusKey = null, focusTimer = null, lastLayoutKey = "";

function colorFor(key){
  if (colors.has(key)) return colors.get(key);
  const used = new Set(colors.values());
  const c = PALETTE.find(p => !used.has(p)) || PALETTE[colors.size % PALETTE.length];
  colors.set(key, c); return c;
}

// ---------------------------------------------------------------- projection
const mercY = lat => Math.log(Math.tan(Math.PI/4 + lat*Math.PI/360));
function setupProjection(){
  const W = innerWidth, H = innerHeight, c = ST?.config || {};
  proj = d3.geoMercator().rotate([-(c.center_lon||0), 0]).precision(.3);
  if (Array.isArray(c.bounds) && c.bounds.length === 2){
    const [[s,w],[n,e]] = c.bounds;
    const hdr = 70, bottom = Math.min(H*0.38, ($("cards").offsetHeight||0) + 20);
    proj.fitExtent([[40,hdr],[W-40,H-bottom]], {type:"MultiPoint", coordinates:[[w,s],[e,n],[w,n],[e,s]]});
  } else {
    const top = mercY(c.top_lat || 80);
    let k = W / (2*Math.PI);
    if (top - H/k < mercY(-72)) k = H / (top - mercY(-72));   // very tall screens
    proj.scale(k).translate([W/2, top*k]);
  }
  geoPath = d3.geoPath(proj);
}

function drawBase(){
  const svg = d3.select("#map");
  svg.attr("viewBox", null);   // plain CSS pixels, so SVG and the HTML labels always line up
  d3.select("#g-grat").selectAll("path").data([d3.geoGraticule().step([15,15])()]).join("path").attr("class","grat").attr("d", geoPath);
  const gl = d3.select("#g-land");
  gl.selectAll("path.land").data([world.land]).join("path").attr("class","land").attr("d", geoPath);
  gl.selectAll("path.borders").data([world.borders]).join("path").attr("class","borders").attr("d", geoPath);
  gl.selectAll("path.coast").data([world.land]).join("path").attr("class","coast").attr("d", geoPath);
  d3.select("#landclip-path").attr("d", geoPath(world.land));
  drawNight();
}

// ---------------------------------------------------------------- day / night
function sunPosition(date){
  const rad = Math.PI/180, d = date/86400000 - 10957.5;            // days since J2000
  const g = (357.529 + 0.98560028*d)*rad, q = 280.459 + 0.98564736*d;
  const L = (q + 1.915*Math.sin(g) + 0.020*Math.sin(2*g))*rad, e = (23.439 - 0.00000036*d)*rad;
  const ra = Math.atan2(Math.cos(e)*Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e)*Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908*d) % 24 + 24) % 24;
  let lon = (ra/rad - gmst*15) % 360; if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
  return [lon, dec/rad];
}
function drawNight(){
  const [lon, lat] = sunPosition(Date.now());
  const anti = [lon + 180 > 180 ? lon - 180 : lon + 180, -lat];
  // Lighten the daylight side and darken the night side; stacked circles give a soft twilight band.
  const sunCircle = r => geoPath(d3.geoCircle().center([lon, lat]).radius(r).precision(2)());
  const day = [[96,.045],[93,.045],[90,.045],[87,.045],[84,.045],[75,.04]];
  d3.select("#g-night").selectAll("path.day").data(day).join("path").attr("class","day")
    .attr("opacity", d => d[1]).attr("d", d => sunCircle(d[0]));
  // extra lift on sunlit land only, so countries in daylight clearly stand out
  const dl = d3.select("#g-night").selectAll("g.dayland").data([1]).join("g").attr("class","dayland").attr("clip-path","url(#landclip)");
  dl.selectAll("path").data([[95,.06],[92,.06],[89,.06],[86,.06],[80,.06]]).join("path").attr("class","day")
    .attr("opacity", d => d[1]).attr("d", d => sunCircle(d[0]));
  const night = [[96,.08],[93,.08],[90,.08],[87,.08],[84,.08]];
  d3.select("#g-night").selectAll("path.night").data(night).join("path").attr("class","night")
    .attr("opacity", d => d[1]).attr("d", d => geoPath(d3.geoCircle().center(anti).radius(d[0]).precision(2)()));
  d3.select("#g-night").selectAll("path.terminator").data([90]).join("path").attr("class","terminator")
    .attr("d", d => geoPath(d3.geoCircle().center(anti).radius(d).precision(2)()));
  const sp = proj([lon, lat]);
  d3.select("#g-night").selectAll("g.sun").data(sp ? [sp] : []).join(e => { const g = e.append("g").attr("class","sun");
      g.append("circle").attr("r", 14).attr("class","sun-halo"); g.append("circle").attr("r", 4.5).attr("class","sun-core"); return g; })
    .attr("transform", d => `translate(${d[0]},${d[1]})`);
}

// ---------------------------------------------------------------- arcs
function arcPath(p0, p1, i){
  const dx = p1[0]-p0[0], dy = p1[1]-p0[1], d = Math.hypot(dx, dy);
  if (d < 14){                                            // same city as the server: a little loop
    const r = 26 + i*10;
    return `M${p0[0]},${p0[1]} C${p0[0]-r},${p0[1]-r*1.7} ${p1[0]+r},${p1[1]-r*1.7} ${p1[0]},${p1[1]}`;
  }
  let nx = -dy/d, ny = dx/d; if (ny > 0){ nx = -nx; ny = -ny; }   // bow towards the top of the screen
  const h = Math.min(d*0.3, 280) * (1 + i*0.22);
  const cx = (p0[0]+p1[0])/2 + nx*h, cy = Math.max(60, (p0[1]+p1[1])/2 + ny*h);
  return `M${p0[0]},${p0[1]} Q${cx},${cy} ${p1[0]},${p1[1]}`;
}

function render(){
  if (!ST || !world) return;
  const srv = ST.server || {};
  const sessions = ST.activity?.sessions || [];
  const hasSrv = srv.lat != null;
  const ps = hasSrv ? proj([srv.lon, srv.lat]) : [innerWidth/2, innerHeight/2];
  for (const k of [...colors.keys()]) if (!sessions.some(s => s.key === k)) colors.delete(k);
  sessions.forEach(s => s._c = colorFor(s.key));

  // endpoints, grouped by location so overlapping streams fan out
  const wan = sessions.filter(s => !s.lan && s.geo), lan = sessions.filter(s => s.lan || !s.geo);
  const groups = new Map();
  for (const s of wan){
    s._p = proj([s.geo.lon, s.geo.lat]);
    const k = Math.round(s._p[0]/10) + ":" + Math.round(s._p[1]/10);
    const arr = groups.get(k) || []; s._i = arr.length; arr.push(s); groups.set(k, arr);
  }
  for (const s of wan){ s._d = arcPath(ps, s._p, s._i); s._spd = Math.max(.35, Math.min(1.6, 1.6 - .28*Math.log2(Math.max(1, s.bandwidth/1000)))); }

  // recent (ghost) places
  const active = new Set(wan.map(s => Math.round(s.geo.lat) + ":" + Math.round(s.geo.lon)));
  const recent = (ST.config?.show_recent ? ST.recent || [] : []).filter(r => !active.has(Math.round(r.lat)+":"+Math.round(r.lon)));
  const hrs = (ST.config?.history_hours || 24) * 3600;
  const age = r => Math.max(0, Math.min(1, (ST.now - r.last) / hrs));
  const gr = d3.select("#g-recent");
  gr.selectAll("path.recent-arc").data(hasSrv ? recent : [], r => r.lat+","+r.lon).join("path").attr("class","recent-arc")
    .attr("d", r => arcPath(ps, proj([r.lon, r.lat]), 0)).attr("opacity", r => .16 - .1*age(r));
  gr.selectAll("circle.recent-dot").data(recent, r => r.lat+","+r.lon).join("circle").attr("class","recent-dot")
    .attr("r", r => 2 + Math.min(3, Math.sqrt(r.plays))).attr("cx", r => proj([r.lon, r.lat])[0]).attr("cy", r => proj([r.lon, r.lat])[1])
    .attr("opacity", r => .55 - .35*age(r));

  // arcs
  d3.select("#g-arcs").selectAll("g.arc").data(hasSrv ? wan : [], s => s.key).join(enter => {
      const g = enter.append("g").attr("class","arc");
      g.append("path").attr("class","glow"); g.append("path").attr("class","base"); g.append("path").attr("class","dash");
      const c = g.append("circle").attr("class","comet").attr("r", 3.2).attr("fill", "#fff");
      c.append("animateMotion").attr("repeatCount","indefinite").attr("rotate","auto");
      return g;
    })
    .attr("class", s => `arc ${s.state}`).style("--spd", s => s._spd + "s")
    .call(g => {
      g.selectAll("path").attr("d", s => s._d).attr("stroke", s => s._c);
      g.select("animateMotion").each(function(s){
        const dur = (s._spd * 3.2).toFixed(2) + "s";
        if (this.getAttribute("path") !== s._d) this.setAttribute("path", s._d);
        if (this.getAttribute("dur") !== dur) this.setAttribute("dur", dur);
      });
      g.select(".comet").attr("fill", s => d3.color(s._c).brighter(1.2));
    });

  // client nodes
  d3.select("#g-nodes").selectAll("g.node").data(wan, s => s.key).join(enter => {
      const g = enter.append("g").attr("class","node");
      g.append("circle").attr("class","ring").attr("r", 6); g.append("circle").attr("class","core").attr("r", 5.5);
      return g;
    })
    .attr("class", s => `node ${s.state}`)
    .attr("transform", s => `translate(${s._p[0] + s._i*7},${s._p[1] - s._i*7})`)
    .call(g => { g.select(".ring").attr("stroke", s => s._c); g.select(".core").attr("fill", s => s._c); });

  // server marker (+ LAN orbit)
  const gs = d3.select("#g-server").selectAll("g.srv").data(hasSrv ? [srv] : []).join(enter => {
      const g = enter.append("g").attr("class","srv");
      g.append("circle").attr("class","halo").attr("r", 22);
      g.append("circle").attr("class","ring").attr("r", 10);
      g.append("g").attr("class","orbit-wrap");
      g.append("circle").attr("class","core").attr("r", 10);
      g.append("path").attr("class","chev").attr("d","M-3.6,-6 h3.6 l4.2,6 l-4.2,6 h-3.6 l4.2,-6z");
      g.append("text").attr("class","name").attr("y", 26).attr("text-anchor","middle");
      g.append("text").attr("class","sub").attr("y", 40).attr("text-anchor","middle");
      return g;
    })
    .attr("transform", `translate(${ps[0]},${ps[1]})`);
  gs.select("text.name").text(srv.name || "Plex");
  gs.select("text.sub").text([srv.label, lan.length ? `${lan.length} on LAN` : ""].filter(Boolean).join(" · "));
  const ow = gs.select(".orbit-wrap");
  ow.selectAll("circle.orbit-track").data(lan.length ? [1] : []).join("circle").attr("class","orbit-track").attr("r", 20);
  const orb = ow.selectAll("g.orbit").data(lan.length ? [1] : []).join("g").attr("class","orbit");
  orb.selectAll("circle.lan").data(lan, s => s.key).join("circle").attr("class","lan").attr("r", 4.5)
    .attr("cx", (s,i) => 20*Math.cos(i*2*Math.PI/lan.length)).attr("cy", (s,i) => 20*Math.sin(i*2*Math.PI/lan.length))
    .attr("fill", s => s._c).attr("stroke","#0b0f14").attr("stroke-width",1.5);

  renderLabels(wan, hasSrv ? ps : null);
  renderCards(sessions);
  renderHeader();
  applyFocus();
}

// ---------------------------------------------------------------- labels
function renderLabels(wan, ps){
  const host = $("labels");
  const want = new Set(wan.map(s => s.key));
  for (const el of [...host.children]) if (!want.has(el.dataset.key)) el.remove();
  const placed = [];
  if (ps){                                   // keep labels off the server marker and its name
    const parts = [...document.querySelectorAll("#g-server g.srv .core, #g-server g.srv text")].map(e => e.getBoundingClientRect())
      .filter(r => r.width > 0);
    if (parts.length){
      const x0 = Math.min(...parts.map(r => r.left)), x1 = Math.max(...parts.map(r => r.right));
      const y0 = Math.min(...parts.map(r => r.top)), y1 = Math.max(...parts.map(r => r.bottom));
      placed.push({x: x0 - 4, y: y0 - 4, w: x1 - x0 + 8, h: y1 - y0 + 8});
    }
  }
  const cardsTop = innerHeight - $("cards").offsetHeight - 8;
  const items = wan.slice().sort((a,b) => a._p[1]-b._p[1]);
  for (const s of items){
    let el = host.querySelector(`[data-key="${CSS.escape(s.key)}"]`);
    if (!el){ el = document.createElement("div"); el.className = "label"; el.dataset.key = s.key; host.appendChild(el);
      el.addEventListener("click", () => setFocus(s.key)); }
    const html = `${avatar(s, s._c)}<div class="tx"><div class="nm">${esc(s.user)}</div><div class="pl">${esc(placeName(s.geo))} · ${esc(s.title)}</div></div>`;
    if (el._html !== html){ el.innerHTML = html; el._html = html; }
    el.style.setProperty("--c", s._c);
    const w = el.offsetWidth, h = el.offsetHeight;
    const nx = s._p[0] + s._i*7, ny = s._p[1] - s._i*7;
    let x = nx + 14, y = ny - h/2;
    if (x + w > innerWidth - 8) x = nx - 14 - w;
    y = Math.max(62, Math.min(y, cardsTop - h));
    for (let tries = 0; tries < 30; tries++){
      const hit = placed.find(p => x < p.x + p.w + 4 && x + w + 4 > p.x && y < p.y + p.h + 4 && y + h + 4 > p.y);
      if (!hit) break;
      y = hit.y + hit.h + 5;
      if (y + h > cardsTop){ y = hit.y - h - 5; if (y < 62) break; }
    }
    placed.push({x, y, w, h});
    el.style.left = x + "px"; el.style.top = y + "px";
  }
}

// ---------------------------------------------------------------- cards
function cardHTML(s){
  const [pl, pc] = platform(s);
  const rows = [
    ["PRODUCT", s.product, "full"], ["PLAYER", s.player], ["QUALITY", s.quality],
    ["STREAM", s.stream, ""], ["CONTAINER", s.container, "full"], ["VIDEO", s.video, ""],
    ["AUDIO", s.audio, "full"], ["SUBTITLE", s.subtitle_line, "full"],
    ["LOCATION", `${s.secure ? "🔒 " : ""}${s.relayed ? "⇄ " : ""}${s.location}${s.ip ? ": " + s.ip : ""}${s.geo ? " · " + placeName(s.geo) : ""}`]
  ].filter(r => r[1]);
  return `
  <div class="top">
    <div class="poster ${s.poster_shape === "square" ? "square" : ""}" style="background-image:url('${s.poster}')"></div>
    <dl>${rows.map(([k,v,c]) => `<dt class="${c||""}">${k}</dt><dd class="${c||""}" title="${esc(v)}">${esc(v)}</dd>`).join("")}</dl>
    <div class="plat" style="background:${pc}">${esc(pl)}</div>
    <div class="ends"><span class="e"></span><br><span class="tm"></span></div>
  </div>
  <div class="bar"><i class="tc"></i><i class="pos"></i></div>
  <div class="foot">
    <div class="ttl"><div class="t1"><span class="st">${s.state === "paused" ? "❚❚" : s.state === "buffering" ? "◌" : "▶"}</span>${esc(s.title)}</div>
      <div class="t2"><span>${esc(s.subtitle)}</span>${chip(s)}</div></div>
    <div class="usr"><span>${esc(s.user)}</span>${avatar(s, s._c)}</div>
  </div>`;
}

// ---- card strip: centred when the cards fit, otherwise a slow, continuous right-to-left loop.
// The track holds the real cards followed by copies, and slides left by exactly one set's
// width before wrapping, so the loop is seamless. Drag to move it; it resumes after 8 s.
const marqueeSpeed = () => parseFloat(qs.get("speed")) || +PM.settings.scroll_speed || 35;    // px per second
const mq = {on:false, off:0, loopW:0, last:0, pauseUntil:0, drag:null, moved:false, target:null};
function marqueeFrame(t){
  const track = $("track");
  const dt = mq.last ? Math.min(100, t - mq.last) : 0; mq.last = t;
  if (mq.on && mq.loopW > 0){
    if (mq.target != null && !mq.drag){                       // glide to a tapped card the short way round
      let d = ((mq.target - mq.off) % mq.loopW + mq.loopW) % mq.loopW; if (d > mq.loopW/2) d -= mq.loopW;
      if (Math.abs(d) < .5) mq.target = null; else mq.off += d * Math.min(1, dt / 180);
    } else if (!mq.drag && !focusKey && Date.now() > mq.pauseUntil) mq.off += marqueeSpeed() * dt / 1000;
    mq.off = ((mq.off % mq.loopW) + mq.loopW) % mq.loopW;
    track.style.transform = `translate3d(${(-mq.off).toFixed(2)}px,0,0)`;
  } else if (track.style.transform) track.style.transform = "";
  requestAnimationFrame(marqueeFrame);
}
requestAnimationFrame(marqueeFrame);
{
  const strip = $("cards");
  strip.addEventListener("pointerdown", e => { mq.drag = {x: e.clientX, off: mq.off}; mq.moved = false; mq.target = null; });
  addEventListener("pointermove", e => {
    if (!mq.drag) return;
    const dx = e.clientX - mq.drag.x;
    if (Math.abs(dx) > 6) mq.moved = true;
    if (mq.on && mq.moved) mq.off = mq.drag.off - dx;
  });
  const end = () => { if (mq.drag){ mq.drag = null; if (mq.moved) mq.pauseUntil = Date.now() + 8000; } };
  addEventListener("pointerup", end); addEventListener("pointercancel", end);
  strip.addEventListener("click", e => {
    if (mq.moved) return;
    const c = e.target.closest(".card"); if (c) setFocus(c.dataset.key);
  });
}

function renderCards(sessions){
  const strip = $("cards"), track = $("track");
  if (!sessions.length){
    const r = ST.recent || [], plays = r.reduce((a,p) => a + p.plays, 0);
    const html = `<div class="idle"><b>Nothing playing right now</b>${r.length && ST.config?.show_recent ?
      ` <span class="sep">·</span> last ${ST.config.history_hours}h: ${plays} play${plays===1?"":"s"} from ${r.length} place${r.length===1?"":"s"}` : ""}</div>`;
    if (track._idle !== html){ track.innerHTML = html; track._idle = html; track._cloneSig = ""; }
    mq.on = false; strip.classList.remove("marquee");
    return;
  }
  if (track._idle){ track.innerHTML = ""; track._idle = null; }
  const remToPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const compact = sessions.length * (30*remToPx + 14) + 14 > innerWidth;
  const want = new Set(sessions.map(s => s.key));
  const origs = () => [...track.querySelectorAll(".card:not(.clone)")];
  for (const el of origs()) if (!want.has(el.dataset.key)) el.remove();
  sessions.forEach((s, idx) => {
    let el = track.querySelector(`.card:not(.clone)[data-key="${CSS.escape(s.key)}"]`);
    if (!el){ el = document.createElement("div"); el.className = "card"; el.dataset.key = s.key; }
    const cur = origs();
    if (cur[idx] !== el) track.insertBefore(el, cur[idx] || track.querySelector(".clone"));
    const sig = JSON.stringify([s, s._c]).replace(/"view_offset":\d+,?/, "").replace(/"transcode_progress":\d+,?/, "");
    if (el._sig !== sig){ el.innerHTML = cardHTML(s); el._sig = sig; }
    el.classList.toggle("compact", compact);
    el.style.setProperty("--c", s._c);
    el._s = s;
  });

  // does one set of cards overflow the screen?
  const os = origs();
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
  const setW = os.reduce((a, el) => a + el.offsetWidth, 0) + gap * os.length;   // incl. the gap before the next set
  const avail = strip.clientWidth - 2*pad;
  const overflow = setW - gap > avail + 2;
  const cloneSig = overflow ? os.map(e => e._sig).join("|") + compact + avail : "";
  if (track._cloneSig !== cloneSig){
    track.querySelectorAll(".clone").forEach(c => c.remove());
    if (overflow){
      const copies = Math.max(1, Math.ceil(avail / setW));
      for (let k = 0; k < copies; k++) for (const el of os){
        const c = el.cloneNode(true); c.classList.add("clone"); c.setAttribute("aria-hidden", "true"); track.appendChild(c);
      }
    }
    track._cloneSig = cloneSig;
  }
  for (const c of track.querySelectorAll(".clone"))
    c._s = os.find(o => o.dataset.key === c.dataset.key)?._s;
  mq.on = overflow; mq.loopW = setW;
  strip.classList.toggle("marquee", overflow);
  tick();
  // a tall card strip on a short screen shouldn't hide the map: re-fit bounds view if strip height changed
  const lk = strip.offsetHeight + ":" + compact;
  if (lk !== lastLayoutKey){ lastLayoutKey = lk; if (ST.config?.bounds){ setupProjection(); drawBase(); render(); } }
}

function tick(){
  const now = new Date();
  $("clock").textContent = fmtClock(now, ST?.config);
  $("date").textContent = now.toLocaleDateString([], {weekday:"long", day:"numeric", month:"long"});
  const dt = Date.now() - polledAt;
  for (const el of $("cards").querySelectorAll(".card")){
    const s = el._s; if (!s) continue;
    const off = Math.min(s.duration || Infinity, s.view_offset + (s.state === "playing" ? dt : 0));
    const pct = s.duration ? 100*off/s.duration : 0;
    el.querySelector(".pos").style.width = pct + "%";
    el.querySelector(".tc").style.width = (s.transcode === "transcode" ? Math.max(pct, s.transcode_progress) : 0) + "%";
    el.querySelector(".tm").textContent = s.live ? "LIVE" : `${fmtDur(off)} / ${fmtDur(s.duration)}`;
    el.querySelector(".e").textContent = s.duration && !s.live ? "Ends At: " + fmtClock(new Date(Date.now() + s.duration - off), ST.config) : "";
  }
}

function renderHeader(){
  const a = ST.activity || {}, n = a.stream_count || 0;
  const parts = [];
  if (a.transcodes) parts.push(`${a.transcodes} transcode${a.transcodes>1?"s":""}`);
  const dp = (a.sessions||[]).filter(s => s.transcode === "direct play").length, ds = (a.sessions||[]).filter(s => s.transcode === "copy").length;
  if (dp) parts.push(`${dp} direct play`); if (ds) parts.push(`${ds} direct stream`);
  $("stats").innerHTML = `<b>${n} stream${n===1?"":"s"}</b>${parts.length ? `(${parts.join(", ")})` : ""}<span class="sep">|</span>` +
    `Bandwidth: <span style="color:var(--text)">${mbps(a.total_bandwidth)}</span>` +
    (a.total_bandwidth ? ` (WAN: ${mbps(a.wan_bandwidth)}${a.lan_bandwidth ? `, LAN: ${mbps(a.lan_bandwidth)}` : ""})` : "");
  $("srvname").textContent = ST.server?.name || "";
}

// ---------------------------------------------------------------- focus (tap a card or label)
function setFocus(key){
  focusKey = focusKey === key ? null : key;
  clearTimeout(focusTimer);
  if (focusKey) focusTimer = setTimeout(() => { focusKey = null; applyFocus(); }, 20000);
  applyFocus();
  // bring the focused card to the middle of the strip (the strip holds still while focused)
  const card = $("track").querySelector(`.card:not(.clone)[data-key="${CSS.escape(key)}"]`);
  if (focusKey && card && mq.on){
    const pad = parseFloat(getComputedStyle($("cards")).paddingLeft) || 0;
    const avail = $("cards").clientWidth - 2*pad;
    mq.target = card.offsetLeft - pad - (avail - card.offsetWidth) / 2;
  }
  if (!focusKey) mq.pauseUntil = Date.now() + 3000;
}
function applyFocus(){
  const sel = "#g-arcs .arc, #g-nodes .node";
  d3.selectAll(sel).classed("dim", s => focusKey && s.key !== focusKey);
  for (const el of document.querySelectorAll("#labels .label, #cards .card")){
    el.classList.toggle("dim", !!focusKey && el.dataset.key !== focusKey);
    el.classList.toggle("focus", !!focusKey && el.dataset.key === focusKey);
  }
}
document.getElementById("map").addEventListener("click", e => {
  if (window.onMapPick){ const ll = proj.invert([e.clientX, e.clientY]); const f = window.onMapPick; window.onMapPick = null; f(ll); return; }
  if (focusKey){ focusKey = null; applyFocus(); }
});

// ---------------------------------------------------------------- polling
let pollTimer = null, polling = false;
async function poll(){
  clearTimeout(pollTimer);
  if (polling) return;
  polling = true;
  try{
    const st = await PM.snapshot();
    const first = !ST || !ST.config?.top_lat, cfgChanged = ST && JSON.stringify(ST.config) !== JSON.stringify(st.config);
    ST = st; polledAt = Date.now();
    const stale = st.updated && (st.now - st.updated) > Math.max(30, 4*(st.config.poll_interval||5));
    showBanner(!PM.configured() ? "" : st.error || (stale ? "Activity data is stale" : "") ||
      (st.server?.lat == null ? "Server location not set - open Settings (⚙) to add it" : ""));
    if (first || cfgChanged){ setupProjection(); drawBase(); }
    render();
  } catch (e){
    showBanner("Error: " + (e && e.message || e));
  } finally {
    polling = false;
    pollTimer = setTimeout(poll, Math.max(2, +PM.settings.poll_interval || 5) * 1000);
  }
}
function showBanner(msg){ const b = $("banner"); b.textContent = msg || ""; b.style.display = msg ? "block" : "none"; }

// re-render soon after a poster/avatar finishes loading
let imgTimer = null;
PM.onImage = () => { clearTimeout(imgTimer); imgTimer = setTimeout(render, 120); };

// ---------------------------------------------------------------- settings hooks (used by setup.js)
function applyDisplaySettings(){
  const s = PM.settings;
  document.documentElement.style.fontSize = (16 * (parseFloat(qs.get("scale")) || +s.ui_scale || 1)) + "px";
}
window.APP = {
  refresh(){ applyDisplaySettings(); colors.clear(); ST = null; lastLayoutKey = ""; poll(); },
  invert(x, y){ return proj ? proj.invert([x, y]) : null; },
  banner: showBanner,
};

// ---------------------------------------------------------------- night dimming (fade to black between two times)
const dimEl = document.createElement("div");
dimEl.id = "dim"; document.body.appendChild(dimEl);
let dimPeekUntil = 0;
function mins(t){ const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function updateDim(){
  const a = mins(PM.settings.dim_from), b = mins(PM.settings.dim_to);
  let dark = false;
  if (a !== null && b !== null && a !== b){
    const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
    dark = a < b ? (now >= a && now < b) : (now >= a || now < b);
  }
  dimEl.classList.toggle("on", dark && Date.now() > dimPeekUntil);
}
dimEl.addEventListener("click", () => { dimPeekUntil = Date.now() + 60000; updateDim(); });

// ---------------------------------------------------------------- keyboard / fullscreen
addEventListener("keydown", e => {
  if (e.key === "F11"){ e.preventDefault(); PM.setFullscreen(); }
  else if (e.key === "Escape" && !document.querySelector("#setup.open")) PM.setFullscreen(false);
});

async function init(){
  applyDisplaySettings();
  const topo = await fetch("vendor/countries-50m.json").then(r => r.json());
  world = {
    land: topojson.feature(topo, topo.objects.land),
    borders: topojson.mesh(topo, topo.objects.countries, (a,b) => a !== b),
  };
  await poll();
  if (!ST){ ST = {config:{top_lat:80}, server:{}, activity:{sessions:[]}, recent:[]}; setupProjection(); drawBase(); }
  setInterval(tick, 1000);
  setInterval(drawNight, 60000);
  setInterval(updateDim, 20000); updateDim();
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { setupProjection(); drawBase(); render(); }, 150); });
  if (PM.settings.start_fullscreen) PM.setFullscreen(true).catch(() => {});
  // fresh start once a day keeps a long-running kiosk tidy
  const t = new Date(); t.setHours(24, 4, 0, 0); setTimeout(() => location.reload(), t - Date.now());
}
init();
