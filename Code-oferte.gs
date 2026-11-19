/**
 * Arhivă oferte FOTON – Inter Cargo
 * Backend Google Apps Script pentru aplicația de ofertare (Foton by Inter Cargo).
 *
 * Instalare (proiect Apps Script independent sau legat de un Sheet):
 * 1. script.google.com → Proiect nou → lipește acest fișier.
 * 2. Rulează o dată funcția setup și acceptă permisiunile. setup creează automat:
 *      – Google Sheet „Arhivă oferte FOTON” (dacă scriptul nu e legat de un Sheet),
 *      – folderul Drive „Oferte FOTON – PDF” pentru PDF-urile ofertelor,
 *      – verificarea zilnică (ora 8) a ofertelor expirate, cu e-mail către vânzător.
 * 3. Implementare → Implementare nouă → Aplicație web · Executare ca: Eu · Acces: Oricine.
 */
const TOKEN = 'icgoferte2026';      // parola dintre aplicație și arhivă – schimbați-o (și în aplicație)
const ADMIN_KEY = 'icgadmin2026';   // codul administratorilor care pot aloca serii din Stoc DBK – schimbați-l
const ADMIN_EMAILS = '';            // opțional: e-mailuri în copie la alertele de expirare, separate prin virgulă
const OFERTA_NOUA_CATRE = 'florin.loghin@fotonromania.com,alexandru.paunescu@fotonromania.com';
const SHEET = 'Oferte';
const COLS = ['nr','data','valabilaPana','vanzator','client','cui','telefon','email','model','culoare',
  'emailVanzator','pretLista','pretDiscount','pretSuport','pretFinal','totalFaraTVA','totalCuTVA','avansPct','termen',
  'status','motiv','actualizat','modelId','alocare','vin','alocatDe','alocatLa','notificat','feedback',
  'pdfLink','emailOferta','payload'];

const PROPS = PropertiesService.getScriptProperties();

function ss_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActive(); } catch (e) {}
  if (ss) return ss;
  const id = PROPS.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  ss = SpreadsheetApp.create('Arhivă oferte FOTON');
  PROPS.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function folder_() {
  const id = PROPS.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Oferte FOTON – PDF');
  PROPS.setProperty('FOLDER_ID', f.getId());
  return f;
}

function setup() {
  const ss = ss_();
  const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Foaie1');
  if (def && def.getName() !== SHEET && def.getLastRow() === 0) ss.deleteSheet(def);
  if (sh.getMaxColumns() < COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), COLS.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.hideColumns(COLS.length); // payload (datele complete ale ofertei)
  folder_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'verificaExpirate').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verificaExpirate').timeBased().everyDays(1).atHour(8).inTimezone('Europe/Bucharest').create();
  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('Folder PDF: ' + folder_().getUrl());
  Logger.log('E-mailuri rămase azi: ' + MailApp.getRemainingDailyQuota());
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (req.token !== TOKEN) return out({ ok: false, error: 'Token greșit' });
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (req.action === 'list')   return out({ ok: true, rows: list() });
      if (req.action === 'save')   { const r = save(req.rec, req); return out(Object.assign({ ok: true }, r)); }
      if (req.action === 'status') { setStatus(req.nr, req.status, req.motiv); return out({ ok: true }); }
      if (req.action === 'admin')  return out({ ok: req.adminKey === ADMIN_KEY });
      if (req.action === 'anaf')   return out(anaf(req.cui));
      if (req.action === 'aloc') {
        // vânzătorul poate doar CERE alocarea; alocarea/anularea seriei cere codul de administrator
        if (req.alocare !== 'Cerută' || req.vin) { if (req.adminKey !== ADMIN_KEY) return out({ ok: false, error: 'Doar administratorii pot aloca serii' }); }
        setAlloc(req.nr, req.alocare, req.vin, req.de); return out({ ok: true });
      }
      return out({ ok: false, error: 'Acțiune necunoscută' });
    } finally { lock.releaseLock(); }
  } catch (err) { return out({ ok: false, error: String(err) }); }
}

function sheet() { const sh = ss_().getSheetByName(SHEET); if (!sh) { setup(); return ss_().getSheetByName(SHEET); } return sh; }

function list() {
  const sh = sheet(); const n = sh.getLastRow(); if (n < 2) return [];
  const v = sh.getRange(2, 1, n - 1, COLS.length).getValues();
  return v.filter(r => r[0]).map(r => {
    const o = {}; COLS.forEach((c, i) => { let x = r[i]; if (x instanceof Date) x = Utilities.formatDate(x, 'Europe/Bucharest', 'yyyy-MM-dd'); o[c] = x; }); return o;
  });
}

function findRow(sh, nr) {
  const n = sh.getLastRow(); if (n < 2) return -1;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0]));
  const i = ids.indexOf(String(nr)); return i < 0 ? -1 : i + 2;
}

function save(rec, req) {
  req = req || {};
  const sh = sheet(); const row = findRow(sh, rec.nr);
  if (row > 0) { // oferta re-generată: păstrăm statusul, alocarea și starea e-mailului
    const cur = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
    rec.status = cur[COLS.indexOf('status')] || rec.status; rec.motiv = cur[COLS.indexOf('motiv')] || '';
    ['alocare','vin','alocatDe','alocatLa','notificat','feedback','pdfLink','emailOferta'].forEach(c => { rec[c] = cur[COLS.indexOf(c)] || ''; });
  }
  const res = {};
  if (req.pdf) {
    try {
      const name = (req.pdfName || ('Oferta ' + rec.nr + '.pdf')).replace(/[\\/:*?"<>|]/g, '-');
      const blob = Utilities.newBlob(Utilities.base64Decode(req.pdf), 'application/pdf', name);
      const file = folder_().createFile(blob);
      rec.pdfLink = file.getUrl(); res.pdfLink = rec.pdfLink;
      if (!rec.emailOferta) { trimiteOfertaNoua_(rec, blob); rec.emailOferta = new Date().toISOString(); res.emailTrimis = true; }
    } catch (err) { res.emailEroare = String(err); }
  }
  const vals = [COLS.map(c => rec[c] === undefined ? '' : rec[c])];
  sh.getRange(row > 0 ? row : sh.getLastRow() + 1, 1, 1, COLS.length).setNumberFormat('@').setValues(vals);
  return res;
}

function lei_(x) { const n = Number(x); return isNaN(n) || !x ? '' : n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

function trimiteOfertaNoua_(r, blob, catre) {
  const subiect = 'Ofertă nouă – ' + (r.vanzator || 'vânzător') + ' – ' + (r.client || 'client');
  const rand = (k, v) => v ? '<tr><td style="padding:3px 12px 3px 0;color:#666">' + k + '</td><td style="padding:3px 0"><b>' + esc_(v) + '</b></td></tr>' : '';
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<p>A fost emisă o ofertă nouă în aplicația Foton by Inter Cargo.</p><table style="border-collapse:collapse">' +
    rand('Nr. ofertă', r.nr) + rand('Vânzător', r.vanzator) + rand('Client', r.client) + rand('CUI', r.cui) +
    rand('Telefon client', r.telefon) + rand('Model', r.model) + rand('Culoare', r.culoare) +
    rand('Total fără TVA', lei_(r.totalFaraTVA)) + rand('Total cu TVA', lei_(r.totalCuTVA)) +
    rand('Termen livrare', r.termen) + rand('Valabilă până la', r.valabilaPana) +
    '</table><p>Oferta este atașată în PDF' + (r.pdfLink ? ' și salvată în <a href="' + r.pdfLink + '">Drive</a>' : '') + '.</p></div>';
  const opt = { htmlBody: html, attachments: [blob], name: 'Foton by Inter Cargo' };
  if (r.emailVanzator) opt.replyTo = r.emailVanzator;
  MailApp.sendEmail(catre || OFERTA_NOUA_CATRE, subiect, 'Ofertă nouă ' + r.nr + ' – PDF atașat.', opt);
}

function setStatus(nr, status, motiv) {
  const sh = sheet(); const row = findRow(sh, nr); if (row < 0) throw new Error('Oferta ' + nr + ' nu există');
  sh.getRange(row, COLS.indexOf('status') + 1).setValue(status);
  sh.getRange(row, COLS.indexOf('motiv') + 1).setValue(motiv || '');
  sh.getRange(row, COLS.indexOf('actualizat') + 1).setValue(new Date().toISOString());
}

function setAlloc(nr, alocare, vin, de) {
  const sh = sheet(); const row = findRow(sh, nr); if (row < 0) throw new Error('Oferta ' + nr + ' nu există');
  if (alocare === 'Alocată' && vin) { // aceeași serie nu poate fi alocată pe două oferte
    const all = list(); const other = all.find(r => r.vin === vin && r.alocare === 'Alocată' && String(r.nr) !== String(nr));
    if (other) throw new Error('Seria ' + vin + ' este deja alocată pe oferta ' + other.nr);
  }
  const set = (c, v) => sh.getRange(row, COLS.indexOf(c) + 1).setValue(v);
  set('alocare', alocare || ''); set('vin', vin || ''); set('alocatDe', de || '');
  set('alocatLa', alocare === 'Alocată' ? new Date().toISOString() : ''); set('actualizat', new Date().toISOString());
}

// ---------------- expirare + feedback ----------------
function azi() { return Utilities.formatDate(new Date(), 'Europe/Bucharest', 'yyyy-MM-dd'); }
function cheie(nr) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(nr), TOKEN)).slice(0, 16); }

/** Rulează zilnic (trigger creat de setup). Trimite e-mail vânzătorului pentru fiecare ofertă expirată fără răspuns. */
function verificaExpirate() {
  const sh = sheet(); const rows = list(); const url = ScriptApp.getService().getUrl(); const today = azi();
  rows.forEach(r => {
    const deschisa = r.status === 'Trimisă' || r.status === 'În negociere';
    if (!deschisa || !r.valabilaPana || String(r.valabilaPana) >= today || r.notificat || !r.emailVanzator) return;
    const link = url + '?action=feedback&nr=' + encodeURIComponent(r.nr) + '&k=' + cheie(r.nr);
    const html = '<p>Bună ziua, ' + esc_(r.vanzator) + ',</p>' +
      '<p>Oferta <b>' + esc_(r.nr) + '</b> pentru <b>' + esc_(r.client) + '</b> (' + esc_(r.model) + ', ' + esc_(r.totalCuTVA) + ' € cu TVA) a expirat pe ' + esc_(r.valabilaPana) + '.</p>' +
      '<p>Te rugăm să ne spui ce a răspuns clientul: a acceptat oferta, a refuzat-o (și de ce) sau negocierea continuă.</p>' +
      '<p><a href="' + link + '" style="background:#3A4759;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Trimite feedback</a></p>' +
      '<p style="color:#666;font-size:12px">Inter Cargo Grup · aplicația Foton by Inter Cargo</p>';
    const opt = { htmlBody: html, name: 'Foton by Inter Cargo' }; if (ADMIN_EMAILS) opt.cc = ADMIN_EMAILS;
    MailApp.sendEmail(r.emailVanzator, 'Ofertă expirată ' + r.nr + ' – ' + r.client + ': ce a răspuns clientul?', 'Oferta ' + r.nr + ' a expirat. Trimite feedback: ' + link, opt);
    const row = findRow(sh, r.nr); sh.getRange(row, COLS.indexOf('notificat') + 1).setValue(new Date().toISOString());
  });
}

function doGet(e) {
  const p = e.parameter || {};
  if (p.action !== 'feedback') return HtmlService.createHtmlOutput('Foton by Inter Cargo');
  if (p.k !== cheie(p.nr)) return HtmlService.createHtmlOutput('Link invalid.');
  const r = list().find(x => String(x.nr) === String(p.nr)); if (!r) return HtmlService.createHtmlOutput('Oferta nu există.');
  const motive = ['Preț','Termen de livrare','A ales concurența','Finanțare / leasing','Clientul a renunțat','Fără răspuns','Altul'];
  const h = '<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial;max-width:520px;margin:20px auto;padding:0 14px">' +
    '<h2 style="color:#3A4759">Feedback ofertă ' + esc_(r.nr) + '</h2><p>' + esc_(r.client) + ' · ' + esc_(r.model) + ' · vânzător ' + esc_(r.vanzator) + '</p>' +
    (r.feedback ? '<p style="background:#e3f2ea;padding:10px">Feedback deja trimis: ' + esc_(r.feedback) + '</p>' : '') +
    '<form id="f" onsubmit="event.preventDefault();var f=this;var d={nr:f.nr.value,k:f.k.value,rez:(f.querySelector(\'input[name=rez]:checked\')||{}).value,motiv:f.motiv.value,com:f.com.value};f.querySelector(\'button\').disabled=true;google.script.run.withSuccessHandler(function(m){document.body.innerHTML=\'<h2 style=&quot;font-family:Arial;color:#3A4759;max-width:520px;margin:30px auto&quot;>\'+m+\'</h2>\'}).salveazaFeedback(d)"><input type="hidden" name="nr" value="' + esc_(r.nr) + '"><input type="hidden" name="k" value="' + esc_(p.k) + '">' +
    '<p><b>Răspunsul clientului</b><br>' +
    '<label><input type="radio" name="rez" value="Câștigată" required> A acceptat oferta (comandă)</label><br>' +
    '<label><input type="radio" name="rez" value="Pierdută"> A refuzat oferta</label><br>' +
    '<label><input type="radio" name="rez" value="În negociere"> Negocierea continuă</label></p>' +
    '<p><b>Motiv refuz</b> (dacă e cazul)<br><select name="motiv" style="width:100%;padding:8px"><option value="">–</option>' + motive.map(m => '<option>' + m + '</option>').join('') + '</select></p>' +
    '<p><b>Comentariu</b><br><textarea name="com" rows="4" style="width:100%"></textarea></p>' +
    '<button style="background:#3A4759;color:#fff;border:0;padding:12px 18px;border-radius:6px">Trimite</button></form></div>';
  return HtmlService.createHtmlOutput(h).setTitle('Feedback ofertă').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function salveazaFeedback(p) {
  if (p.k !== cheie(p.nr)) return 'Link invalid.';
  const sh = sheet(); const row = findRow(sh, p.nr); if (row < 0) return 'Oferta nu există.';
  const st = ['Câștigată','Pierdută','În negociere'].indexOf(p.rez) >= 0 ? p.rez : 'În negociere';
  sh.getRange(row, COLS.indexOf('status') + 1).setValue(st);
  sh.getRange(row, COLS.indexOf('motiv') + 1).setValue(st === 'Pierdută' ? (p.motiv || 'Nespecificat') : '');
  sh.getRange(row, COLS.indexOf('feedback') + 1).setValue(azi() + ' · ' + st + (p.com ? ' · ' + p.com : ''));
  sh.getRange(row, COLS.indexOf('actualizat') + 1).setValue(new Date().toISOString());
  if (st === 'În negociere') { // prelungim oferta cu 7 zile; vânzătorul e întrebat din nou la noua expirare
    const d = new Date(); d.setDate(d.getDate() + 7);
    sh.getRange(row, COLS.indexOf('valabilaPana') + 1).setValue(Utilities.formatDate(d, 'Europe/Bucharest', 'yyyy-MM-dd'));
    sh.getRange(row, COLS.indexOf('notificat') + 1).setValue('');
  }
  return 'Mulțumim! Feedback-ul pentru oferta ' + p.nr + ' a fost salvat: ' + st + '.';
}

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- date firmă din ANAF (serviciul public PlatitorTvaRest v9) ----------------
function anaf(cui) {
  const n = String(cui || '').replace(/\D/g, ''); if (!n) return { ok: false, error: 'CUI invalid' };
  const res = UrlFetchApp.fetch('https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify([{ cui: Number(n), data: azi() }]) });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'ANAF nu răspunde (' + res.getResponseCode() + ')' };
  const j = JSON.parse(res.getContentText()); const f = (j.found || [])[0];
  if (!f) return { ok: false, error: 'CUI negăsit la ANAF' };
  const g = f.date_generale || {}; const tva = (f.inregistrare_scop_Tva || {}).scpTVA;
  return { ok: true, denumire: g.denumire || '', adresa: g.adresa || '', nrRegCom: g.nrRegCom || '', telefon: g.telefon || '',
    cui: (tva ? 'RO' : '') + n, platitorTva: !!tva, inactiv: !!(f.stare_inactiv || {}).statusInactivi };
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Test manual: trimite un e-mail „Ofertă nouă” de probă DOAR către primul destinatar, cu un PDF de test. */
function testEmailOferta() {
  const blob = Utilities.newBlob('<h1>Ofertă de test</h1><p>Verificare e-mail Foton by Inter Cargo.</p>', 'text/html', 'test.html').getAs('application/pdf').setName('Oferta TEST - Vanzator Test - Client Test.pdf');
  const r = { nr: 'ICG-OF-TEST', vanzator: 'Vânzător Test', client: 'Client Test SRL', model: 'FOTON Tunland V9', culoare: 'Alb', totalFaraTVA: 40000, totalCuTVA: 48400, termen: 'Din stoc', valabilaPana: azi() };
  trimiteOfertaNoua_(r, blob, OFERTA_NOUA_CATRE.split(',')[0]);
  Logger.log('Trimis test către ' + OFERTA_NOUA_CATRE.split(',')[0] + ' · e-mailuri rămase azi: ' + MailApp.getRemainingDailyQuota());
}
