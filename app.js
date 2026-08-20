(function () {
  "use strict";

  var CONFIG = window.APP_CONFIG || {};
  var QUEUE_KEY = "foton_pending_entries_v1";
  var CACHE_META_KEY = "foton_meta_cache_v1";
  var CACHE_REPORT_KEY = "foton_report_cache_v1";
  var CACHE_AGENT_KEY = "foton_last_agent_v1";

  var DEFAULT_META = {
    agenti: Array.from({ length: 15 }, function (_, i) { return "Agent " + (i + 1); }),
    judete: ["Alba","Arad","Arges","Bacau","Bihor","Bistrita-Nasaud","Botosani","Braila","Brasov","Buzau",
      "Calarasi","Caras-Severin","Cluj","Constanta","Covasna","Dambovita","Dolj","Galati","Giurgiu","Gorj",
      "Harghita","Hunedoara","Ialomita","Iasi","Ilfov","Maramures","Mehedinti","Mures","Neamt","Olt","Prahova",
      "Salaj","Satu Mare","Sibiu","Suceava","Teleorman","Timis","Tulcea","Vaslui","Valcea","Vrancea","Bucuresti"],
    statusuri: ["De contactat","Contactat - interesat","Contactat - neinteresat","Intalnire programata",
      "Oferta trimisa","In negociere","Contract semnat","Respins","Amanat"],
    potential: ["Ridicat","Mediu","Scazut"],
  };

  var $ = function (id) { return document.getElementById(id); };

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function fillSelect(select, options, placeholder) {
    select.innerHTML = "";
    if (placeholder) {
      var ph = document.createElement("option");
      ph.value = "";
      ph.textContent = placeholder;
      select.appendChild(ph);
    }
    options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
  }

  function apiUrl(params) {
    var base = CONFIG.API_URL || "";
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + qs;
  }

  function isConfigured() {
    return CONFIG.API_URL && CONFIG.API_URL.indexOf("PUNE_AICI") === -1;
  }

  // ---------------------------------------------------------------------
  // META (dropdown lists)
  // ---------------------------------------------------------------------
  function applyMeta(meta) {
    fillSelect($("f_agent"), meta.agenti, "Selecteaza agentul");
    fillSelect($("f_judet"), meta.judete, "Selecteaza judetul");
    fillSelect($("f_status"), meta.statusuri, "Selecteaza status");
    fillSelect($("f_potential"), meta.potential, "-");
    var lastAgent = localStorage.getItem(CACHE_AGENT_KEY);
    if (lastAgent) $("f_agent").value = lastAgent;
  }

  function loadMeta() {
    var cached = localStorage.getItem(CACHE_META_KEY);
    applyMeta(cached ? JSON.parse(cached) : DEFAULT_META);

    if (!isConfigured()) return;
    fetch(apiUrl({ action: "meta", token: CONFIG.APP_TOKEN }))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.meta) {
          localStorage.setItem(CACHE_META_KEY, JSON.stringify(data.meta));
          applyMeta(data.meta);
        }
      })
      .catch(function () { /* keep cached/default meta, likely offline */ });
  }

  // ---------------------------------------------------------------------
  // FORM SUBMIT + OFFLINE QUEUE
  // ---------------------------------------------------------------------
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

  function readForm() {
    return {
      agent: $("f_agent").value,
      data: $("f_date").value,
      dealer: $("f_dealer").value.trim(),
      contact: $("f_contact").value.trim(),
      telefon: $("f_telefon").value.trim(),
      email: $("f_email").value.trim(),
      judet: $("f_judet").value,
      localitate: $("f_localitate").value.trim(),
      status: $("f_status").value,
      potential: $("f_potential").value,
      nextAction: $("f_next_action").value.trim(),
      nextActionDate: $("f_next_date").value,
      observatii: $("f_obs").value.trim(),
      clientTs: Date.now(),
    };
  }

  function sendEntry(entry) {
    return fetch(apiUrl({ action: "add", token: CONFIG.APP_TOKEN }), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight to Apps Script
      body: JSON.stringify(entry),
    }).then(function (r) { return r.json(); });
  }

  function flushQueue() {
    var q = getQueue();
    if (!q.length || !isConfigured()) return;
    var remaining = [];
    var chain = Promise.resolve();
    q.forEach(function (entry) {
      chain = chain.then(function () {
        return sendEntry(entry).then(function (res) {
          if (!res || !res.ok) remaining.push(entry);
        }).catch(function () {
          remaining.push(entry);
        });
      });
    });
    chain.then(function () {
      saveQueue(remaining);
      updateOfflineBadge();
    });
  }

  function updateOfflineBadge() {
    var q = getQueue();
    var badge = $("offlineBadge");
    if (q.length > 0) {
      badge.hidden = false;
      badge.textContent = q.length + " discutie(i) nesalvate inca - se trimit automat cand revine internetul";
    } else {
      badge.hidden = true;
    }
  }

  function resetFormKeepAgent() {
    var agent = $("f_agent").value;
    $("entryForm").reset();
    $("f_date").value = todayISO();
    $("f_agent").value = agent;
  }

  function handleSubmit(evt) {
    evt.preventDefault();
    var entry = readForm();
    if (!entry.agent || !entry.dealer || !entry.judet || !entry.status || !entry.data) {
      showMsg("Completeaza campurile obligatorii (*).", "err");
      return;
    }
    localStorage.setItem(CACHE_AGENT_KEY, entry.agent);
    var btn = $("submitBtn");
    btn.disabled = true;

    if (!isConfigured()) {
      var q = getQueue();
      q.push(entry);
      saveQueue(q);
      updateOfflineBadge();
      showMsg("Aplicatia inca nu e configurata (config.js) - discutia a fost pastrata local.", "pending");
      resetFormKeepAgent();
      btn.disabled = false;
      return;
    }

    sendEntry(entry).then(function (res) {
      btn.disabled = false;
      if (res && res.ok) {
        showMsg("Discutie salvata cu succes.", "ok");
        resetFormKeepAgent();
      } else {
        throw new Error((res && res.error) || "eroare necunoscuta");
      }
    }).catch(function () {
      var q = getQueue();
      q.push(entry);
      saveQueue(q);
      updateOfflineBadge();
      showMsg("Fara conexiune - discutia a fost salvata pe telefon si se va trimite automat.", "pending");
      resetFormKeepAgent();
      btn.disabled = false;
    });
  }

  function showMsg(text, cls) {
    var el = $("formMsg");
    el.textContent = text;
    el.className = "form-msg " + cls;
    setTimeout(function () {
      if (el.textContent === text) el.textContent = "";
    }, 6000);
  }

  // ---------------------------------------------------------------------
  // REPORT
  // ---------------------------------------------------------------------
  function bar(row, label, count, max, cls) {
    var pct = max > 0 ? Math.round((count / max) * 100) : 0;
    var wrap = document.createElement("div");
    wrap.className = "bar-row";
    wrap.innerHTML =
      '<div class="bar-row-top"><span>' + escapeHtml(label) + '</span><span class="bar-count">' + count + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill' + (cls ? " " + cls : "") + '" style="width:' + pct + '%"></div></div>';
    row.appendChild(wrap);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderReport(data) {
    $("kpiGrid").innerHTML =
      kpiTile("Total discutii", data.total, "blue") +
      kpiTile("Contracte semnate", data.semnate, "good") +
      kpiTile("Actiuni restante", data.restante, "critical") +
      kpiTile("Dealeri respinsi", data.respinse, "muted");

    var statusEl = $("statusBars"); statusEl.innerHTML = "";
    var maxStatus = Math.max.apply(null, data.byStatus.map(function (s) { return s.count; }).concat([1]));
    if (data.byStatus.every(function (s) { return s.count === 0; })) {
      statusEl.innerHTML = '<div class="empty-note">Inca nu exista discutii introduse.</div>';
    } else {
      data.byStatus.forEach(function (s) { bar(statusEl, s.status, s.count, maxStatus); });
    }

    var agentEl = $("agentBars"); agentEl.innerHTML = "";
    var maxAgent = Math.max.apply(null, data.byAgent.map(function (a) { return a.count; }).concat([1]));
    var activeAgents = data.byAgent.filter(function (a) { return a.count > 0; });
    if (!activeAgents.length) {
      agentEl.innerHTML = '<div class="empty-note">Inca nu exista discutii introduse.</div>';
    } else {
      activeAgents.sort(function (a, b) { return b.count - a.count; })
        .forEach(function (a) { bar(agentEl, a.agent, a.count, maxAgent); });
    }

    var geoEl = $("geoBars"); geoEl.innerHTML = "";
    var topGeo = data.byJudet.filter(function (j) { return j.count > 0; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 10);
    var maxGeo = Math.max.apply(null, topGeo.map(function (j) { return j.count; }).concat([1]));
    if (!topGeo.length) {
      geoEl.innerHTML = '<div class="empty-note">Inca nu exista discutii introduse.</div>';
    } else {
      topGeo.forEach(function (j) { bar(geoEl, j.judet, j.count, maxGeo); });
    }

    var restEl = $("restanteList"); restEl.innerHTML = "";
    if (!data.restanteList.length) {
      restEl.innerHTML = '<div class="empty-note">Nicio actiune restanta - foarte bine!</div>';
    } else {
      data.restanteList.forEach(function (r) {
        var item = document.createElement("div");
        item.className = "restanta-item";
        item.innerHTML =
          '<div class="r-top"><span>' + escapeHtml(r.agent) + ' &middot; ' + escapeHtml(r.dealer) + '</span>' +
          '<span class="r-days">' + r.zileIntarziere + ' zile</span></div>' +
          '<div class="r-sub">' + escapeHtml(r.judet) + (r.telefon ? " &middot; " + escapeHtml(r.telefon) : "") + '</div>' +
          (r.observatii ? '<div class="r-obs">' + escapeHtml(r.observatii) + '</div>' : "");
        restEl.appendChild(item);
      });
    }
  }

  function kpiTile(label, value, cls) {
    return '<div class="kpi-tile"><div class="kpi-label">' + escapeHtml(label) + '</div>' +
      '<div class="kpi-value ' + cls + '">' + value + '</div></div>';
  }

  function loadReport(forceRefresh) {
    var cached = localStorage.getItem(CACHE_REPORT_KEY);
    if (cached && !forceRefresh) {
      var parsed = JSON.parse(cached);
      renderReport(parsed.data);
      $("reportUpdated").textContent = "Ultima actualizare: " + new Date(parsed.ts).toLocaleString("ro-RO");
    }
    if (!isConfigured()) {
      if (!cached) $("reportUpdated").textContent = "Configureaza config.js pentru a vedea raportul live.";
      return;
    }
    $("reportUpdated").textContent = "Se incarca...";
    fetch(apiUrl({ action: "report", token: CONFIG.APP_TOKEN }))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error("raspuns invalid");
        renderReport(res.data);
        localStorage.setItem(CACHE_REPORT_KEY, JSON.stringify({ data: res.data, ts: Date.now() }));
        $("reportUpdated").textContent = "Actualizat acum";
      })
      .catch(function () {
        $("reportUpdated").textContent = cached
          ? "Fara conexiune - se afiseaza ultimul raport salvat"
          : "Fara conexiune si niciun raport salvat local";
      });
  }

  // ---------------------------------------------------------------------
  // TABS
  // ---------------------------------------------------------------------
  function showTab(tab) {
    var isForm = tab === "form";
    $("view-form").hidden = !isForm;
    $("view-report").hidden = isForm;
    $("tabFormBtn").classList.toggle("active", isForm);
    $("tabReportBtn").classList.toggle("active", !isForm);
    if (!isForm) loadReport(false);
  }

  // ---------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------
  function init() {
    $("appTitle").textContent = CONFIG.APP_NAME || "Raportare Agenti Foton";
    $("f_date").value = todayISO();
    loadMeta();
    updateOfflineBadge();

    $("entryForm").addEventListener("submit", handleSubmit);
    $("tabFormBtn").addEventListener("click", function () { showTab("form"); });
    $("tabReportBtn").addEventListener("click", function () { showTab("report"); });
    $("refreshBtn").addEventListener("click", function () { loadReport(true); });

    window.addEventListener("online", flushQueue);
    flushQueue();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
