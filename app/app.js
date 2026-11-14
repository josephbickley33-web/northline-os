/* Northline Operating System - connected app (Supabase).
   Plain ES2019 JavaScript, no build step. Works in iOS Safari 14+. */
(function(){
"use strict";

// ------------------------------------------------------------------ constants
var ICONS = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>',
  command:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>',
  network:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7l3 9M16 7l-3 9"/></svg>',
  fleet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 16h18M5 16V8h8l4 4v4M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
  people:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.74"/></svg>',
  stock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4"/></svg>',
  finance:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5M4 19h16M8 16V9m5 7V7m5 9v-5"/></svg>',
  ai:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M9 13h.01M15 13h.01M9 16h6"/></svg>',
  board:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5h14v12H7l-2 3V5z"/></svg>',
  info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.01"/></svg>',
  admin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2"/></svg>'
};
var MARK = '<div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="#083332" stroke-width="2"><path d="M3 17h18M5 17V8l7-4 7 4v9M9 17v-4h6v4"/></svg></div>';
// Same map as the demo and as the database policies in supabase/schema.sql
var ACCESS = {
  admin:["home","command","network","fleet","people","stock","finance","ai","board","info","admin"],
  duty:["home","command","network","fleet","people","ai","board","info"],
  planner:["home","command","network","stock","finance","ai","board","info"],
  workshop:["home","fleet","board","info"],
  warehouse:["home","stock","board","info"],
  driver:["home","board","info"]
};
var ROLE_LABEL = {admin:"Admin",duty:"Duty manager",planner:"Planner",workshop:"Workshop",warehouse:"Warehouse",driver:"Driver"};
var NAV = [
  {label:"Work", items:[["home","Home"],["command","Command"],["network","Network"],["fleet","Fleet"],["people","People"],["stock","Stock"],["finance","Finance"],["ai","AI control"]]},
  {label:"Company", items:[["board","Staff board"],["info","Information"],["admin","Admin"]]}
];
var JOB_STATUSES = ["Planned","On time","Watch","At risk","Held","Delivered","Cancelled"];
var VEHICLE_STATUSES = ["Available","On route","Workshop","Off road","Sold"];
var DAILY_LIMIT = 540;   // 9 hours daily driving (GB/assimilated rules; 10h twice a week is not modelled here)
var WEEKLY_LIMIT = 3360; // 56 hours

// CSV import definitions: which columns, how to coerce, and the upsert key.
var CSV_DEFS = {
  vehicles: { label:"Vehicles", table:"vehicles", conflict:"reg", required:["reg"],
    cols:{reg:"text",type:"text",depot:"text",status:"text",mot_due:"date",next_service:"date",odometer:"int",notes:"text"},
    roles:["admin","duty","workshop"] },
  jobs: { label:"Jobs", table:"jobs", conflict:"ref", required:["ref"],
    cols:{ref:"text",customer:"text",origin:"text",destination:"text",pallets:"int",delivery_window:"text",status:"text",vehicle_reg:"text",driver_name:"text",rate_gbp:"num",cost_gbp:"num",notes:"text"},
    roles:["admin","duty","planner"] },
  stock: { label:"Stock", table:"stock_items", conflict:"sku,depot", required:["sku","name","depot"],
    cols:{sku:"text",name:"text",depot:"text",qty:"int",reorder_point:"int",location:"text"},
    roles:["admin","planner","warehouse"] }
};

// ------------------------------------------------------------------ state
var cfg = window.NORTHLINE_CONFIG || {};
var sb = null;
var state = { session:null, profile:null, view:"home", search:"", channel:null, info:null,
  adminTab:"members", jobFilter:"all", stockDepot:"all", authTab:"signin", recovery:false,
  boardUnread:0, live:false };
var renderToken = 0;
var realtimeChannel = null;

// ------------------------------------------------------------------ helpers
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
function initials(name){ return String(name || "?").split(/\s+/).filter(Boolean).map(function(p){ return p[0]; }).slice(0,2).join("").toUpperCase() || "?"; }
function pill(text, tone){ return '<span class="pill ' + (tone || "") + '">' + esc(text) + '</span>'; }
function head(title, sub, extra){ return '<div class="page-head"><div><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' + (extra || "") + '</div>'; }
function role(){ return state.profile ? state.profile.role : null; }
function can(view){ var r = role(); return !!(r && ACCESS[r] && ACCESS[r].indexOf(view) >= 0); }
function hasRole(){ var r = role(); for (var i = 0; i < arguments.length; i++) if (arguments[i] === r) return true; return false; }
function gbp(n){ if (n == null || isNaN(n)) return "—"; return "£" + Number(n).toLocaleString("en-GB", {maximumFractionDigits:0}); }
function num(n){ return n == null ? "—" : Number(n).toLocaleString("en-GB"); }
function hm(mins){ if (mins == null) return "—"; var h = Math.floor(mins / 60), m = mins % 60; return h + "h " + (m < 10 ? "0" : "") + m + "m"; }
var LONDON = { timeZone:"Europe/London" };
function when(ts){
  if (!ts) return "—";
  var d = new Date(ts);
  try { return d.toLocaleString("en-GB", Object.assign({ day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }, LONDON)); }
  catch (e) { return d.toISOString().slice(0,16).replace("T"," ") + " UTC"; }
}
function dateUK(d){ if (!d) return "—"; var p = String(d).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : esc(d); }
function daysUntil(d){ if (!d) return null; return Math.round((new Date(d + "T00:00:00Z") - Date.now()) / 86400000); }
function statusTone(s){
  s = String(s || "").toLowerCase();
  if (/(at risk|off road|overdue|held|rejected)/.test(s)) return "bad";
  if (/(watch|workshop|pending)/.test(s)) return "watch";
  if (/(on time|available|delivered|approved|active|on route)/.test(s)) return "ok";
  return "";
}
function matches(obj){
  var q = state.search.trim().toLowerCase(); if (!q) return true;
  return Object.keys(obj).some(function(k){ var v = obj[k]; return v != null && typeof v !== "object" && String(v).toLowerCase().indexOf(q) >= 0; });
}
function exampleTag(row){ return row && row.example ? '<span class="example-tag">example</span>' : ""; }

var toastTimer = null;
function toast(msg, isErr){
  var t = $("toast"); t.textContent = msg; t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.className = "toast hidden"; }, isErr ? 6000 : 3000);
}
function friendlyError(err){
  if (!err) return "Something went wrong.";
  var m = err.message || String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Could not reach the server. Check your signal and try again.";
  if (/row-level security|permission denied/i.test(m)) return "Your role is not allowed to do that.";
  return m;
}
function fail(err){ console.warn(err); toast(friendlyError(err), true); }

function openModal(html, bind){
  $("modalCard").innerHTML = html; $("modal").className = "modal";
  var first = $("modalCard").querySelector("input,select,textarea"); if (first && window.innerWidth > 980) first.focus();
  if (bind) bind($("modalCard"));
}
function closeModal(){ $("modal").className = "modal hidden"; $("modalCard").innerHTML = ""; }

function formValues(root){
  var out = {};
  Array.prototype.forEach.call(root.querySelectorAll("[name]"), function(el){
    var v = el.type === "checkbox" ? el.checked : el.value.trim();
    if (el.dataset.kind === "int") v = v === "" ? null : parseInt(v, 10);
    else if (el.dataset.kind === "num") v = v === "" ? null : Number(v);
    else if (v === "" && el.type !== "checkbox") v = null;
    out[el.name] = v;
  });
  return out;
}
function field(label, name, value, opts){
  opts = opts || {};
  var v = value == null ? "" : value, input;
  if (opts.options) {
    input = '<select class="input" name="' + name + '">' + (opts.blank ? '<option value="">—</option>' : "") + opts.options.map(function(o){
      var val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(val) + '"' + (String(val) === String(v) ? " selected" : "") + '>' + esc(lab) + '</option>'; }).join("") + '</select>';
  } else if (opts.textarea) {
    input = '<textarea class="input" name="' + name + '">' + esc(v) + '</textarea>';
  } else {
    input = '<input class="input" name="' + name + '" value="' + esc(v) + '" type="' + (opts.type || "text") + '"' +
      (opts.kind ? ' data-kind="' + opts.kind + '" inputmode="' + (opts.kind === "int" ? "numeric" : "decimal") + '"' : "") +
      (opts.required ? " required" : "") + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : "") + '>';
  }
  return '<label class="field' + (opts.full ? " full" : "") + '"><span>' + esc(label) + '</span>' + input + '</label>';
}

// ------------------------------------------------------------------ not connected
function configMissing(){
  var u = String(cfg.SUPABASE_URL || ""), k = String(cfg.SUPABASE_ANON_KEY || "");
  return !u || !k || /YOUR_|PLACEHOLDER/i.test(u + k) || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(u);
}
function showNotConnected(reason){
  $("boot").className = "screen-center";
  $("boot").innerHTML = '<div class="status-card" id="notConnected">' + MARK +
    '<h1>Northline is not connected yet</h1>' +
    '<p>' + esc(reason) + '</p>' +
    '<p>The app is installed, but it has not been linked to its secure database. Once the administrator finishes setup, this page will show the sign-in screen.</p>' +
    '<ol><li>Create a Supabase project (free tier is fine).</li><li>Run <code>deploy.sh</code> with the project ref and an access token. It loads the database and writes <code>config.js</code>.</li><li>Publish the site. The first person to sign up becomes the admin.</li></ol>' +
    '<p class="note">Want to look around first? The <a href="../">demo version</a> still works with example data.</p></div>';
}

// ------------------------------------------------------------------ auth screens
function showLogin(){
  document.body.classList.remove("app-on");
  $("boot").className = "hidden";
  $("login").className = "";
  renderAuth();
}
function renderAuth(msg, tone){
  var tab = state.recovery ? "newpass" : state.authTab;
  var tabs = state.recovery ? "" : '<div class="tabs">' + [["signin","Sign in"],["signup","Create account"],["reset","Forgot password"]].map(function(t){
    return '<button type="button" data-auth-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="true"' : "") + '>' + t[1] + '</button>'; }).join("") + '</div>';
  var body;
  if (tab === "signin") body = '<h2>Sign in</h2><p class="sub">Use your work email and password.</p>' +
    '<form id="authForm">' + field("Email","email","",{type:"email",required:true}) + field("Password","password","",{type:"password",required:true}) +
    '<button class="btn primary" type="submit">Sign in</button></form>';
  else if (tab === "signup") body = '<h2>Create an account</h2><p class="sub">An admin approves new members and sets their role before they can see company data.</p>' +
    '<form id="authForm">' + field("Full name","full_name","",{required:true}) + field("Work email","email","",{type:"email",required:true}) +
    field("Password (at least 8 characters)","password","",{type:"password",required:true}) +
    '<button class="btn primary" type="submit">Create account</button></form>';
  else if (tab === "reset") body = '<h2>Reset your password</h2><p class="sub">We will email you a link. Open it on this device to choose a new password.</p>' +
    '<form id="authForm">' + field("Email","email","",{type:"email",required:true}) + '<button class="btn primary" type="submit">Send reset link</button></form>';
  else body = '<h2>Choose a new password</h2><p class="sub">You opened a password reset link. Set your new password below.</p>' +
    '<form id="authForm">' + field("New password","password","",{type:"password",required:true}) + '<button class="btn primary" type="submit">Save new password</button></form>';
  $("authCard").innerHTML = tabs + body + '<p class="msg-line ' + (tone || "") + '" id="authMsg">' + esc(msg || "") + '</p>';
  Array.prototype.forEach.call($("authCard").querySelectorAll("input"), function(i){
    if (i.type === "email") i.setAttribute("autocomplete", "email");
    if (i.type === "password") i.setAttribute("autocomplete", tab === "signin" ? "current-password" : "new-password");
    i.setAttribute("autocapitalize", i.name === "full_name" ? "words" : "none");
  });
  $("authForm").onsubmit = function(e){ e.preventDefault(); submitAuth(tab, formValues(e.target), e.target.querySelector("button[type=submit]")); };
  Array.prototype.forEach.call($("authCard").querySelectorAll("[data-auth-tab]"), function(b){
    b.onclick = function(){ state.authTab = b.dataset.authTab; renderAuth(); };
  });
}
function redirectUrl(){ return location.origin + location.pathname; }
function submitAuth(tab, v, btn){
  var say = function(m, t){ $("authMsg").textContent = m; $("authMsg").className = "msg-line " + (t || ""); };
  if ((tab === "signup" || tab === "newpass") && (!v.password || v.password.length < 8)) return say("Password must be at least 8 characters.", "err");
  btn.disabled = true; say("Working…");
  var p;
  if (tab === "signin") p = sb.auth.signInWithPassword({ email:v.email, password:v.password });
  else if (tab === "signup") p = sb.auth.signUp({ email:v.email, password:v.password, options:{ data:{ full_name:v.full_name }, emailRedirectTo:redirectUrl() } });
  else if (tab === "reset") p = sb.auth.resetPasswordForEmail(v.email, { redirectTo:redirectUrl() });
  else p = sb.auth.updateUser({ password:v.password });
  p.then(function(res){
    btn.disabled = false;
    if (res.error) return say(friendlyError(res.error), "err");
    if (tab === "signup") {
      if (res.data && res.data.session) return say("Account created. Signing you in…", "ok"); // auto-confirmed; onAuthStateChange takes over
      state.authTab = "signin"; renderAuth("Account created. Check your email for a confirmation link, then sign in.", "ok");
    } else if (tab === "reset") say("If that email has an account, a reset link is on its way.", "ok");
    else if (tab === "newpass") { state.recovery = false; toast("Password updated"); afterSession(state.session); }
  }).catch(function(err){ btn.disabled = false; say(friendlyError(err), "err"); });
}

function showPending(){
  document.body.classList.remove("app-on");
  $("login").className = "hidden";
  var p = state.profile || {};
  $("boot").className = "screen-center";
  $("boot").innerHTML = '<div class="status-card" id="pending">' + MARK +
    '<h1>Waiting for approval</h1>' +
    '<p>Thanks' + (p.full_name ? ", " + esc(p.full_name.split(" ")[0]) : "") + '. Your account (' + esc(p.email || (state.session && state.session.user.email) || "") + ') has been created, but an admin needs to approve it and choose your role before you can see company data.</p>' +
    '<p class="note">Ask your manager or the Northline admin to open Admin, then Members, and approve you.</p>' +
    '<div class="actions"><button class="btn primary inline" id="checkAgain" type="button">Check again</button><button class="btn inline" id="pendingOut" type="button">Sign out</button></div></div>';
  $("checkAgain").onclick = function(){ afterSession(state.session); };
  $("pendingOut").onclick = signOut;
}

function afterSession(session){
  state.session = session;
  if (!session) { stopRealtime(); state.profile = null; return showLogin(); }
  if (state.recovery) return showLogin();
  sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(function(res){
    if (res.error) { fail(res.error); return showLogin(); }
    state.profile = res.data;
    if (!res.data || !res.data.active) return showPending();
    var first = !document.body.classList.contains("app-on");
    openApp();
    if (first) sb.rpc("log_audit", { p_action:"Signed in" }).then(function(){});
  });
}
function signOut(){ stopRealtime(); sb.auth.signOut().then(function(){ state.profile = null; state.view = "home"; showLogin(); }); }

// ------------------------------------------------------------------ app shell
function openApp(){
  $("boot").className = "hidden"; $("login").className = "hidden";
  document.body.classList.add("app-on"); document.body.classList.remove("nav-open");
  if (!can(state.view)) state.view = "home";
  renderSidebar(); renderMain(); startRealtime();
}
function renderSidebar(){
  var p = state.profile;
  var html = '<div class="brand">' + MARK + '<div><strong>Northline</strong><small>Operating system</small></div></div>';
  NAV.forEach(function(g){
    var items = g.items.filter(function(i){ return can(i[0]); }); if (!items.length) return;
    html += '<div class="nav-group"><div class="nav-label">' + g.label + '</div>';
    items.forEach(function(i){
      var badge = i[0] === "board" && state.boardUnread ? '<span class="badge">' + state.boardUnread + '</span>' : "";
      html += '<button class="nav" type="button" data-view="' + i[0] + '"' + (state.view === i[0] ? ' aria-current="page"' : "") + '>' + ICONS[i[0]] + '<span>' + i[1] + '</span>' + badge + '</button>';
    });
    html += '</div>';
  });
  html += '<div class="grow"></div><div class="who"><div class="avatar">' + esc(initials(p.full_name || p.email)) + '</div><div class="meta"><strong>' + esc(p.full_name || p.email) + '</strong><small>' +
    '<span class="live-dot' + (state.live ? " on" : "") + '" title="' + (state.live ? "Live updates on" : "Connecting live updates") + '"></span>' + esc(ROLE_LABEL[p.role]) + (p.depot ? " · " + esc(p.depot) : "") + '</small></div></div>';
  $("sidebar").innerHTML = html;
}
function go(view){
  state.view = view; state.search = ""; $("search").value = "";
  if (view === "board") state.boardUnread = 0;
  document.body.classList.remove("nav-open"); renderSidebar(); renderMain(); window.scrollTo(0,0);
}
function renderMain(){
  var main = $("main"), view = state.view, token = ++renderToken;
  if (!can(view)) { main.innerHTML = '<div class="card denied"><h2>This area is reserved</h2><p>Your role does not have access to this section. Ask an admin if you need it.</p></div>'; return; }
  if (!main.innerHTML || main.dataset.view !== view) main.innerHTML = '<div class="loading">Loading…</div>';
  main.dataset.view = view;
  Promise.resolve().then(function(){ return VIEWS[view](); }).then(function(html){
    if (token !== renderToken) return;  // a newer render started
    main.innerHTML = html;
    if (BINDERS[view]) BINDERS[view](main);
  }).catch(function(err){
    if (token !== renderToken) return;
    main.innerHTML = '<div class="card denied"><h2>Could not load this page</h2><p>' + esc(friendlyError(err)) + '</p><button class="btn inline" type="button" data-reload>Try again</button></div>';
  });
}
var rerenderTimer = null;
function softRerender(){ clearTimeout(rerenderTimer); rerenderTimer = setTimeout(function(){ if (!$("modal").className.match(/hidden/)) return; var a = document.activeElement; if (a && /TEXTAREA|INPUT|SELECT/.test(a.tagName) && a.value) return; renderMain(); }, 400); }

// query helper: resolves rows or throws
function q(builder){ return builder.then(function(res){ if (res.error) throw res.error; return res.data || []; }); }
function countQ(builder){ return builder.then(function(res){ if (res.error) throw res.error; return res.count || 0; }); }

// ------------------------------------------------------------------ realtime
function startRealtime(){
  if (realtimeChannel) return;
  var onChange = function(table){ return function(payload){
    if (table === "board_posts" && payload.eventType === "INSERT" && state.view !== "board" && payload.new && payload.new.author_id !== state.profile.id) { state.boardUnread++; renderSidebar(); }
    var relevant = { board_posts:["board","home"], board_replies:["board"], jobs:["home","command","network","finance"], ai_decisions:["home","command","ai"] }[table] || [];
    if (relevant.indexOf(state.view) >= 0) softRerender();
  }; };
  realtimeChannel = sb.channel("northline-live");
  ["board_posts","board_replies","jobs","ai_decisions"].forEach(function(t){
    realtimeChannel.on("postgres_changes", { event:"*", schema:"public", table:t }, onChange(t));
  });
  realtimeChannel.subscribe(function(status){ state.live = status === "SUBSCRIBED"; if (document.body.classList.contains("app-on")) renderSidebar(); });
}
function stopRealtime(){ if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; state.live = false; } }

// ------------------------------------------------------------------ views
var VIEWS = {}, BINDERS = {};

function kpi(label, value, sub, tone){ return '<div class="kpi ' + (tone || "") + '"><div class="l">' + esc(label) + '</div><div class="v">' + esc(value) + '</div><div class="d">' + esc(sub || "") + '</div></div>'; }
function emptyCard(text){ return '<div class="card"><p class="note">' + esc(text) + '</p></div>'; }
function jobsTable(rows, opts){
  opts = opts || {};
  if (!rows.length) return emptyCard(opts.empty || "No jobs yet. Add one or import a CSV.");
  return '<div class="scroll"><table class="panel"><thead><tr><th>Ref</th><th>Customer</th><th>Route</th><th class="right">Pallets</th><th>Window</th><th>Vehicle</th><th>Driver</th><th>Status</th>' + (opts.edit ? "<th></th>" : "") + '</tr></thead><tbody>' +
    rows.map(function(j){ return '<tr><td class="mono">' + esc(j.ref) + exampleTag(j) + '</td><td>' + esc(j.customer) + '</td><td>' + esc(j.origin) + ' → ' + esc(j.destination) + '</td><td class="right">' + num(j.pallets) + '</td><td>' + esc(j.delivery_window) + '</td><td class="mono">' + esc(j.vehicle_reg || "—") + '</td><td>' + esc(j.driver_name || "—") + '</td><td>' + pill(j.status, statusTone(j.status)) + '</td>' +
      (opts.edit ? '<td><button class="btn tiny" type="button" data-edit-job="' + j.id + '">Edit</button></td>' : "") + '</tr>'; }).join("") + '</tbody></table></div>';
}
function decisionsList(rows, canDecide){
  if (!rows.length) return emptyCard("No AI proposals are waiting.");
  return '<div class="rows">' + rows.map(function(d){
    return '<div class="row"><div><h3><span class="mono">' + esc(d.subject || "") + '</span> ' + esc(d.proposal) + exampleTag(d) + '</h3><p>' + esc(d.reason || "") +
      (d.confidence != null ? ' · confidence ' + Number(d.confidence).toFixed(2) : "") + (d.confidence_interval ? ' · ' + esc(d.confidence_interval) : "") + (d.owner ? ' · owner: ' + esc(d.owner) : "") + '</p>' +
      (d.status !== "pending" ? '<p>' + pill(d.status, statusTone(d.status)) + ' by ' + esc(d.approver_name || "—") + ' · ' + when(d.decided_at) + (d.note ? ' · “' + esc(d.note) + '”' : "") + '</p>' : "") + '</div>' +
      (d.status === "pending" && canDecide ? '<div class="row-actions"><button class="btn tiny primary" type="button" data-decide="approved" data-id="' + d.id + '">Approve</button><button class="btn tiny danger" type="button" data-decide="rejected" data-id="' + d.id + '">Reject</button></div>' : (d.status === "pending" ? pill("Pending","watch") : "")) +
      '</div>'; }).join("") + '</div>';
}
function bindDecisions(root){
  Array.prototype.forEach.call(root.querySelectorAll("[data-decide]"), function(b){
    b.onclick = function(){
      var decision = b.dataset.decide, id = Number(b.dataset.id);
      openModal('<h2>' + (decision === "approved" ? "Approve" : "Reject") + ' this proposal?</h2><p class="note">Your name, the time and your note are written to the audit log.</p><form id="decForm">' +
        field("Note (optional)","note","",{textarea:true}) + '<div class="actions"><button class="btn primary inline" type="submit">' + (decision === "approved" ? "Approve" : "Reject") + '</button><button class="btn inline" type="button" data-close>Cancel</button></div></form>', function(m){
        m.querySelector("#decForm").onsubmit = function(e){ e.preventDefault();
          var note = formValues(e.target).note;
          sb.rpc("decide_ai", { p_id:id, p_decision:decision, p_note:note }).then(function(res){
            if (res.error) return fail(res.error);
            closeModal(); toast("Proposal " + decision + " and logged"); renderMain();
          });
        };
      });
    };
  });
}

// ---- home
VIEWS.home = function(){
  var p = state.profile, r = p.role, first = esc((p.full_name || "").split(" ")[0] || "there");
  var title = head("Home", (p.title ? p.title + " · " : "") + ROLE_LABEL[r] + (p.depot ? " · " + p.depot : ""));
  var latestPosts = q(sb.from("board_posts").select("id,author_name,body,created_at,channel_id").eq("removed", false).order("created_at", {ascending:false}).limit(3));
  var boardCard = function(posts){ return '<div class="card"><h3>Latest from the staff board</h3>' + (posts.length ? posts.map(function(x){ return '<div class="msg"><div class="by"><div class="avatar" style="width:28px;height:28px;font-size:.65rem">' + esc(initials(x.author_name)) + '</div><strong>' + esc(x.author_name) + '</strong><time>' + when(x.created_at) + '</time></div><p>' + esc(x.body) + '</p></div>'; }).join("") : '<p class="note">No posts yet.</p>') + '</div>'; };
  if (r === "driver") {
    return Promise.all([
      q(sb.from("jobs").select("*").not("status","in","(Delivered,Cancelled)").order("ref")),
      q(sb.from("drivers_hours").select("*").order("day", {ascending:false}).limit(1)),
      latestPosts
    ]).then(function(a){
      var jobs = a[0], h = a[1][0];
      var left = h ? Math.max(0, DAILY_LIMIT - h.driving_minutes) : null;
      return title + '<p class="intro">Hello ' + first + '. These are the jobs assigned to you. Tap a status to update the office.</p>' +
        '<div class="kpis">' + kpi("Daily driving left", h ? hm(left) : "—", h ? "Of 9h, " + dateUK(h.day) : "No hours record yet", left != null && left <= 30 ? "bad" : "") +
        kpi("Weekly driving", h ? hm(h.weekly_minutes) : "—", "Limit 56h", h && h.weekly_minutes > WEEKLY_LIMIT - 240 ? "warn" : "") +
        kpi("Open jobs", jobs.length, "Assigned to you") + kpi("Breaks today", h ? hm(h.break_minutes) : "—", "45 min due after 4h30 driving") + '</div>' +
        '<section><h2>My jobs</h2>' + (jobs.length ? '<div class="rows">' + jobs.map(function(j){
          return '<div class="row"><div><h3><span class="mono">' + esc(j.ref) + '</span> ' + esc(j.origin) + ' → ' + esc(j.destination) + '</h3><p>' + esc(j.customer || "") + ' · ' + esc(j.delivery_window || "") + ' · ' + esc(j.vehicle_reg || "No vehicle") + (j.notes ? ' · ' + esc(j.notes) : "") + '</p>' +
            '<div class="row-actions" style="margin-top:8px">' + ["On time","Watch","At risk","Delivered"].map(function(s){ return '<button class="btn tiny' + (j.status === s ? " primary" : "") + '" type="button" data-job-status="' + s + '" data-id="' + j.id + '">' + s + '</button>'; }).join("") + '</div></div>' + pill(j.status, statusTone(j.status)) + '</div>'; }).join("") + '</div>' : emptyCard("No open jobs assigned to you.")) + '</section>' +
        boardCard(a[2]);
    });
  }
  var parts = [latestPosts];
  var kpiDefs = [];
  if (hasRole("admin","duty","planner")) {
    parts.push(countQ(sb.from("jobs").select("id", {count:"exact", head:true}).not("status","in","(Delivered,Cancelled)")));
    parts.push(countQ(sb.from("jobs").select("id", {count:"exact", head:true}).in("status", ["At risk","Held"])));
    parts.push(countQ(sb.from("ai_decisions").select("id", {count:"exact", head:true}).eq("status","pending")));
    kpiDefs.push(["Open jobs","Not yet delivered",""],["At risk or held","Work these first","bad"],["AI proposals waiting","Need a named approver","warn"]);
  }
  if (hasRole("admin","duty","workshop")) {
    parts.push(countQ(sb.from("vehicles").select("id", {count:"exact", head:true}).in("status", ["Off road","Workshop"])));
    kpiDefs.push(["Vehicles off road or in workshop","Blocked from the run sheet","warn"]);
  }
  if (hasRole("admin","planner","warehouse")) {
    parts.push(q(sb.from("stock_items").select("qty,reorder_point")).then(function(rows){ return rows.filter(function(s){ return s.qty <= s.reorder_point; }).length; }));
    kpiDefs.push(["Stock lines at or below reorder","Across all depots","warn"]);
  }
  if (r === "admin") {
    parts.push(countQ(sb.from("profiles").select("id", {count:"exact", head:true}).eq("active", false)));
    kpiDefs.push(["Members awaiting approval","Admin › Members","watch"]);
  }
  return Promise.all(parts).then(function(a){
    var k = a.slice(1).map(function(v, i){ return kpi(kpiDefs[i][0], num(v), kpiDefs[i][1], v > 0 ? kpiDefs[i][2] : ""); }).join("");
    return title + '<p class="intro">Hello ' + first + '. Live figures from the company database.</p><div class="kpis">' + k + '</div>' +
      '<div class="grid-2"><div class="card"><h3>Shortcuts</h3><div class="rows">' + ACCESS[r].filter(function(v){ return v !== "home"; }).map(function(v){
        var lab = {command:"Command: exceptions first",network:"Network: jobs and assignments",fleet:"Fleet: vehicles, MOT and service",people:"People: drivers' hours",stock:"Stock: levels and movements",finance:"Finance: revenue and margin",ai:"AI control: approval queue",board:"Staff board",info:"Information",admin:"Admin: members and data"}[v];
        return '<button class="row" type="button" data-go="' + v + '" style="text-align:left"><span class="shortcut">' + esc(lab) + '</span></button>'; }).join("") + '</div></div>' + boardCard(a[0]) + '</div>';
  });
};
BINDERS.home = function(root){
  Array.prototype.forEach.call(root.querySelectorAll("[data-job-status]"), function(b){
    b.onclick = function(){
      sb.from("jobs").update({ status:b.dataset.jobStatus }).eq("id", Number(b.dataset.id)).then(function(res){
        if (res.error) return fail(res.error); toast("Status updated"); renderMain(); });
    };
  });
};

// ---- command
VIEWS.command = function(){
  var parts = [
    q(sb.from("jobs").select("*").in("status", ["At risk","Held","Watch"]).order("status")),
    q(sb.from("ai_decisions").select("*").eq("status","pending").order("confidence", {ascending:false}).limit(8))
  ];
  if (hasRole("admin","duty")) parts.push(q(sb.from("vehicles").select("*").in("status", ["Off road","Workshop"])));
  if (hasRole("admin","duty")) parts.push(q(sb.from("drivers_hours").select("*").order("day", {ascending:false}).limit(200)));
  return Promise.all(parts).then(function(a){
    var jobs = a[0].filter(matches), dec = a[1], veh = (a[2] || []).filter(matches);
    var latest = {}; (a[3] || []).forEach(function(h){ if (!latest[h.driver_name]) latest[h.driver_name] = h; });
    var tight = Object.keys(latest).map(function(k){ return latest[k]; }).filter(function(h){ return DAILY_LIMIT - h.driving_minutes <= 30 || WEEKLY_LIMIT - h.weekly_minutes <= 240; });
    return head("Command","Exceptions to work first, from live data.") +
      (jobs.some(function(j){ return j.status === "At risk"; }) || tight.length ? '<div class="alert warn"><strong>Action needed</strong> ' + jobs.filter(function(j){ return j.status === "At risk"; }).length + ' job(s) at risk and ' + tight.length + ' driver(s) close to a legal hours limit.</div>' : '<div class="alert info"><strong>All clear</strong> No jobs are at risk right now.</div>') +
      '<section><h2>Jobs needing attention</h2>' + jobsTable(jobs, { empty:"No jobs at risk, held or on watch." }) + '</section>' +
      (tight.length ? '<section><h2>Drivers near a legal hours limit</h2><div class="rows">' + tight.map(function(h){ return '<div class="row"><div><h3>' + esc(h.driver_name) + '</h3><p>' + hm(Math.max(0, DAILY_LIMIT - h.driving_minutes)) + ' daily driving left · ' + hm(h.weekly_minutes) + ' this week' + (h.notes ? ' · ' + esc(h.notes) : "") + '</p></div>' + pill("Do not add work","bad") + '</div>'; }).join("") + '</div></section>' : "") +
      (a[2] ? '<section><h2>Vehicles off the road</h2>' + (veh.length ? '<div class="rows">' + veh.map(function(v){ return '<div class="row"><div><h3 class="mono">' + esc(v.reg) + '</h3><p>' + esc(v.type || "") + ' · ' + esc(v.depot || "") + (v.notes ? ' · ' + esc(v.notes) : "") + '</p></div>' + pill(v.status, statusTone(v.status)) + '</div>'; }).join("") + '</div>' : emptyCard("Every vehicle is available.")) + '</section>' : "") +
      '<section><h2>AI proposals waiting</h2>' + decisionsList(dec, true) + '</section>';
  });
};
BINDERS.command = bindDecisions;

// ---- network (jobs)
var driversCache = null;
function loadDrivers(){ return q(sb.from("profiles").select("id,full_name,email,role,active").eq("active", true).order("full_name")).then(function(r){ driversCache = r; return r; }); }
VIEWS.network = function(){
  var editable = hasRole("admin","duty","planner");
  return Promise.all([q(sb.from("jobs").select("*").order("created_at", {ascending:false}).limit(1000)), q(sb.from("vehicles").select("reg,status")), loadDrivers()]).then(function(a){
    var rows = a[0].filter(function(j){
      if (state.jobFilter === "open" && /Delivered|Cancelled/.test(j.status)) return false;
      if (state.jobFilter === "risk" && !/At risk|Held|Watch/.test(j.status)) return false;
      return matches(j);
    });
    var open = a[0].filter(function(j){ return !/Delivered|Cancelled/.test(j.status); });
    return head("Network","Jobs, assignments and status. Updates appear live for everyone.", editable ? '<div class="actions"><button class="btn primary inline" type="button" data-new-job>New job</button><button class="btn inline" type="button" data-csv="jobs">Import CSV</button></div>' : "") +
      '<div class="kpis">' + kpi("Jobs on board", num(open.length), "Not delivered or cancelled") + kpi("At risk", num(open.filter(function(j){ return j.status === "At risk"; }).length), "", "bad") +
      kpi("Unassigned", num(open.filter(function(j){ return !j.vehicle_reg || !j.driver_name; }).length), "No vehicle or driver", "warn") + kpi("Pallets on board", num(open.reduce(function(s, j){ return s + (j.pallets || 0); }, 0)), "") + '</div>' +
      '<div class="toolbar"><label>Show <select id="jobFilter" class="input" style="width:auto">' + [["all","All jobs"],["open","Open jobs"],["risk","At risk, held or watch"]].map(function(o){ return '<option value="' + o[0] + '"' + (state.jobFilter === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select></label></div>' +
      jobsTable(rows, { edit:editable });
  });
};
function jobForm(j){
  j = j || {};
  return '<h2>' + (j.id ? "Edit job " + esc(j.ref) : "New job") + '</h2><form id="jobForm"><div class="form-grid">' +
    field("Reference","ref",j.ref,{required:true,placeholder:"J-10600"}) + field("Customer","customer",j.customer) +
    field("Origin","origin",j.origin) + field("Destination","destination",j.destination) +
    field("Pallets","pallets",j.pallets,{kind:"int"}) + field("Delivery window","delivery_window",j.delivery_window,{placeholder:"05:30 receive"}) +
    field("Status","status",j.status || "Planned",{options:JOB_STATUSES}) +
    field("Vehicle","vehicle_reg",j.vehicle_reg,{options:(jobForm.regs || []), blank:true}) +
    field("Driver (member)","driver_id",j.driver_id,{options:(driversCache || []).filter(function(p){ return p.role === "driver"; }).map(function(p){ return [p.id, p.full_name || p.email]; }), blank:true}) +
    field("Driver name (if not a member)","driver_name",j.driver_id ? "" : j.driver_name) +
    field("Rate (£)","rate_gbp",j.rate_gbp,{kind:"num"}) + field("Cost (£)","cost_gbp",j.cost_gbp,{kind:"num"}) +
    field("Notes","notes",j.notes,{textarea:true,full:true}) +
    '</div><div class="actions"><button class="btn primary inline" type="submit">Save</button><button class="btn inline" type="button" data-close>Cancel</button>' +
    (j.id ? '<button class="btn danger inline" type="button" data-delete-job="' + j.id + '">Delete</button>' : "") + '</div></form>';
}
BINDERS.network = function(root){
  var sel = root.querySelector("#jobFilter"); if (sel) sel.onchange = function(){ state.jobFilter = sel.value; renderMain(); };
  var open = function(j){
    q(sb.from("vehicles").select("reg").order("reg")).then(function(v){
      jobForm.regs = v.map(function(x){ return x.reg; });
      if (j && j.vehicle_reg && jobForm.regs.indexOf(j.vehicle_reg) < 0) jobForm.regs.push(j.vehicle_reg);
      openModal(jobForm(j), function(m){
        m.querySelector("#jobForm").onsubmit = function(e){ e.preventDefault();
          var v = formValues(e.target);
          if (v.driver_id) { var d = (driversCache || []).filter(function(p){ return p.id === v.driver_id; })[0]; v.driver_name = d ? (d.full_name || d.email) : v.driver_name; }
          var op = j && j.id ? sb.from("jobs").update(v).eq("id", j.id) : sb.from("jobs").insert(v);
          op.then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Job saved"); renderMain(); });
        };
        var del = m.querySelector("[data-delete-job]");
        if (del) del.onclick = function(){ if (!confirm("Delete job " + j.ref + "?")) return;
          sb.from("jobs").delete().eq("id", j.id).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Job deleted"); renderMain(); }); };
      });
    }).catch(fail);
  };
  var nb = root.querySelector("[data-new-job]"); if (nb) nb.onclick = function(){ open(null); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-edit-job]"), function(b){
    b.onclick = function(){ q(sb.from("jobs").select("*").eq("id", Number(b.dataset.editJob))).then(function(r){ if (r[0]) open(r[0]); }).catch(fail); };
  });
};

// ---- fleet
VIEWS.fleet = function(){
  var editable = hasRole("admin","duty","workshop");
  return q(sb.from("vehicles").select("*").order("reg")).then(function(all){
    var rows = all.filter(matches);
    var by = {}; all.forEach(function(v){ by[v.status] = (by[v.status] || 0) + 1; });
    var dueSoon = all.filter(function(v){ var a = daysUntil(v.mot_due), b = daysUntil(v.next_service); return (a != null && a <= 30) || (b != null && b <= 14); });
    return head("Fleet","Vehicles, MOT and service dates on the operator licence.", editable ? '<div class="actions"><button class="btn primary inline" type="button" data-new-vehicle>Add vehicle</button><button class="btn inline" type="button" data-csv="vehicles">Import CSV</button></div>' : "") +
      '<div class="kpis">' + kpi("Vehicles", num(all.length), "On the system") + kpi("Available or on route", num((by["Available"] || 0) + (by["On route"] || 0)), all.length ? Math.round(((by["Available"] || 0) + (by["On route"] || 0)) / all.length * 100) + "% availability" : "") +
      kpi("Off road or workshop", num((by["Off road"] || 0) + (by["Workshop"] || 0)), "Blocked from planning", "warn") + kpi("MOT or service due soon", num(dueSoon.length), "MOT in 30 days or service in 14", dueSoon.length ? "bad" : "") + '</div>' +
      (rows.length ? '<div class="scroll"><table class="panel"><thead><tr><th>Reg</th><th>Type</th><th>Depot</th><th>Status</th><th>MOT due</th><th>Next service</th><th class="right">Odometer</th><th>Notes</th>' + (editable ? "<th></th>" : "") + '</tr></thead><tbody>' +
        rows.map(function(v){ var md = daysUntil(v.mot_due), sd = daysUntil(v.next_service);
          return '<tr><td class="mono">' + esc(v.reg) + exampleTag(v) + '</td><td>' + esc(v.type) + '</td><td>' + esc(v.depot) + '</td><td>' + pill(v.status, statusTone(v.status)) + '</td>' +
            '<td>' + dateUK(v.mot_due) + (md != null && md <= 30 ? " " + pill(md < 0 ? "Overdue" : md + "d", md < 0 ? "bad" : "watch") : "") + '</td>' +
            '<td>' + dateUK(v.next_service) + (sd != null && sd <= 14 ? " " + pill(sd < 0 ? "Overdue" : sd + "d", sd < 0 ? "bad" : "watch") : "") + '</td>' +
            '<td class="right">' + num(v.odometer) + '</td><td>' + esc(v.notes || "") + '</td>' + (editable ? '<td><button class="btn tiny" type="button" data-edit-vehicle="' + v.id + '">Edit</button></td>' : "") + '</tr>'; }).join("") + '</tbody></table></div>'
        : emptyCard("No vehicles yet. Add one or import a CSV."));
  });
};
BINDERS.fleet = function(root){
  var open = function(v){
    v = v || {};
    openModal('<h2>' + (v.id ? "Edit " + esc(v.reg) : "Add vehicle") + '</h2><form id="vehForm"><div class="form-grid">' +
      field("Registration","reg",v.reg,{required:true,placeholder:"MX26 ABC"}) + field("Type","type",v.type,{placeholder:"44t artic"}) +
      field("Depot","depot",v.depot) + field("Status","status",v.status || "Available",{options:VEHICLE_STATUSES}) +
      field("MOT due","mot_due",v.mot_due,{type:"date"}) + field("Next service","next_service",v.next_service,{type:"date"}) +
      field("Odometer (km)","odometer",v.odometer,{kind:"int"}) + field("Notes","notes",v.notes,{textarea:true,full:true}) +
      '</div><div class="actions"><button class="btn primary inline" type="submit">Save</button><button class="btn inline" type="button" data-close>Cancel</button>' +
      (v.id ? '<button class="btn danger inline" type="button" data-del>Delete</button>' : "") + '</div></form>', function(m){
      m.querySelector("#vehForm").onsubmit = function(e){ e.preventDefault(); var val = formValues(e.target); if (val.reg) val.reg = val.reg.toUpperCase();
        (v.id ? sb.from("vehicles").update(val).eq("id", v.id) : sb.from("vehicles").insert(val)).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Vehicle saved"); renderMain(); }); };
      var d = m.querySelector("[data-del]"); if (d) d.onclick = function(){ if (!confirm("Delete " + v.reg + "?")) return;
        sb.from("vehicles").delete().eq("id", v.id).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Vehicle deleted"); renderMain(); }); };
    });
  };
  var nb = root.querySelector("[data-new-vehicle]"); if (nb) nb.onclick = function(){ open(null); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-edit-vehicle]"), function(b){
    b.onclick = function(){ q(sb.from("vehicles").select("*").eq("id", Number(b.dataset.editVehicle))).then(function(r){ if (r[0]) open(r[0]); }).catch(fail); };
  });
};

// ---- people (directory + drivers' hours)
VIEWS.people = function(){
  var editable = hasRole("admin","duty");
  return Promise.all([q(sb.from("profiles").select("id,full_name,email,role,depot,title,active").eq("active", true).order("full_name")),
                      q(sb.from("drivers_hours").select("*").order("day", {ascending:false}).order("driver_name").limit(500))]).then(function(a){
    var people = a[0].filter(matches), hours = a[1].filter(matches);
    return head("People","Staff directory and drivers' hours against GB limits.", editable ? '<div class="actions"><button class="btn primary inline" type="button" data-new-hours>Record hours</button></div>' : "") +
      '<section><h2>Drivers\u2019 hours</h2><p class="intro">Daily limit used here: 9h driving. Weekly: 56h. These are planning aids; the tachograph record is the legal source.</p>' +
      (hours.length ? '<div class="scroll"><table class="panel"><thead><tr><th>Driver</th><th>Day</th><th class="right">Driving today</th><th class="right">Left today</th><th class="right">This week</th><th class="right">Breaks</th><th>Notes</th>' + (editable ? "<th></th>" : "") + '</tr></thead><tbody>' +
        hours.map(function(h){ var left = DAILY_LIMIT - h.driving_minutes;
          return '<tr><td>' + esc(h.driver_name) + exampleTag(h) + (h.driver_id ? "" : ' <span class="note">(not linked)</span>') + '</td><td>' + dateUK(h.day) + '</td><td class="right">' + hm(h.driving_minutes) + '</td><td class="right">' + (left <= 30 ? pill(hm(Math.max(0,left)), "bad") : hm(left)) + '</td><td class="right">' + (WEEKLY_LIMIT - h.weekly_minutes <= 240 ? pill(hm(h.weekly_minutes), "watch") : hm(h.weekly_minutes)) + '</td><td class="right">' + hm(h.break_minutes) + '</td><td>' + esc(h.notes || "") + '</td>' +
            (editable ? '<td><button class="btn tiny" type="button" data-edit-hours="' + h.id + '">Edit</button></td>' : "") + '</tr>'; }).join("") + '</tbody></table></div>' : emptyCard("No hours recorded yet.")) + '</section>' +
      '<section><h2>Staff directory</h2><div class="scroll"><table class="panel"><thead><tr><th>Name</th><th>Role</th><th>Title</th><th>Depot</th><th>Email</th></tr></thead><tbody>' +
        people.map(function(p){ return '<tr><td>' + esc(p.full_name) + '</td><td>' + esc(ROLE_LABEL[p.role]) + '</td><td>' + esc(p.title || "") + '</td><td>' + esc(p.depot || "") + '</td><td class="mono">' + esc(p.email || "") + '</td></tr>'; }).join("") + '</tbody></table></div></section>';
  });
};
BINDERS.people = function(root){
  var open = function(h){
    h = h || {};
    loadDrivers().then(function(){
      openModal('<h2>' + (h.id ? "Edit hours" : "Record hours") + '</h2><form id="hForm"><div class="form-grid">' +
        field("Driver (member)","driver_id",h.driver_id,{options:driversCache.filter(function(p){ return p.role === "driver"; }).map(function(p){ return [p.id, p.full_name || p.email]; }), blank:true}) +
        field("Or driver name","driver_name",h.driver_id ? "" : h.driver_name) + field("Day","day",h.day || new Date().toISOString().slice(0,10),{type:"date"}) +
        field("Driving today (minutes)","driving_minutes",h.driving_minutes || 0,{kind:"int"}) + field("Driving this week (minutes)","weekly_minutes",h.weekly_minutes || 0,{kind:"int"}) +
        field("Breaks today (minutes)","break_minutes",h.break_minutes || 0,{kind:"int"}) + field("Notes","notes",h.notes,{textarea:true,full:true}) +
        '</div><div class="actions"><button class="btn primary inline" type="submit">Save</button><button class="btn inline" type="button" data-close>Cancel</button></div></form>', function(m){
        m.querySelector("#hForm").onsubmit = function(e){ e.preventDefault(); var v = formValues(e.target);
          if (v.driver_id) { var d = driversCache.filter(function(p){ return p.id === v.driver_id; })[0]; v.driver_name = d ? (d.full_name || d.email) : v.driver_name; }
          if (!v.driver_name) return toast("Choose a driver or type a name", true);
          (h.id ? sb.from("drivers_hours").update(v).eq("id", h.id) : sb.from("drivers_hours").upsert(v, { onConflict:"driver_name,day" })).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Hours saved"); renderMain(); }); };
      });
    }).catch(fail);
  };
  var nb = root.querySelector("[data-new-hours]"); if (nb) nb.onclick = function(){ open(null); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-edit-hours]"), function(b){
    b.onclick = function(){ q(sb.from("drivers_hours").select("*").eq("id", Number(b.dataset.editHours))).then(function(r){ if (r[0]) open(r[0]); }).catch(fail); };
  });
};

// ---- stock
VIEWS.stock = function(){
  return q(sb.from("stock_items").select("*").order("sku")).then(function(all){
    var depots = []; all.forEach(function(s){ if (depots.indexOf(s.depot) < 0) depots.push(s.depot); });
    var rows = all.filter(function(s){ return (state.stockDepot === "all" || s.depot === state.stockDepot) && matches(s); });
    var low = all.filter(function(s){ return s.qty <= s.reorder_point; });
    return head("Stock","Stock on hand by depot. Every movement is recorded.", '<div class="actions"><button class="btn primary inline" type="button" data-new-item>Add item</button><button class="btn inline" type="button" data-csv="stock">Import CSV</button></div>') +
      '<div class="kpis">' + kpi("Stock lines", num(all.length), depots.length + " depot(s)") + kpi("At or below reorder", num(low.length), "Raise a purchase or transfer", low.length ? "bad" : "") +
      kpi("Units on hand", num(all.reduce(function(s, x){ return s + x.qty; }, 0)), "All depots") + '</div>' +
      '<div class="toolbar"><label>Depot <select id="stockDepot" class="input" style="width:auto"><option value="all">All depots</option>' + depots.map(function(d){ return '<option' + (state.stockDepot === d ? " selected" : "") + '>' + esc(d) + '</option>'; }).join("") + '</select></label></div>' +
      (rows.length ? '<div class="scroll"><table class="panel"><thead><tr><th>SKU</th><th>Item</th><th>Depot</th><th>Location</th><th class="right">On hand</th><th class="right">Reorder at</th><th>Status</th><th></th></tr></thead><tbody>' +
        rows.map(function(s){ var lowFlag = s.qty <= s.reorder_point;
          return '<tr><td class="mono">' + esc(s.sku) + exampleTag(s) + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.depot) + '</td><td>' + esc(s.location || "") + '</td><td class="right">' + num(s.qty) + '</td><td class="right">' + num(s.reorder_point) + '</td><td>' + (lowFlag ? pill("Reorder","bad") : pill("OK","ok")) + '</td>' +
            '<td><div class="row-actions"><button class="btn tiny" type="button" data-move="' + s.id + '">Move</button><button class="btn tiny" type="button" data-edit-item="' + s.id + '">Edit</button></div></td></tr>'; }).join("") + '</tbody></table></div>'
        : emptyCard("No stock lines yet. Add one or import a CSV."));
  });
};
BINDERS.stock = function(root){
  var sel = root.querySelector("#stockDepot"); if (sel) sel.onchange = function(){ state.stockDepot = sel.value; renderMain(); };
  var editItem = function(s){
    s = s || {};
    openModal('<h2>' + (s.id ? "Edit " + esc(s.sku) : "Add stock item") + '</h2><form id="sForm"><div class="form-grid">' +
      field("SKU","sku",s.sku,{required:true}) + field("Name","name",s.name,{required:true}) + field("Depot","depot",s.depot,{required:true}) + field("Location","location",s.location) +
      (s.id ? "" : field("Opening quantity","qty",0,{kind:"int"})) + field("Reorder point","reorder_point",s.reorder_point || 0,{kind:"int"}) +
      '</div><div class="actions"><button class="btn primary inline" type="submit">Save</button><button class="btn inline" type="button" data-close>Cancel</button></div></form>', function(m){
      m.querySelector("#sForm").onsubmit = function(e){ e.preventDefault(); var v = formValues(e.target);
        (s.id ? sb.from("stock_items").update(v).eq("id", s.id) : sb.from("stock_items").insert(v)).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Saved"); renderMain(); }); };
    });
  };
  var nb = root.querySelector("[data-new-item]"); if (nb) nb.onclick = function(){ editItem(null); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-edit-item]"), function(b){
    b.onclick = function(){ q(sb.from("stock_items").select("*").eq("id", Number(b.dataset.editItem))).then(function(r){ if (r[0]) editItem(r[0]); }).catch(fail); };
  });
  Array.prototype.forEach.call(root.querySelectorAll("[data-move]"), function(b){
    b.onclick = function(){ var id = Number(b.dataset.move);
      Promise.all([q(sb.from("stock_items").select("*").eq("id", id)), q(sb.from("stock_movements").select("*").eq("item_id", id).order("created_at", {ascending:false}).limit(10))]).then(function(a){
        var s = a[0][0]; if (!s) return;
        openModal('<h2>Stock movement · ' + esc(s.sku) + ' ' + esc(s.name) + '</h2><p class="note">On hand at ' + esc(s.depot) + ': ' + num(s.qty) + '. Use a positive number for goods in, negative for goods out.</p><form id="mForm"><div class="form-grid">' +
          field("Change (+/-)","change","",{kind:"int",required:true,placeholder:"e.g. 600 or -40"}) + field("Reason","reason","",{placeholder:"Inbound, picked, damaged…"}) +
          '</div><div class="actions"><button class="btn primary inline" type="submit">Record</button><button class="btn inline" type="button" data-close>Cancel</button></div></form>' +
          '<h3>Recent movements</h3>' + (a[1].length ? '<table><tbody>' + a[1].map(function(mv){ return '<tr><td>' + when(mv.created_at) + '</td><td class="right">' + (mv.change > 0 ? "+" : "") + mv.change + '</td><td>' + esc(mv.reason || "") + '</td></tr>'; }).join("") + '</tbody></table>' : '<p class="note">None yet.</p>'), function(m){
          m.querySelector("#mForm").onsubmit = function(e){ e.preventDefault(); var v = formValues(e.target);
            if (!v.change) return toast("Enter a non-zero number", true);
            sb.from("stock_movements").insert({ item_id:id, change:v.change, reason:v.reason, created_by:state.profile.id }).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Movement recorded"); renderMain(); }); };
        });
      }).catch(fail);
    };
  });
};

// ---- finance
VIEWS.finance = function(){
  return q(sb.from("jobs").select("ref,customer,status,rate_gbp,cost_gbp,example").limit(5000)).then(function(all){
    var billable = all.filter(function(j){ return j.status !== "Cancelled" && j.rate_gbp != null; });
    var rev = billable.reduce(function(s, j){ return s + Number(j.rate_gbp || 0); }, 0);
    var cost = billable.reduce(function(s, j){ return s + Number(j.cost_gbp || 0); }, 0);
    var byCust = {};
    billable.forEach(function(j){ var c = j.customer || "Unknown"; byCust[c] = byCust[c] || { rev:0, cost:0, n:0 }; byCust[c].rev += Number(j.rate_gbp || 0); byCust[c].cost += Number(j.cost_gbp || 0); byCust[c].n++; });
    var custRows = Object.keys(byCust).map(function(k){ return [k, byCust[k]]; }).sort(function(a, b){ return b[1].rev - a[1].rev; }).filter(function(r){ return matches({ c:r[0] }); });
    var thin = billable.filter(function(j){ return j.rate_gbp > 0 && (j.rate_gbp - (j.cost_gbp || 0)) / j.rate_gbp < 0.05; });
    return head("Finance","Revenue, cost and margin from job rates. Add rate and cost on each job or in the jobs CSV.") +
      '<div class="kpis">' + kpi("Revenue", gbp(rev), billable.length + " priced jobs") + kpi("Direct cost", gbp(cost), "Fuel, driver, tolls as entered") +
      kpi("Margin", gbp(rev - cost), rev ? ((rev - cost) / rev * 100).toFixed(1) + "%" : "—", rev && (rev - cost) / rev < 0.08 ? "warn" : "") + kpi("Jobs under 5% margin", num(thin.length), "Review pricing", thin.length ? "bad" : "") + '</div>' +
      (custRows.length ? '<section><h2>By customer</h2><div class="scroll"><table class="panel"><thead><tr><th>Customer</th><th class="right">Jobs</th><th class="right">Revenue</th><th class="right">Cost</th><th class="right">Margin</th></tr></thead><tbody>' +
        custRows.map(function(r){ var c = r[1], m = c.rev ? (c.rev - c.cost) / c.rev * 100 : 0; return '<tr><td>' + esc(r[0]) + '</td><td class="right">' + c.n + '</td><td class="right">' + gbp(c.rev) + '</td><td class="right">' + gbp(c.cost) + '</td><td class="right">' + pill(m.toFixed(1) + "%", m < 5 ? "bad" : m < 10 ? "watch" : "ok") + '</td></tr>'; }).join("") + '</tbody></table></div></section>'
        : emptyCard("No priced jobs yet."));
  });
};

// ---- AI control
VIEWS.ai = function(){
  return Promise.all([q(sb.from("ai_models").select("*").order("name")), q(sb.from("ai_decisions").select("*").order("created_at", {ascending:false}).limit(200))]).then(function(a){
    var models = a[0].filter(matches), dec = a[1].filter(matches);
    var pending = dec.filter(function(d){ return d.status === "pending"; }), done = dec.filter(function(d){ return d.status !== "pending"; });
    return head("AI control","Models propose; a named person approves. Every decision is written to the audit log.", '<div class="actions"><button class="btn inline" type="button" data-new-proposal>Add proposal</button></div>') +
      '<div class="alert info"><strong>How this works</strong> Models and integrations add proposals here. Nothing changes in the operation until someone with authority approves it. The legal hours guard is locked on and cannot be switched off.</div>' +
      '<section><h2>Approval queue <span class="note">(' + pending.length + ' waiting)</span></h2>' + decisionsList(pending, true) + '</section>' +
      '<section><h2>Models and gates</h2><div class="scroll"><table class="panel"><thead><tr><th>Model</th><th>Technique</th><th>Mode</th><th>Gate</th><th>Owner</th><th>Live</th></tr></thead><tbody>' +
        models.map(function(m){ return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.technique) + '</td><td>' + esc(m.mode) + '</td><td>' + esc(m.gate) + '</td><td>' + esc(m.owner) + '</td><td>' +
          (m.locked ? pill("Always on","ok") : (hasRole("admin") ? '<label><input type="checkbox" data-model="' + esc(m.id) + '"' + (m.live ? " checked" : "") + '> Live</label>' : pill(m.live ? "Live" : "Shadow", m.live ? "ok" : "watch"))) + '</td></tr>'; }).join("") + '</tbody></table></div></section>' +
      '<section><h2>Recent decisions</h2>' + (done.length ? decisionsList(done.slice(0, 30), false) : emptyCard("No decisions yet.")) + '</section>';
  });
};
BINDERS.ai = function(root){
  bindDecisions(root);
  Array.prototype.forEach.call(root.querySelectorAll("[data-model]"), function(c){
    c.onchange = function(){ sb.from("ai_models").update({ live:c.checked }).eq("id", c.dataset.model).then(function(res){ if (res.error) { c.checked = !c.checked; return fail(res.error); } toast("Model gate updated and logged"); }); };
  });
  var np = root.querySelector("[data-new-proposal]");
  if (np) np.onclick = function(){
    q(sb.from("ai_models").select("id,name")).then(function(models){
      openModal('<h2>Add a proposal</h2><p class="note">For proposals that come from outside the system (for example a telematics alert) so they can be approved and audited here.</p><form id="pForm"><div class="form-grid">' +
        field("Subject (job, vehicle or SKU)","subject","") + field("Model","model","",{options:models.map(function(m){ return [m.id, m.name]; }), blank:true}) +
        field("Proposal","proposal","",{required:true,full:true}) + field("Reason","reason","",{full:true}) +
        field("Confidence (0 to 1)","confidence","",{kind:"num"}) + field("Interval","confidence_interval","",{placeholder:"e.g. ETA 05:10-05:28 (90%)"}) + field("Owner","owner","") +
        '</div><div class="actions"><button class="btn primary inline" type="submit">Add to queue</button><button class="btn inline" type="button" data-close>Cancel</button></div></form>', function(m){
        m.querySelector("#pForm").onsubmit = function(e){ e.preventDefault(); var v = formValues(e.target);
          sb.from("ai_decisions").insert(v).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Proposal added"); renderMain(); }); };
      });
    }).catch(fail);
  };
};

// ---- board
VIEWS.board = function(){
  return q(sb.from("board_channels").select("*").order("sort")).then(function(channels){
    if (!channels.length) return head("Staff board","") + emptyCard("No channels yet. An admin can add them in Admin › Data.");
    if (!state.channel || !channels.some(function(c){ return c.id === state.channel; })) state.channel = channels[0].id;
    return q(sb.from("board_posts").select("*, board_replies(*)").eq("channel_id", state.channel).eq("removed", false).order("created_at", {ascending:false}).limit(100)).then(function(posts){
      var ch = channels.filter(function(c){ return c.id === state.channel; })[0];
      posts = posts.filter(function(p){ return matches({ a:p.author_name, b:p.body }); });
      return head("Staff board","Live conversations for depots, nights and safety. New posts appear for everyone straight away.") +
        '<div class="board"><div class="card channels"><h3>Channels</h3>' + channels.map(function(c){ return '<button type="button" data-channel="' + esc(c.id) + '"' + (c.id === state.channel ? ' aria-current="true"' : "") + '>' + esc(c.name) + '</button>'; }).join("") + '</div>' +
        '<div class="card thread"><h3>' + esc(ch.name) + '</h3>' +
        '<div class="composer" style="margin-top:0;padding-top:0;border-top:0"><textarea id="newPost" placeholder="Share an update with ' + esc(ch.name) + '" maxlength="4000"></textarea><button class="btn primary inline" id="postBtn" type="button">Post</button></div>' +
        (posts.length ? posts.map(function(p){
          var replies = (p.board_replies || []).sort(function(a, b){ return a.created_at < b.created_at ? -1 : 1; });
          var mine = p.author_id === state.profile.id, mod = hasRole("admin","duty");
          return '<article class="msg"><div class="by"><div class="avatar" style="width:32px;height:32px">' + esc(initials(p.author_name)) + '</div><div><strong>' + esc(p.author_name || "Unknown") + '</strong>' + exampleTag(p) + '<div class="note">' + esc(ROLE_LABEL[p.author_role] || p.author_role || "") + '</div></div><time>' + when(p.created_at) + '</time></div>' +
            '<p style="white-space:pre-wrap">' + esc(p.body) + '</p>' +
            replies.map(function(r){ return '<div class="reply"><strong>' + esc(r.author_name) + '</strong> <span class="note">' + when(r.created_at) + '</span><div style="white-space:pre-wrap">' + esc(r.body) + '</div></div>'; }).join("") +
            '<div class="actions" style="margin:8px 0 0"><button class="btn tiny" data-reply="' + p.id + '" type="button">Reply</button>' + (mine || mod ? '<button class="btn tiny" data-remove="' + p.id + '" type="button">Remove</button>' : "") + '</div>' +
            '<div class="composer hidden" id="reply-' + p.id + '"><textarea placeholder="Write a reply" maxlength="4000"></textarea><button class="btn primary inline" data-send-reply="' + p.id + '" type="button">Post reply</button></div></article>'; }).join("") : '<p class="note">No posts in this channel yet. Start the conversation.</p>') +
        '</div></div>';
    });
  });
};
BINDERS.board = function(root){
  Array.prototype.forEach.call(root.querySelectorAll("[data-channel]"), function(b){ b.onclick = function(){ state.channel = b.dataset.channel; renderMain(); }; });
  var pb = root.querySelector("#postBtn");
  if (pb) pb.onclick = function(){ var t = root.querySelector("#newPost"), body = t.value.trim(); if (!body) return; pb.disabled = true;
    sb.from("board_posts").insert({ channel_id:state.channel, body:body, author_id:state.profile.id }).then(function(res){ pb.disabled = false; if (res.error) return fail(res.error); t.value = ""; renderMain(); }); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-reply]"), function(b){ b.onclick = function(){ var c = root.querySelector("#reply-" + b.dataset.reply); c.classList.toggle("hidden"); var ta = c.querySelector("textarea"); if (ta) ta.focus(); }; });
  Array.prototype.forEach.call(root.querySelectorAll("[data-send-reply]"), function(b){ b.onclick = function(){ var t = root.querySelector("#reply-" + b.dataset.sendReply + " textarea"), body = t.value.trim(); if (!body) return; b.disabled = true;
    sb.from("board_replies").insert({ post_id:Number(b.dataset.sendReply), body:body, author_id:state.profile.id }).then(function(res){ b.disabled = false; if (res.error) return fail(res.error); t.value = ""; renderMain(); }); }; });
  Array.prototype.forEach.call(root.querySelectorAll("[data-remove]"), function(b){ b.onclick = function(){ if (!confirm("Remove this post from the board?")) return;
    sb.from("board_posts").update({ removed:true }).eq("id", Number(b.dataset.remove)).then(function(res){ if (res.error) return fail(res.error); toast("Post removed"); renderMain(); }); }; });
};

// ---- information
function renderArticle(text){
  var blocks = String(text || "").split(/\n\s*\n/), html = "";
  blocks.forEach(function(b){
    var lines = b.split("\n");
    if (lines.every(function(l){ return /^\s*[-*]\s+/.test(l); })) html += "<ul>" + lines.map(function(l){ return "<li>" + esc(l.replace(/^\s*[-*]\s+/, "")) + "</li>"; }).join("") + "</ul>";
    else html += "<p>" + esc(b).replace(/\n/g, "<br>") + "</p>";
  });
  return html;
}
VIEWS.info = function(){
  return q(sb.from("info_articles").select("*").order("sort")).then(function(arts){
    if (!state.info || !arts.some(function(a){ return a.slug === state.info; })) state.info = arts.length ? arts[0].slug : null;
    var art = arts.filter(function(a){ return a.slug === state.info; })[0];
    return head("Information","Company briefings: hours, the operator licence, AI policy, safety and data.", hasRole("admin") ? '<div class="actions"><button class="btn inline" type="button" data-new-article>New article</button></div>' : "") +
      (arts.length ? '<div class="info-wrap"><div class="toc">' + arts.map(function(a){ return '<button type="button" data-info="' + esc(a.slug) + '"' + (a.slug === state.info ? ' aria-current="true"' : "") + '>' + esc(a.title) + '</button>'; }).join("") + '</div>' +
        '<article class="card article"><h2>' + esc(art.title) + '</h2>' + renderArticle(art.body) + '<p class="note">Updated ' + when(art.updated_at) + '</p>' + (hasRole("admin") ? '<button class="btn tiny" type="button" data-edit-article="' + esc(art.slug) + '">Edit</button>' : "") + '</article></div>'
        : emptyCard("No articles yet."));
  });
};
BINDERS.info = function(root){
  Array.prototype.forEach.call(root.querySelectorAll("[data-info]"), function(b){ b.onclick = function(){ state.info = b.dataset.info; renderMain(); }; });
  var edit = function(a){
    a = a || {};
    openModal('<h2>' + (a.slug ? "Edit article" : "New article") + '</h2><p class="note">Plain text. Leave a blank line between paragraphs. Start a line with "- " for a bullet.</p><form id="aForm">' +
      (a.slug ? "" : field("Short id (no spaces)","slug","",{required:true})) + field("Title","title",a.title,{required:true}) + field("Body","body",a.body,{textarea:true}) + field("Order","sort",a.sort || 10,{kind:"int"}) +
      '<div class="actions"><button class="btn primary inline" type="submit">Save</button><button class="btn inline" type="button" data-close>Cancel</button>' + (a.slug ? '<button class="btn danger inline" type="button" data-del>Delete</button>' : "") + '</div></form>', function(m){
      var ta = m.querySelector("textarea"); if (ta) ta.style.minHeight = "260px";
      m.querySelector("#aForm").onsubmit = function(e){ e.preventDefault(); var v = formValues(e.target); v.updated_by = state.profile.id;
        (a.slug ? sb.from("info_articles").update(v).eq("slug", a.slug) : sb.from("info_articles").insert(v)).then(function(res){ if (res.error) return fail(res.error); if (v.slug) state.info = v.slug; closeModal(); toast("Article saved"); renderMain(); }); };
      var d = m.querySelector("[data-del]"); if (d) d.onclick = function(){ if (!confirm("Delete this article?")) return;
        sb.from("info_articles").delete().eq("slug", a.slug).then(function(res){ if (res.error) return fail(res.error); state.info = null; closeModal(); renderMain(); }); };
    });
  };
  var nb = root.querySelector("[data-new-article]"); if (nb) nb.onclick = function(){ edit(null); };
  var eb = root.querySelector("[data-edit-article]"); if (eb) eb.onclick = function(){ q(sb.from("info_articles").select("*").eq("slug", eb.dataset.editArticle)).then(function(r){ if (r[0]) edit(r[0]); }).catch(fail); };
};

// ---- admin
VIEWS.admin = function(){
  var tab = state.adminTab;
  var tabs = '<div class="tabs">' + [["members","Members"],["models","AI gates"],["data","Data and import"],["audit","Audit log"]].map(function(t){
    return '<button type="button" data-admin-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="true"' : "") + '>' + t[1] + '</button>'; }).join("") + '</div>';
  var top = head("Admin","Members, roles, AI gates, data import and the audit trail.") + tabs;
  if (tab === "members") {
    return q(sb.from("profiles").select("*").order("active").order("created_at", {ascending:false})).then(function(all){
      var pending = all.filter(function(p){ return !p.active; }), active = all.filter(function(p){ return p.active && matches(p); });
      var roleSel = function(p){ return '<select class="input" style="min-width:140px" data-role-for="' + p.id + '">' + Object.keys(ROLE_LABEL).map(function(k){ return '<option value="' + k + '"' + (p.role === k ? " selected" : "") + '>' + ROLE_LABEL[k] + '</option>'; }).join("") + '</select>'; };
      return top + '<section><h2>Waiting for approval <span class="note">(' + pending.length + ')</span></h2>' +
        (pending.length ? '<div class="rows">' + pending.map(function(p){ return '<div class="row"><div><h3>' + esc(p.full_name || p.email) + '</h3><p>' + esc(p.email) + ' · signed up ' + when(p.created_at) + '</p><div class="row-actions" style="margin-top:8px">' + roleSel(p) +
          '<input class="input" style="max-width:160px" placeholder="Depot" data-depot-for="' + p.id + '" value="' + esc(p.depot || "") + '"></div></div><div class="row-actions"><button class="btn tiny primary" type="button" data-approve="' + p.id + '">Approve</button><button class="btn tiny danger" type="button" data-reject="' + p.id + '">Delete</button></div></div>'; }).join("") + '</div>'
          : emptyCard("Nobody is waiting. New sign-ups appear here.")) + '</section>' +
        '<section><h2>Active members</h2><p class="intro">To invite someone, send them this page\u2019s link and ask them to tap Create account. They will appear above for approval.</p><div class="scroll"><table class="panel"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Depot</th><th>Title</th><th></th></tr></thead><tbody>' +
        active.map(function(p){ var me = p.id === state.profile.id; return '<tr><td>' + esc(p.full_name) + (me ? ' <span class="note">(you)</span>' : "") + '</td><td class="mono">' + esc(p.email) + '</td><td>' + roleSel(p) + '</td><td><input class="input" data-depot-for="' + p.id + '" value="' + esc(p.depot || "") + '"></td><td><input class="input" data-title-for="' + p.id + '" value="' + esc(p.title || "") + '"></td>' +
          '<td><div class="row-actions"><button class="btn tiny" type="button" data-save-member="' + p.id + '">Save</button>' + (me ? "" : '<button class="btn tiny danger" type="button" data-deactivate="' + p.id + '">Suspend</button>') + '</div></td></tr>'; }).join("") + '</tbody></table></div></section>';
    });
  }
  if (tab === "models") {
    return q(sb.from("ai_models").select("*").order("name")).then(function(models){
      return top + '<div class="scroll"><table class="panel"><thead><tr><th>System</th><th>Mode</th><th>Owner</th><th>Live on fleet</th></tr></thead><tbody>' + models.map(function(m){
        return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.mode) + '</td><td>' + esc(m.owner) + '</td><td>' + (m.locked ? "Always on (legal hours guard)" : '<label><input type="checkbox" data-model="' + esc(m.id) + '"' + (m.live ? " checked" : "") + '> Live</label>') + '</td></tr>'; }).join("") + '</tbody></table></div>';
    });
  }
  if (tab === "data") {
    return Promise.all([countQ(sb.from("jobs").select("id", {count:"exact", head:true}).eq("example", true)), countQ(sb.from("vehicles").select("id", {count:"exact", head:true}).eq("example", true))]).then(function(c){
      return top + '<section><h2>Import your real data (CSV)</h2><p class="intro">Export a spreadsheet as CSV (in Excel or Numbers: Share or Export › CSV), save it to Files, then choose it here. The first row must contain the column names below. Existing rows with the same key are updated.</p><div class="grid-2">' +
        Object.keys(CSV_DEFS).map(function(k){ var d = CSV_DEFS[k]; return '<div class="card"><h3>' + d.label + '</h3><div class="csv-help">' + Object.keys(d.cols).join(",") + '</div><p class="note">Required: ' + d.required.join(", ") + '. Matches existing rows on ' + d.conflict.replace(",", " + ") + '.</p><div class="actions"><button class="btn primary inline" type="button" data-csv="' + k + '">Import ' + d.label.toLowerCase() + '</button><button class="btn inline" type="button" data-template="' + k + '">Download template</button></div></div>'; }).join("") +
        '</div></section>' +
        '<section><h2>Example data</h2><p class="intro">The system started with made-up example rows (' + c[0] + ' jobs, ' + c[1] + ' vehicles still present). Remove them once your real data is in.</p><button class="btn danger inline" type="button" data-clear-example>Remove all example data</button></section>' +
        '<section><h2>Board channels</h2><button class="btn inline" type="button" data-new-channel>Add a channel</button></section>';
    });
  }
  return q(sb.from("audit_log").select("*").order("at", {ascending:false}).limit(300)).then(function(rows){
    rows = rows.filter(function(a){ return matches({ a:a.actor_name, b:a.action, c:a.entity, d:a.entity_id }); });
    return top + '<p class="intro">Append-only. Nobody, including admins, can edit or delete these entries. Times in Europe/London.</p>' +
      (rows.length ? '<div class="scroll"><table class="panel"><thead><tr><th>When</th><th>Who</th><th>Event</th><th>Record</th></tr></thead><tbody>' + rows.map(function(a){
        return '<tr><td class="mono">' + when(a.at) + '</td><td>' + esc(a.actor_name) + '</td><td>' + esc(a.action) + '</td><td class="mono">' + esc((a.entity || "") + (a.entity_id ? " " + String(a.entity_id).slice(0, 12) : "")) + '</td></tr>'; }).join("") + '</tbody></table></div>' : emptyCard("No audit events yet."));
  });
};
BINDERS.admin = function(root){
  Array.prototype.forEach.call(root.querySelectorAll("[data-admin-tab]"), function(b){ b.onclick = function(){ state.adminTab = b.dataset.adminTab; renderMain(); }; });
  var val = function(attr, id){ var el = root.querySelector("[" + attr + '="' + id + '"]'); return el ? (el.value.trim() || null) : undefined; };
  var upd = function(id, patch, msg){ sb.from("profiles").update(patch).eq("id", id).then(function(res){ if (res.error) return fail(res.error); toast(msg); renderMain(); }); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-approve]"), function(b){ b.onclick = function(){ var id = b.dataset.approve; upd(id, { active:true, role:val("data-role-for", id), depot:val("data-depot-for", id) }, "Member approved"); }; });
  Array.prototype.forEach.call(root.querySelectorAll("[data-save-member]"), function(b){ b.onclick = function(){ var id = b.dataset.saveMember; upd(id, { role:val("data-role-for", id), depot:val("data-depot-for", id), title:val("data-title-for", id) }, "Member updated"); }; });
  Array.prototype.forEach.call(root.querySelectorAll("[data-deactivate]"), function(b){ b.onclick = function(){ if (!confirm("Suspend this member? They will lose access until approved again.")) return; upd(b.dataset.deactivate, { active:false }, "Member suspended"); }; });
  Array.prototype.forEach.call(root.querySelectorAll("[data-reject]"), function(b){ b.onclick = function(){ if (!confirm("Delete this sign-up request?")) return;
    sb.from("profiles").delete().eq("id", b.dataset.reject).then(function(res){ if (res.error) return fail(res.error); toast("Request deleted. To fully remove the login, delete the user in Supabase › Authentication."); renderMain(); }); }; });
  Array.prototype.forEach.call(root.querySelectorAll("[data-model]"), function(c){
    c.onchange = function(){ sb.from("ai_models").update({ live:c.checked }).eq("id", c.dataset.model).then(function(res){ if (res.error) { c.checked = !c.checked; return fail(res.error); } toast("Model gate updated and logged"); }); };
  });
  Array.prototype.forEach.call(root.querySelectorAll("[data-template]"), function(b){ b.onclick = function(){ var d = CSV_DEFS[b.dataset.template];
    var blob = new Blob([Object.keys(d.cols).join(",") + "\n"], { type:"text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "northline-" + b.dataset.template + "-template.csv"; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000); }; });
  var ce = root.querySelector("[data-clear-example]");
  if (ce) ce.onclick = function(){ if (!confirm("Remove every example row (jobs, vehicles, stock, hours, example posts and proposals)? Your own data is kept.")) return;
    sb.rpc("clear_example_data").then(function(res){ if (res.error) return fail(res.error); toast("Example data removed"); renderMain(); }); };
  var nc = root.querySelector("[data-new-channel]");
  if (nc) nc.onclick = function(){ openModal('<h2>Add a channel</h2><form id="cForm">' + field("Name","name","",{required:true}) + field("Order","sort",10,{kind:"int"}) + '<div class="actions"><button class="btn primary inline" type="submit">Add</button><button class="btn inline" type="button" data-close>Cancel</button></div></form>', function(m){
    m.querySelector("#cForm").onsubmit = function(e){ e.preventDefault(); var v = formValues(e.target); v.id = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || ("c" + Date.now());
      sb.from("board_channels").insert(v).then(function(res){ if (res.error) return fail(res.error); closeModal(); toast("Channel added"); }); }; }); };
};

// ------------------------------------------------------------------ CSV import
function parseCSV(text){
  text = String(text).replace(/^\uFEFF/, "");
  var rows = [], row = [], cell = "", inQ = false, i, c;
  var delim = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (i = 0; i < text.length; i++) {
    c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function(r){ return r.some(function(x){ return String(x).trim() !== ""; }); });
}
function toISODate(s){
  s = String(s).trim(); if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); // UK day/month/year
  if (m) { var y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
  return undefined;
}
function coerceRows(kind, grid){
  var def = CSV_DEFS[kind], errors = [], out = [];
  if (!grid.length) return { rows:[], errors:["The file is empty."] };
  var header = grid[0].map(function(h){ return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); });
  var missing = def.required.filter(function(r){ return header.indexOf(r) < 0; });
  if (missing.length) return { rows:[], errors:["Missing required column(s): " + missing.join(", ") + ". First row must be: " + Object.keys(def.cols).join(",")] };
  var ignored = header.filter(function(h){ return h && !def.cols[h]; });
  grid.slice(1).forEach(function(r, idx){
    var o = {}, bad = [];
    header.forEach(function(h, j){
      var type = def.cols[h]; if (!type) return;
      var raw = r[j] == null ? "" : String(r[j]).trim(), v;
      if (raw === "") v = null;
      else if (type === "int") { v = parseInt(raw.replace(/[, ]/g, ""), 10); if (isNaN(v)) bad.push(h); }
      else if (type === "num") { v = Number(raw.replace(/[£, ]/g, "")); if (isNaN(v)) bad.push(h); }
      else if (type === "date") { v = toISODate(raw); if (v === undefined) bad.push(h); }
      else v = raw;
      o[h] = v;
    });
    def.required.forEach(function(k){ if (o[k] == null) bad.push(k + " (empty)"); });
    if (kind === "vehicles" && o.reg) o.reg = o.reg.toUpperCase();
    // blank cells in NOT NULL columns: drop the key so the database default applies (defaultToNull:false below)
    ["status","qty","reorder_point"].forEach(function(k){ if (k in o && o[k] == null) delete o[k]; });
    if (bad.length) errors.push("Row " + (idx + 2) + ": check " + bad.join(", ")); else out.push(o);
  });
  // de-duplicate on the conflict key (last row wins) so one upsert batch never hits the same key twice
  var keys = def.conflict.split(","), seen = {}, dedup = [];
  out.forEach(function(o){ seen[keys.map(function(k){ return String(o[k]).toLowerCase(); }).join("|")] = o; });
  Object.keys(seen).forEach(function(k){ dedup.push(seen[k]); });
  return { rows:dedup, errors:errors, ignored:ignored };
}
function openCsvImport(kind){
  var def = CSV_DEFS[kind];
  if (!hasRole.apply(null, def.roles)) return toast("Your role cannot import " + def.label.toLowerCase(), true);
  openModal('<h2>Import ' + esc(def.label.toLowerCase()) + ' from CSV</h2><p class="note">First row: column names. Dates as YYYY-MM-DD or DD/MM/YYYY.</p><div class="csv-help">' + Object.keys(def.cols).join(",") + '</div>' +
    '<label class="field" style="margin-top:12px"><span>Choose a CSV file</span><input class="input" type="file" id="csvFile" accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"></label>' +
    '<div id="csvPreview"></div><div class="actions"><button class="btn primary inline" type="button" id="csvGo" disabled>Import</button><button class="btn inline" type="button" data-close>Cancel</button></div>', function(m){
    var parsed = null;
    m.querySelector("#csvFile").onchange = function(e){
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function(){
        parsed = coerceRows(kind, parseCSV(reader.result));
        var html = '<p><strong>' + parsed.rows.length + '</strong> row(s) ready to import.</p>';
        if (parsed.ignored && parsed.ignored.length) html += '<p class="note">Ignored columns: ' + esc(parsed.ignored.join(", ")) + '</p>';
        if (parsed.errors.length) html += '<div class="alert warn"><strong>' + parsed.errors.length + ' row(s) skipped</strong> ' + parsed.errors.slice(0, 8).map(esc).join("<br>") + (parsed.errors.length > 8 ? "<br>…" : "") + '</div>';
        if (parsed.rows.length) html += '<div class="scroll"><table><thead><tr>' + Object.keys(parsed.rows[0]).map(function(k){ return "<th>" + esc(k) + "</th>"; }).join("") + '</tr></thead><tbody>' + parsed.rows.slice(0, 5).map(function(r){ return "<tr>" + Object.keys(parsed.rows[0]).map(function(k){ return "<td>" + esc(r[k] == null ? "" : r[k]) + "</td>"; }).join("") + "</tr>"; }).join("") + '</tbody></table></div>';
        m.querySelector("#csvPreview").innerHTML = html;
        m.querySelector("#csvGo").disabled = !parsed.rows.length;
      };
      reader.onerror = function(){ toast("Could not read that file", true); };
      reader.readAsText(f);
    };
    m.querySelector("#csvGo").onclick = function(){
      var btn = this; if (!parsed || !parsed.rows.length) return; btn.disabled = true; btn.textContent = "Importing…";
      var batches = [], size = 500, done = 0;
      for (var i = 0; i < parsed.rows.length; i += size) batches.push(parsed.rows.slice(i, i + size));
      var next = function(){
        if (!batches.length) {
          sb.rpc("log_audit", { p_action:"CSV import", p_entity:def.table, p_detail:{ rows:done, skipped:parsed.errors.length } }).then(function(){});
          closeModal(); toast("Imported " + done + " " + def.label.toLowerCase()); renderMain(); return;
        }
        var b = batches.shift();
        sb.from(def.table).upsert(b, { onConflict:def.conflict, defaultToNull:false }).then(function(res){
          if (res.error) { btn.disabled = false; btn.textContent = "Import"; return fail(res.error); }
          done += b.length; next();
        });
      };
      next();
    };
  });
}
window.NorthlineCSV = { parseCSV:parseCSV, coerceRows:coerceRows, toISODate:toISODate };

// ------------------------------------------------------------------ global events
function bindGlobal(){
  $("sidebar").addEventListener("click", function(e){ var b = e.target.closest("[data-view]"); if (b) go(b.dataset.view); });
  $("main").addEventListener("click", function(e){
    var g = e.target.closest("[data-go]"); if (g) return go(g.dataset.go);
    var c = e.target.closest("[data-csv]"); if (c) return openCsvImport(c.dataset.csv);
    if (e.target.closest("[data-reload]")) renderMain();
  });
  $("modal").addEventListener("click", function(e){ if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeModal(); });
  $("menuBtn").onclick = function(){ document.body.classList.toggle("nav-open"); };
  $("overlay").onclick = function(){ document.body.classList.remove("nav-open"); };
  $("signOutBtn").onclick = signOut;
  var st = null;
  $("search").addEventListener("input", function(e){ clearTimeout(st); st = setTimeout(function(){ state.search = e.target.value; renderMain(); }, 250); });
  var tick = function(){ try { $("clock").textContent = new Date().toLocaleString("en-GB", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit", timeZone:"Europe/London" }) + " · UK"; } catch (err) {} };
  tick(); setInterval(tick, 30000);
  // iOS Safari pauses sockets in the background; refresh when the app comes back
  document.addEventListener("visibilitychange", function(){ if (!document.hidden && document.body.classList.contains("app-on")) renderMain(); });
}

// ------------------------------------------------------------------ boot
function boot(){
  if (configMissing()) return showNotConnected("The connection settings (config.js) still contain placeholders.");
  if (!window.supabase || !window.supabase.createClient) return showNotConnected("The secure connection library could not be loaded. Check your internet connection and reload the page.");
  try {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
  } catch (err) { return showNotConnected("The connection settings look invalid: " + friendlyError(err)); }
  bindGlobal();
  if (/type=recovery/.test(location.hash)) state.recovery = true;
  sb.auth.onAuthStateChange(function(event, session){
    if (event === "PASSWORD_RECOVERY") { state.recovery = true; state.session = session; return showLogin(); }
    if (event === "SIGNED_OUT") return afterSession(null);
    if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
      // defer so we never call Supabase inside the auth callback (avoids a known deadlock)
      setTimeout(function(){ if (!session) return afterSession(null); if (!state.profile || !document.body.classList.contains("app-on") || event === "USER_UPDATED") afterSession(session); else state.session = session; }, 0);
    }
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
