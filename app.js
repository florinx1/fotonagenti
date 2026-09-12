(function () {
  "use strict";

  var CONFIG = window.APP_CONFIG || {};
  var QUEUE_KEY = "foton_pending_entries_v1";
  var QUEUE_PUNCT_KEY = "foton_pending_puncte_v1";
  var CACHE_META_KEY = "foton_meta_cache_v1";
  var CACHE_REPORT_KEY = "foton_report_cache_v1";
  var CACHE_AGENT_KEY = "foton_last_agent_v1";
  var CACHE_DEALERS_KEY = "foton_dealer_index_v1";
  var CACHE_FISE_KEY = "foton_fise_cache_v1";

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

  var lastDiscutii = [];
  var lastDiscutiiTotal = 0;
  var lastPuncte = [];
  var lastFise = [];
  var dealerIndex = [];
  var editingKey = null; // normalized dealer key of the discussion currently being edited, or null when adding new

  // Coordonate aproximative (resedinta de judet) pentru harta interactiva din Raport.
  var JUDET_COORDS = {
    "Alba": [46.0697, 23.5804], "Arad": [46.1866, 21.3123], "Arges": [44.8565, 24.8692],
    "Bacau": [46.5670, 26.9146], "Bihor": [47.0465, 21.9189], "Bistrita-Nasaud": [47.1330, 24.5000],
    "Botosani": [47.7486, 26.6690], "Braila": [45.2692, 27.9575], "Brasov": [45.6427, 25.5887],
    "Buzau": [45.1500, 26.8333], "Calarasi": [44.2058, 27.3306], "Caras-Severin": [45.3000, 21.8833],
    "Cluj": [46.7712, 23.6236], "Constanta": [44.1733, 28.6383], "Covasna": [45.8667, 26.1833],
    "Dambovita": [44.9333, 25.4500], "Dolj": [44.3167, 23.8000], "Galati": [45.4353, 28.0080],
    "Giurgiu": [43.9037, 25.9699], "Gorj": [45.0333, 23.2833], "Harghita": [46.3597, 25.8017],
    "Hunedoara": [45.7500, 22.9000], "Ialomita": [44.5833, 27.3833], "Iasi": [47.1585, 27.6014],
    "Ilfov": [44.5000, 26.1000], "Maramures": [47.6567, 23.5825], "Mehedinti": [44.6333, 22.6500],
    "Mures": [46.5425, 24.5575], "Neamt": [46.9333, 26.3667], "Olt": [44.4333, 24.3667],
    "Prahova": [44.9333, 26.0333], "Salaj": [47.1833, 23.0500], "Satu Mare": [47.7920, 22.8850],
    "Sibiu": [45.7983, 24.1256], "Suceava": [47.6500, 26.2500], "Teleorman": [43.9000, 25.3333],
    "Timis": [45.7472, 21.2306], "Tulcea": [45.1667, 28.8000], "Vaslui": [46.6333, 27.7333],
    "Valcea": [45.1000, 24.3667], "Vrancea": [45.7000, 27.1833], "Bucuresti": [44.4268, 26.1025],
  };

  function normalizeDealerJS(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[.,]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findDuplicateLocal(dealerName) {
    var target = normalizeDealerJS(dealerName);
    if (!target) return null;
    for (var i = 0; i < dealerIndex.length; i++) {
      if (normalizeDealerJS(dealerIndex[i].dealer) === target) return dealerIndex[i];
    }
    return null;
  }

  function addToDealerIndexCache(dealer, agent, data) {
    dealerIndex.push({ dealer: dealer, agent: agent, data: data || "" });
    localStorage.setItem(CACHE_DEALERS_KEY, JSON.stringify(dealerIndex));
    refreshDealerDatalist();
  }

  function updateDealerIndexCache(dealer, agent, data) {
    var key = normalizeDealerJS(dealer);
    for (var i = 0; i < dealerIndex.length; i++) {
      if (normalizeDealerJS(dealerIndex[i].dealer) === key) {
        dealerIndex[i] = { dealer: dealer, agent: agent, data: data || "" };
        localStorage.setItem(CACHE_DEALERS_KEY, JSON.stringify(dealerIndex));
        refreshDealerDatalist();
        return;
      }
    }
    addToDealerIndexCache(dealer, agent, data);
  }

  // Populeaza <datalist id="dealerList"> (folosita de campul "Dealer / Firma" din
  // formularul de puncte de lucru) din acelasi index de dealeri ca formularul principal.
  function refreshDealerDatalist() {
    var list = $("dealerList");
    if (!list) return;
    var seen = {};
    var html = "";
    dealerIndex.forEach(function (d) {
      var key = normalizeDealerJS(d.dealer);
      if (!key || seen[key]) return;
      seen[key] = true;
      html += '<option value="' + escapeHtml(d.dealer) + '"></option>';
    });
    list.innerHTML = html;
  }

  function checkDealerWarning() {
    var name = $("f_dealer").value.trim();
    var warnEl = $("dealerWarning");
    var dup = findDuplicateLocal(name);
    if (dup) {
      warnEl.textContent = "Atentie: acest dealer a fost deja contactat de " + dup.agent +
        (dup.data ? " (" + dup.data + ")" : "") + ".";
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
      warnEl.textContent = "";
    }
    return dup;
  }

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
    fillSelect($("p_judet"), meta.judete, "Selecteaza judetul");
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

  function loadDealerIndex() {
    var cached = localStorage.getItem(CACHE_DEALERS_KEY);
    if (cached) {
      try { dealerIndex = JSON.parse(cached); } catch (e) { dealerIndex = []; }
    }
    if (!isConfigured()) return;
    fetch(apiUrl({ action: "dealeri", token: CONFIG.APP_TOKEN }))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.dealeri) {
          dealerIndex = data.dealeri;
          localStorage.setItem(CACHE_DEALERS_KEY, JSON.stringify(dealerIndex));
          refreshDealerDatalist();
        }
      })
      .catch(function () { /* keep cached index, likely offline */ });
    refreshDealerDatalist();
  }

  // ---------------------------------------------------------------------
  // EDIT MODE (completare/modificare discutie existenta din Raport)
  // ---------------------------------------------------------------------
  function enterEditMode(record) {
    editingKey = normalizeDealerJS(record.dealer);
    $("f_agent").value = record.agent || "";
    $("f_date").value = record.dataISO || "";
    $("f_dealer").value = record.dealer || "";
    $("f_contact").value = record.contact || "";
    $("f_telefon").value = record.telefon || "";
    $("f_email").value = record.email || "";
    $("f_judet").value = record.judet || "";
    $("f_localitate").value = record.localitate || "";
    $("f_status").value = record.status || "";
    $("f_potential").value = record.potential || "";
    $("f_next_action").value = record.nextAction || "";
    $("f_next_date").value = record.nextActionDateISO || "";
    $("f_obs").value = record.observatii || "";

    $("f_dealer").readOnly = true;
    $("dealerWarning").hidden = true;
    $("editBanner").hidden = false;
    $("editBannerText").textContent = "Editezi discutia pentru \"" + record.dealer + "\".";
    $("submitBtn").textContent = "Actualizeaza discutia";

    showTab("form");
    window.scrollTo(0, 0);
  }

  function exitEditMode() {
    editingKey = null;
    $("f_dealer").readOnly = false;
    $("editBanner").hidden = true;
    $("submitBtn").textContent = "Salveaza discutia";
  }

  // ---------------------------------------------------------------------
  // FORM SUBMIT + OFFLINE QUEUE
  // ---------------------------------------------------------------------
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

  function queueEntry(entry, action) {
    var q = getQueue();
    q.push({ action: action || "add", entry: entry });
    saveQueue(q);
    updateOfflineBadge();
  }

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

  function sendEntry(entry, action) {
    return fetch(apiUrl({ action: action || "add", token: CONFIG.APP_TOKEN }), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight to Apps Script
      body: JSON.stringify(entry),
    }).then(function (r) { return r.json(); });
  }

  function flushQueue() {
    var q = getQueue();
    if (!q.length || !isConfigured()) return;
    var remaining = [];
    var duplicatesDropped = [];
    var chain = Promise.resolve();
    q.forEach(function (item) {
      var action = (item && item.action) ? item.action : "add";
      var entry = (item && item.entry) ? item.entry : item; // backward-compat cu coada veche (fara wrapper)
      chain = chain.then(function () {
        return sendEntry(entry, action).then(function (res) {
          if (res && res.ok) {
            if (action === "update") updateDealerIndexCache(entry.dealer, entry.agent, entry.data);
            else addToDealerIndexCache(entry.dealer, entry.agent, entry.data);
          } else if (res && res.error === "duplicate") {
            duplicatesDropped.push({ entry: entry, res: res });
          } else {
            remaining.push({ action: action, entry: entry });
          }
        }).catch(function () {
          remaining.push({ action: action, entry: entry });
        });
      });
    });
    chain.then(function () {
      saveQueue(remaining);
      updateOfflineBadge();
      if (duplicatesDropped.length) {
        var d = duplicatesDropped[0];
        showMsg(
          duplicatesDropped.length + " discutie(i) salvate offline au fost respinse - dealerul \"" + d.entry.dealer +
          "\" a fost deja contactat de " + (d.res.agent || "alt agent") + (d.res.data ? " (" + d.res.data + ")" : "") + ".",
          "err"
        );
      }
    });
  }

  function updateOfflineBadge() {
    var q = getQueue();
    var qp = getPunctQueue();
    var badge = $("offlineBadge");
    var parts = [];
    if (q.length > 0) parts.push(q.length + " discutie(i)");
    if (qp.length > 0) parts.push(qp.length + " punct(e) de lucru");
    if (parts.length) {
      badge.hidden = false;
      badge.textContent = parts.join(" si ") + " nesalvate inca - se trimit automat cand revine internetul";
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

    var isEdit = !!editingKey;

    if (!isEdit) {
      var localDup = checkDealerWarning();
      if (localDup) {
        showMsg("Acest dealer a fost deja contactat de " + localDup.agent +
          (localDup.data ? " (" + localDup.data + ")" : "") + ". Discutia nu a fost salvata.", "err");
        return;
      }
    }

    localStorage.setItem(CACHE_AGENT_KEY, entry.agent);
    var btn = $("submitBtn");
    btn.disabled = true;
    var action = isEdit ? "update" : "add";

    if (!isConfigured()) {
      queueEntry(entry, action);
      showMsg("Aplicatia inca nu e configurata (config.js) - discutia a fost pastrata local.", "pending");
      resetFormKeepAgent();
      exitEditMode();
      btn.disabled = false;
      return;
    }

    sendEntry(entry, action).then(function (res) {
      btn.disabled = false;
      if (res && res.ok) {
        if (isEdit) updateDealerIndexCache(entry.dealer, entry.agent, entry.data);
        else addToDealerIndexCache(entry.dealer, entry.agent, entry.data);
        showMsg(isEdit ? "Discutie actualizata cu succes." : "Discutie salvata cu succes.", "ok");
        resetFormKeepAgent();
        exitEditMode();
        $("dealerWarning").hidden = true;
      } else if (!isEdit && res && res.error === "duplicate") {
        if (res.agent) addToDealerIndexCache(entry.dealer, res.agent, res.data || "");
        showMsg("Acest dealer a fost deja contactat de " + (res.agent || "alt agent") +
          (res.data ? " (" + res.data + ")" : "") + ". Discutia nu a fost salvata.", "err");
        checkDealerWarning();
      } else if (isEdit && res && res.error === "discutie negasita") {
        showMsg("Discutia nu a mai fost gasita (poate a fost stearsa sau modificata direct in registru). Reincarca raportul si incearca din nou.", "err");
      } else {
        throw new Error((res && res.error) || "eroare necunoscuta");
      }
    }).catch(function () {
      queueEntry(entry, action);
      showMsg("Fara conexiune - discutia a fost salvata pe telefon si se va trimite automat.", "pending");
      resetFormKeepAgent();
      exitEditMode();
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
  // PUNCTE DE LUCRU (locatii suplimentare ale unui dealer, pe langa sediul principal)
  // ---------------------------------------------------------------------
  function getPunctQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_PUNCT_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function savePunctQueue(q) { localStorage.setItem(QUEUE_PUNCT_KEY, JSON.stringify(q)); }

  function queuePunct(entry) {
    var q = getPunctQueue();
    q.push(entry);
    savePunctQueue(q);
    updateOfflineBadge();
  }

  function readPunctForm() {
    return {
      dealer: $("p_dealer").value.trim(),
      localitate: $("p_localitate").value.trim(),
      judet: $("p_judet").value,
      adresa: $("p_adresa").value.trim(),
      telefon: $("p_telefon").value.trim(),
      agent: $("f_agent").value || localStorage.getItem(CACHE_AGENT_KEY) || "",
      observatii: $("p_obs").value.trim(),
      clientTs: Date.now(),
    };
  }

  function resetPunctForm() { $("punctForm").reset(); }

  function showPunctMsg(text, cls) {
    var el = $("punctMsg");
    el.textContent = text;
    el.className = "form-msg " + cls;
    setTimeout(function () {
      if (el.textContent === text) el.textContent = "";
    }, 6000);
  }

  function handlePunctSubmit(evt) {
    evt.preventDefault();
    var entry = readPunctForm();
    if (!entry.dealer || !entry.localitate || !entry.judet) {
      showPunctMsg("Completeaza campurile obligatorii (dealer, localitate, judet).", "err");
      return;
    }

    var btn = $("punctSubmitBtn");
    btn.disabled = true;

    if (!isConfigured()) {
      queuePunct(entry);
      showPunctMsg("Aplicatia inca nu e configurata (config.js) - punctul a fost pastrat local.", "pending");
      resetPunctForm();
      btn.disabled = false;
      return;
    }

    sendEntry(entry, "addpunct").then(function (res) {
      btn.disabled = false;
      if (res && res.ok) {
        lastPuncte.push(entry);
        showPunctMsg("Punct de lucru salvat cu succes.", "ok");
        resetPunctForm();
        renderPointsList();
      } else {
        throw new Error((res && res.error) || "eroare necunoscuta");
      }
    }).catch(function () {
      queuePunct(entry);
      showPunctMsg("Fara conexiune - punctul a fost salvat pe telefon si se va trimite automat.", "pending");
      resetPunctForm();
      btn.disabled = false;
    });
  }

  function flushPunctQueue() {
    var q = getPunctQueue();
    if (!q.length || !isConfigured()) return;
    var remaining = [];
    var chain = Promise.resolve();
    q.forEach(function (entry) {
      chain = chain.then(function () {
        return sendEntry(entry, "addpunct").then(function (res) {
          if (!(res && res.ok)) remaining.push(entry);
        }).catch(function () {
          remaining.push(entry);
        });
      });
    });
    chain.then(function () {
      savePunctQueue(remaining);
      updateOfflineBadge();
    });
  }

  function renderPointsList() {
    var q = ($("p_dealer").value || "").trim().toLowerCase();
    var filtered = !q ? lastPuncte : lastPuncte.filter(function (p) {
      return (p.dealer || "").toLowerCase().indexOf(q) !== -1;
    });
    $("pointsListNote").textContent = lastPuncte.length
      ? (filtered.length + " punct(e) de lucru" + (q ? " gasite" : " in total") + ".")
      : "";

    var el = $("pointsList");
    if (!filtered.length) {
      el.innerHTML = '<div class="empty-note">Niciun punct de lucru adaugat inca.</div>';
      return;
    }
    el.innerHTML = filtered.slice().reverse().map(function (p) {
      return '<div class="punct-item">' +
        '<div class="p-top"><span class="p-dealer">' + escapeHtml(p.dealer) + '</span></div>' +
        '<div class="p-sub">' + escapeHtml(p.localitate) + (p.judet ? ", " + escapeHtml(p.judet) : "") +
          (p.telefon ? " &middot; " + escapeHtml(p.telefon) : "") + '</div>' +
        (p.adresa ? '<div class="p-sub">' + escapeHtml(p.adresa) + '</div>' : "") +
        (p.observatii ? '<div class="p-obs">' + escapeHtml(p.observatii) + '</div>' : "") +
      '</div>';
    }).join("");
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

    lastDiscutii = data.discutii || [];
    lastDiscutiiTotal = data.discutiiTotal || lastDiscutii.length;
    applyListFilter();
    renderDealerMap(lastDiscutii);

    lastPuncte = data.puncte || [];
    renderPointsList();
  }

  function statusPillClass(status) {
    if (status === "Contract semnat") return "good";
    if (status === "Respins") return "critical";
    return "neutral";
  }

  function renderAllList(list) {
    var el = $("allDiscutiiList");
    el.innerHTML = "";
    if (!list.length) {
      el.innerHTML = '<div class="empty-note">Nicio discutie gasita.</div>';
      return;
    }
    list.forEach(function (r) {
      var item = document.createElement("div");
      item.className = "discutie-item";
      item.innerHTML =
        '<div class="d-top"><span class="d-dealer">' + escapeHtml(r.dealer) + '</span>' +
        '<span class="status-pill ' + statusPillClass(r.status) + '">' + escapeHtml(r.status) + '</span></div>' +
        '<div class="d-sub">' + escapeHtml(r.agent) + ' &middot; ' + escapeHtml(r.judet) +
        (r.localitate ? ", " + escapeHtml(r.localitate) : "") + ' &middot; ' + escapeHtml(r.data) + '</div>' +
        (r.nextAction ? '<div class="d-next">Urmatoarea actiune: ' + escapeHtml(r.nextAction) +
          (r.nextActionDate ? " (" + escapeHtml(r.nextActionDate) + ")" : "") + '</div>' : "") +
        '<div class="d-actions"><button type="button" class="btn-edit" data-key="' +
          escapeHtml(normalizeDealerJS(r.dealer)) + '">Editeaza / completeaza</button></div>';
      el.appendChild(item);
    });
  }

  function applyListFilter() {
    var q = ($("searchInput").value || "").trim().toLowerCase();
    var filtered = !q ? lastDiscutii : lastDiscutii.filter(function (r) {
      return (r.dealer || "").toLowerCase().indexOf(q) !== -1 ||
        (r.agent || "").toLowerCase().indexOf(q) !== -1;
    });
    var noteEl = $("listNote");
    if (lastDiscutiiTotal > lastDiscutii.length) {
      noteEl.textContent = "Se afiseaza cele mai recente " + lastDiscutii.length + " din " + lastDiscutiiTotal + " discutii" + (q ? " (filtrate)" : "") + ".";
    } else if (q) {
      noteEl.textContent = filtered.length + " rezultat(e) pentru \"" + q + "\".";
    } else {
      noteEl.textContent = lastDiscutii.length + " discutie(i) in total.";
    }
    renderAllList(filtered);
  }

  // ---------------------------------------------------------------------
  // HARTA DEALERI
  // ---------------------------------------------------------------------
  var dealerMap = null;
  var dealerMapLayer = null;

  function ensureDealerMap() {
    if (dealerMap || typeof L === "undefined") return dealerMap;
    dealerMap = L.map("dealerMap", {
      center: [45.9432, 24.9668],
      zoom: 6,
      minZoom: 5,
      maxZoom: 12,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(dealerMap);
    dealerMapLayer = L.layerGroup().addTo(dealerMap);
    return dealerMap;
  }

  function judetBucketColor(count) {
    if (count >= 8) return "#184f95";
    if (count >= 5) return "#2a78d6";
    if (count >= 3) return "#5598e7";
    if (count >= 2) return "#86b6ef";
    return "#b7d3f6";
  }

  function buildMapPopup(judet, list) {
    var rows = list.slice(0, 30).map(function (r) {
      return '<div class="mp-row"><span class="mp-dealer">' + escapeHtml(r.dealer) + '</span>' +
        '<span class="status-pill ' + statusPillClass(r.status) + '">' + escapeHtml(r.status) + '</span></div>';
    }).join("");
    var more = list.length > 30 ? '<div class="muted-text" style="margin-top:4px;">+ inca ' + (list.length - 30) + '</div>' : "";
    return '<div class="map-popup"><div class="mp-title">' + escapeHtml(judet) + '</div>' +
      '<div class="mp-count">' + list.length + ' dealer(i) contactat(i)</div>' +
      '<div class="mp-list">' + rows + '</div>' + more + '</div>';
  }

  function renderMapLegend() {
    var el = $("mapLegend");
    if (!el) return;
    var buckets = [
      { label: "1", color: "#b7d3f6" },
      { label: "2", color: "#86b6ef" },
      { label: "3-4", color: "#5598e7" },
      { label: "5-7", color: "#2a78d6" },
      { label: "8+", color: "#184f95" },
    ];
    el.innerHTML = buckets.map(function (b) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + b.color + '"></span>' + b.label + ' dealeri</span>';
    }).join("");
  }

  function renderDealerMap(discutii) {
    var noteEl = $("mapNote");
    if (typeof L === "undefined") {
      if (noteEl) noteEl.textContent = "Harta nu a putut fi incarcata (necesita conexiune la internet).";
      return;
    }
    var map = ensureDealerMap();
    if (!map || !dealerMapLayer) return;
    dealerMapLayer.clearLayers();

    var byJudet = {};
    (discutii || []).forEach(function (r) {
      var key = r.judet || "";
      if (!key) return;
      if (!byJudet[key]) byJudet[key] = [];
      byJudet[key].push(r);
    });

    var judeteWithData = Object.keys(byJudet).filter(function (j) { return JUDET_COORDS[j]; });
    if (noteEl) {
      noteEl.textContent = judeteWithData.length
        ? "Atinge un judet de pe harta pentru detalii."
        : "Inca nu exista discutii introduse.";
    }

    judeteWithData.forEach(function (judet) {
      var list = byJudet[judet];
      var coords = JUDET_COORDS[judet];
      var radius = 8 + 6 * Math.sqrt(list.length);
      var marker = L.circleMarker(coords, {
        radius: radius,
        color: "#184f95",
        weight: 1.5,
        fillColor: judetBucketColor(list.length),
        fillOpacity: 0.82,
      });
      marker.bindPopup(buildMapPopup(judet, list), { maxWidth: 260 });
      marker.addTo(dealerMapLayer);
    });

    renderMapLegend();
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
  // FISE TEHNICE (PDF-uri gazduite intr-un folder Google Drive, servite prin Code.gs)
  // ---------------------------------------------------------------------
  function fmtBytes(n) {
    if (n === undefined || n === null || isNaN(n)) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderFise(fisiere) {
    lastFise = fisiere || [];
    var listEl = $("fiseList");
    if (!lastFise.length) {
      listEl.innerHTML = '<p class="empty-note">Nicio fisa tehnica incarcata inca.</p>';
      return;
    }
    listEl.innerHTML = lastFise.map(function (f) {
      var meta = [f.data, f.marime ? fmtBytes(f.marime) : ""].filter(Boolean).join(" · ");
      return '<div class="fisa-item" data-id="' + escapeHtml(f.id) + '">' +
        '<div class="f-top"><span class="f-name">' + escapeHtml(f.nume) + '</span></div>' +
        (meta ? '<div class="f-meta">' + escapeHtml(meta) + '</div>' : '') +
        '<div class="fisa-actions">' +
          '<button type="button" data-act="vezi">Vezi</button>' +
          '<button type="button" data-act="descarca">Descarca</button>' +
          '<button type="button" data-act="trimite">Trimite</button>' +
        '</div>' +
        '<div class="fisa-status muted-text" data-role="status"></div>' +
      '</div>';
    }).join("");
  }

  function loadFise(forceRefresh) {
    var cached = localStorage.getItem(CACHE_FISE_KEY);
    if (cached && !forceRefresh) {
      try { renderFise(JSON.parse(cached)); } catch (e) { /* ignora cache corupt */ }
    }
    if (!isConfigured()) {
      if (!cached) $("fiseUpdated").textContent = "Configureaza config.js pentru a vedea fisele tehnice.";
      return;
    }
    $("fiseUpdated").textContent = "Se incarca...";
    fetch(apiUrl({ action: "fise", token: CONFIG.APP_TOKEN }))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error("raspuns invalid");
        renderFise(res.fisiere);
        localStorage.setItem(CACHE_FISE_KEY, JSON.stringify(res.fisiere));
        $("fiseUpdated").textContent = "Actualizat acum";
      })
      .catch(function () {
        $("fiseUpdated").textContent = cached
          ? "Fara conexiune - se afiseaza ultima lista salvata"
          : "Fara conexiune si nicio lista salvata local";
      });
  }

  function fisaById(id) {
    for (var i = 0; i < lastFise.length; i++) { if (lastFise[i].id === id) return lastFise[i]; }
    return null;
  }

  function base64ToBlob(base64, mime) {
    var binStr = atob(base64);
    var len = binStr.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/pdf" });
  }

  var fisaBlobCache = {}; // id -> {blob, nume}, tinut in memorie cat sta deschis ecranul

  function fetchFisaBlob(id) {
    // Daca fisierul a mai fost descarcat o data in acest ecran, il refolosim direct din memorie -
    // asta conteaza mai ales pentru "Trimite": pe unele telefoane (Safari/iOS mai ales) fereastra
    // de distribuire porneste doar daca navigator.share() e apelat FARA nicio asteptare de retea
    // intre click si apel; cu fisierul deja in cache, a doua apasare pe buton e instanta.
    if (fisaBlobCache[id]) return Promise.resolve(fisaBlobCache[id]);
    return fetch(apiUrl({ action: "fisacontinut", id: id, token: CONFIG.APP_TOKEN }))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || "eroare la citire");
        var entry = { blob: base64ToBlob(res.base64, res.mime), nume: res.nume || "fisa-tehnica.pdf" };
        fisaBlobCache[id] = entry;
        return entry;
      });
  }

  function setFisaStatus(card, text) {
    var el = card.querySelector('[data-role="status"]');
    if (el) el.textContent = text || "";
  }

  function downloadBlob(blob, nume) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = nume;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function handleFisaAction(card, act) {
    var id = card.getAttribute("data-id");
    if (!fisaById(id)) return;

    if (act === "vezi") {
      // Navigam pagina curenta direct catre PDF (nu deschidem fereastra/tab noua cu window.open -
      // in multe telefoane, mai ales cand aplicatia e instalata pe ecranul principal, un tab nou
      // deschis din JS e blocat ca pop-up si butonul pare "mort"). O navigare normala functioneaza
      // peste tot, iar butonul de Inapoi al telefonului te readuce direct in aplicatie.
      setFisaStatus(card, "Se incarca...");
      fetchFisaBlob(id).then(function (r) {
        window.location.href = URL.createObjectURL(r.blob);
      }).catch(function (err) {
        setFisaStatus(card, "Eroare: " + err.message);
      });
      return;
    }

    if (act === "descarca") {
      setFisaStatus(card, "Se descarca...");
      fetchFisaBlob(id).then(function (r) {
        downloadBlob(r.blob, r.nume);
        setFisaStatus(card, "");
      }).catch(function (err) {
        setFisaStatus(card, "Eroare: " + err.message);
      });
      return;
    }

    if (act === "trimite") {
      var eraDejaInCache = !!fisaBlobCache[id];
      setFisaStatus(card, eraDejaInCache ? "" : "Se pregateste...");
      fetchFisaBlob(id).then(function (r) {
        var file = new File([r.blob], r.nume, { type: "application/pdf" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: r.nume })
            .then(function () { setFisaStatus(card, ""); })
            .catch(function (err) {
              if (err && err.name === "AbortError") { setFisaStatus(card, ""); return; } // anulat de utilizator
              // Pe unele telefoane (Safari/iOS mai ales), fereastra de distribuire nu porneste
              // daca inainte s-a asteptat dupa retea (prima apasare, cand fisierul s-a descarcat).
              // Acum e deja in memorie, deci a doua apasare pe Trimite merge instant.
              setFisaStatus(card, eraDejaInCache ? "Nu am putut deschide fereastra de trimitere." : "Fisierul e pregatit acum - mai apasa o data pe Trimite.");
            });
        }
        // Fara Share API (de regula pe calculator): descarcam fisierul, ca sa fie atasat manual.
        downloadBlob(r.blob, r.nume);
        setFisaStatus(card, "Trimiterea directa nu e disponibila pe acest dispozitiv - fisierul a fost descarcat, il poti atasa manual la email.");
      }).catch(function (err) {
        setFisaStatus(card, "Eroare: " + err.message);
      });
      return;
    }
  }

  // ---------------------------------------------------------------------
  // TABS
  // ---------------------------------------------------------------------
  function showTab(tab) {
    $("view-form").hidden = tab !== "form";
    $("view-points").hidden = tab !== "points";
    $("view-report").hidden = tab !== "report";
    $("tabFormBtn").classList.toggle("active", tab === "form");
    $("tabPointsBtn").classList.toggle("active", tab === "points");
    $("tabReportBtn").classList.toggle("active", tab === "report");
    if (tab === "points") renderPointsList();
    if (tab !== "form") loadReport(false); // "puncte" vine din acelasi payload ca "raport"
  }

  // ---------------------------------------------------------------------
  // ECRAN PRINCIPAL (meniu) - Raportare agenti / Stoc DBK / Catalog Tunland
  // (Stoc DBK si Catalog Tunland sunt linkuri simple - catre alta pagina/alt site,
  // nu ecrane interne - deci showScreen gestioneaza doar "home" si "raportare".)
  // ---------------------------------------------------------------------
  function showScreen(screen) {
    $("view-home").hidden = screen !== "home";
    $("view-fise").hidden = screen !== "fise";
    var isRaportare = screen === "raportare";
    if (!isRaportare) {
      $("view-form").hidden = true;
      $("view-points").hidden = true;
      $("view-report").hidden = true;
    }
    $("tabBar").hidden = !isRaportare;
    document.body.classList.toggle("no-tabbar", !isRaportare);
    $("homeBtn").hidden = screen === "home";
    $("appTitle").textContent = screen === "home" ? "Foton by Inter Cargo"
      : screen === "fise" ? "Fise tehnice vehicule Foton"
      : (CONFIG.APP_NAME || "Raportare Agenti Foton");
    if (isRaportare) showTab("form");
    if (screen === "fise") loadFise(false);
  }

  // ---------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------
  function init() {
    $("f_date").value = todayISO();
    loadMeta();
    loadDealerIndex();
    updateOfflineBadge();
    showScreen("home");

    $("entryForm").addEventListener("submit", handleSubmit);
    $("f_dealer").addEventListener("input", checkDealerWarning);
    $("f_dealer").addEventListener("blur", checkDealerWarning);
    $("cancelEditBtn").addEventListener("click", function () {
      resetFormKeepAgent();
      exitEditMode();
      showMsg("Editare anulata.", "pending");
    });
    $("allDiscutiiList").addEventListener("click", function (evt) {
      var btn = evt.target.closest ? evt.target.closest(".btn-edit") : null;
      if (!btn) return;
      var key = btn.getAttribute("data-key");
      var record = null;
      for (var i = 0; i < lastDiscutii.length; i++) {
        if (normalizeDealerJS(lastDiscutii[i].dealer) === key) { record = lastDiscutii[i]; break; }
      }
      if (record) enterEditMode(record);
    });
    $("tabFormBtn").addEventListener("click", function () { showTab("form"); });
    $("tabPointsBtn").addEventListener("click", function () { showTab("points"); });
    $("tabReportBtn").addEventListener("click", function () { showTab("report"); });
    $("refreshBtn").addEventListener("click", function () { loadReport(true); });
    $("searchInput").addEventListener("input", applyListFilter);

    $("homeToRaportare").addEventListener("click", function () { showScreen("raportare"); });
    $("homeToFise").addEventListener("click", function () { showScreen("fise"); });
    $("homeBtn").addEventListener("click", function () { showScreen("home"); });
    $("refreshFiseBtn").addEventListener("click", function () { loadFise(true); });
    $("fiseList").addEventListener("click", function (evt) {
      var btn = evt.target.closest ? evt.target.closest("button[data-act]") : null;
      if (!btn) return;
      var card = btn.closest(".fisa-item");
      if (!card) return;
      handleFisaAction(card, btn.getAttribute("data-act"));
    });

    $("punctForm").addEventListener("submit", handlePunctSubmit);
    $("p_dealer").addEventListener("input", renderPointsList);

    window.addEventListener("online", function () { flushQueue(); flushPunctQueue(); });
    flushQueue();
    flushPunctQueue();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
