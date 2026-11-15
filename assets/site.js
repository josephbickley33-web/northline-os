/* Northline website: mobile menu and the "Book a demo" form. No cookies, no analytics. */
(function(){
  "use strict";
  var site = window.NORTHLINE_SITE || {}, cfg = window.NORTHLINE_CONFIG || {};
  var nav = document.getElementById("nav"), t = document.getElementById("menuToggle");
  if (t) t.onclick = function(){ var open = nav.classList.toggle("open"); t.setAttribute("aria-expanded", open ? "true" : "false"); };
  Array.prototype.forEach.call(document.querySelectorAll(".nav-links a"), function(a){ a.addEventListener("click", function(){ nav.classList.remove("open"); }); });
  if (site.COMPANY_LINE) { var cl = document.getElementById("companyLine"); if (cl) cl.textContent = site.COMPANY_LINE; }

  var form = document.getElementById("leadForm"); if (!form) return;
  var msg = document.getElementById("leadMsg"), btn = document.getElementById("leadBtn");
  function say(html, tone){ msg.innerHTML = html; msg.className = "form-msg " + (tone || ""); }
  function esc(s){ return String(s || "").replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
  function mailtoFor(v){
    if (!site.CONTACT_EMAIL) return "";
    var body = "Name: " + v.name + "\nCompany: " + (v.company || "") + "\nEmail: " + v.email + "\nPhone: " + (v.phone || "") + "\nFleet size: " + (v.fleet_size || "") + "\n\n" + (v.message || "");
    return "mailto:" + site.CONTACT_EMAIL + "?subject=" + encodeURIComponent("Northline demo request") + "&body=" + encodeURIComponent(body);
  }
  function fallback(v, why){
    var m = mailtoFor(v);
    say(esc(why) + (m ? ' You can <a href="' + esc(m) + '">send it by email instead</a>.' : " Please try again in a few minutes."), "err");
  }
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var fd = new FormData(form), v = {};
    ["name","company","email","phone","fleet_size","message","website"].forEach(function(k){ v[k] = String(fd.get(k) || "").trim(); });
    if (v.website) { say("Thanks, we'll be in touch.", "ok"); form.reset(); return; } // bot trap
    if (!v.name) return say("Please add your name.", "err");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return say("Please check your email address.", "err");
    var row = { name:v.name, email:v.email, company:v.company || null, phone:v.phone || null, fleet_size:v.fleet_size || null, message:v.message || null, source:"website" };
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /YOUR_|PLACEHOLDER/i.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) return fallback(v, "The online form is not connected yet.");
    btn.disabled = true; say("Sending…");
    fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/leads", {
      method:"POST",
      headers:{ "apikey":cfg.SUPABASE_ANON_KEY, "Authorization":"Bearer " + cfg.SUPABASE_ANON_KEY, "Content-Type":"application/json", "Prefer":"return=minimal" },
      body:JSON.stringify(row)
    }).then(function(r){
      btn.disabled = false;
      if (r.ok) { form.reset(); say("Thanks, " + esc(v.name.split(" ")[0]) + ". Your request has been received and we'll reply by email.", "ok"); }
      else fallback(v, "Sorry, the form could not be sent.");
    }).catch(function(){ btn.disabled = false; fallback(v, "Sorry, the form could not be sent (no connection)."); });
  });
})();
