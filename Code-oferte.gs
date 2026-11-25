/**
 * Arhivă oferte FOTON – Inter Cargo · backend Google Apps Script (Foton by Inter Cargo – Ofertare)
 *
 * Instalare: script.google.com → proiect → lipește fișierul → rulează setup (o dată) →
 * Implementare → Aplicație web · Executare ca: Eu · Acces: Oricine.
 *
 * Roluri:  admin    – vede tot, alocă serii, etapele de livrare, comisioane, utilizatori, rapoarte complete
 *          operator – etapele de după încasarea avansului (încărcat, acte cu factura finală, PDI, livrat)
 *          vanzator – doar ofertele proprii; emite proforma și trece avansul încasat
 * Flux: ofertă → proformă (din aplicație, seria ICG-PF) → avans încasat → alocare serie → încărcat → acte → PDI → livrat
 */
const TOKEN = 'icgoferte2026';
const APP_URL = 'https://florinx1.github.io/fotonagenti/ofertare.html';
const SENDER = 'FOTON ROMANIA OFERTARE';
const ADMIN_EMAILS = '';  // opțional: copie la alertele de expirare
const SHEET = 'Oferte', USERS = 'Utilizatori', HIST = 'Istoric';

// Administratori ficși. Parolele sunt stocate doar ca hash SHA-256 cu sare.
const ADMIN_SALT = '7610e3cae4411dd9';
const ADMINS = {
  florin: { nume: 'Florin Loghin',      email: 'florin.loghin@fotonromania.com',      hash: '36f9863c2ae40a45b475639818c023081208cd6e6c734cd7ed98d84c73c5cce2' },
  alex:   { nume: 'Alexandru Păunescu', email: 'alexandru.paunescu@fotonromania.com', hash: '5c6e830f17b912e8d0ca9d7b9df30ce26169e78de19050b9c36b66223f161616' }
};
const OFERTA_NOUA_CATRE = Object.keys(ADMINS).map(k => ADMINS[k].email).join(',');

const COLS = ['nr','data','valabilaPana','vanzator','client','cui','telefon','email','model','culoare',
  'emailVanzator','pretLista','pretDiscount','pretSuport','pretFinal','totalFaraTVA','totalCuTVA','avansPct','termen',
  'status','motiv','actualizat','modelId','alocare','vin','alocatDe','alocatLa','notificat','feedback',
  'vanzatorUser','etapa','etapaLa','proformaNr','proformaData','facturaAvansNr','dataIncasare',
  'comision','comisionNota','comisionPlatit','livratLa','pdfLink','emailOferta','payload',
  'pretMinim','pretAprobat','aprobare','sumaAvans','monedaAvans',
  'facturaAvansData','tipPlata','facturaFinalaNr','facturaFinalaData','proformaTip','proformaAmanata','proformaAlerta'];
// Facturi proforme (fila „Proforme”): numerotare continuă în seria ICG-PF, datele complete ale fiecărei proforme în payload
const PROF = 'Proforme', PF_SERIE = 'ICG-PF';
const PFCOLS = ['numar','serie','nr','data','ofertaNr','stare','tip','cumparator','cui','utilizator','vanzator','emitent',
  'moneda','totalFaraTVA','totalCuTVA','avansPct','avans','pdfLink','creat','payload'];
// Firme de leasing (fila „Leasing”): lista din care alege vânzătorul la proforma pentru leasing
const LEASING = 'Leasing', LCOLS = ['nume','cui','regCom','adresa'];
const PF_ZILE = 3; // zile lucrătoare după care vânzătorul primește alertă de avans neîncasat
const UCOLS = ['user','nume','email','telefon','rol','activ','hash','creat'];
const HCOLS = ['data','nr','etapa','eticheta','de','detalii'];
// Prețuri (fila „Prețuri” din Sheet – le pot modifica administratorii; aplicația le citește la fiecare deschidere)
const PRICES = 'Preturi';
const PCOLS = ['modelId','model','pretLista','discountMaximPct','pretMinim'];
const PRICES_DEF = [
  ['g7','Tunland G7',30900,10,27810],
  ['v9','Tunland V9',41700,14,35862],
  ['cavan','CAVAN (C1 / C1 PLUS / C1 MAX)',34900,18,28618],
  ['etoano','eToano Pro',43900,16,36876],
  ['emiler','eMiler 4,25t',37900,10,34110],
  ['eaumark','eAumark 7,5t',49900,10,44910],
  ['aumark','Aumark 7,5t',38900,10,35010]];

// Etapele ofertei. who: v = vânzătorul ofertei, o = operator/administrator, a = doar administrator
// Flux: ofertată → proformă emisă → avans încasat → serie alocată → încărcat → acte (factura finală) → PDI → livrată.
// „cerere” și „alocata” fără avans rămân pentru ofertele vechi, făcute înainte de proforma din aplicație.
const ET = {
  ofertata:   { l: 'Ofertată',                         who: 'v', next: ['negociere','proforma','pierduta'] },
  negociere:  { l: 'În negociere',                     who: 'v', next: ['proforma','pierduta'] },
  cerere:     { l: 'Cerere alocare serie',             who: 'v', next: ['proforma','pierduta'] },
  alocata:    { l: 'Serie alocată',                    who: 'a', next: ['proforma','incarcat','pierduta'] },
  proforma:   { l: 'Proformă emisă – așteaptă avansul', who: 'v', next: ['avans','pierduta'] },
  avans:      { l: 'Avans încasat – de alocat serie',  who: 'v', next: [], req: ['facturaAvansNr','facturaAvansData','dataIncasare','sumaAvans'] },
  incarcat:   { l: 'Vehicul încărcat spre livrare ICG', who: 'o', next: ['acte'] },
  acte:       { l: 'Întocmire acte',                   who: 'o', next: ['pdi'], req: ['facturaFinalaNr','facturaFinalaData'] },
  pdi:        { l: 'În pregătire PDI / fișă livrare',  who: 'o', next: ['finalizata'] },
  finalizata: { l: 'Livrată – finalizată',             who: 'o', next: [] },
  pierduta:   { l: 'Pierdută',                         who: 'v', next: [], req: ['motiv'] },
  aprobare:   { l: 'Așteaptă aprobare preț',           who: 'a', next: ['pierduta'] },
  respinsa:   { l: 'Preț respins – de modificat',      who: 'a', next: ['pierduta'] },
  anulata:    { l: 'Anulată',                          who: 'a', next: [], req: ['motiv'] }
};
const LEGACY = { 'Trimisă': 'ofertata', 'În negociere': 'negociere', 'Câștigată': 'avans', 'Pierdută': 'pierduta' };
// etapele în care poate trece oferta; „Serie alocată” merge spre proformă (oferte vechi, fără avans) sau spre încărcare (cu avans)
function nextOf_(r) {
  const n = (ET[r.etapa] || {}).next || [];
  if (r.etapa !== 'alocata') return n;
  const av = !!r.facturaAvansNr; return n.filter(t => t === 'incarcat' ? av : !av);
}

const PROPS = PropertiesService.getScriptProperties();

/* ---------------- infrastructură ---------------- */
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
function tab_(name, cols, hideCol) {
  const ss = ss_(); let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
  if (head.join('|') !== cols.join('|')) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold'); sh.setFrozenRows(1);
    if (hideCol) { sh.showColumns(1, sh.getMaxColumns()); sh.hideColumns(cols.indexOf(typeof hideCol === 'string' ? hideCol : cols[cols.length - 1]) + 1); }
  }
  return sh;
}
function setup() {
  const ss = ss_();
  tab_(SHEET, COLS, 'payload'); tab_(USERS, UCOLS, false); tab_(HIST, HCOLS, false); prices_();
  tab_(PROF, PFCOLS, 'payload'); tab_(LEASING, LCOLS, false);
  const us = ss.getSheetByName(USERS); us.hideColumns(UCOLS.indexOf('hash') + 1);
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Foaie1');
  if (def && def.getLastRow() === 0) ss.deleteSheet(def);
  folder_(); secret_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'verificaExpirate').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verificaExpirate').timeBased().everyDays(1).atHour(8).inTimezone('Europe/Bucharest').create();
  Logger.log('Sheet: ' + ss.getUrl()); Logger.log('Folder PDF: ' + folder_().getUrl());
}
function sheet() { return tab_(SHEET, COLS, 'payload'); }
function prices_() {
  const sh = tab_(PRICES, PCOLS, false);
  if (sh.getLastRow() < 2) { sh.getRange(2, 1, PRICES_DEF.length, PCOLS.length).setValues(PRICES_DEF); }
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, PCOLS.length).getValues(); const o = {};
  v.forEach(r => { const id = String(r[0] || '').trim(); if (id) o[id] = { model: r[1], lista: Number(r[2]) || 0, pct: Number(r[3]) || 0, min: Number(r[4]) || 0 }; });
  return o;
}
function minFor_(modelId) { const p = prices_()[String(modelId || '')]; return p && p.min ? p.min : 0; }
function azi() { return Utilities.formatDate(new Date(), 'Europe/Bucharest', 'yyyy-MM-dd'); }
function nowIso() { return new Date().toISOString(); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fdt_(s) { s = String(s || ''); return /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10).split('-').reverse().join('.') : s; }
function eur_(x) { const n = Number(x); return isNaN(n) || x === '' ? '' : n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
const lei_ = eur_;
function bani_(x, m) { return m === 'RON' ? (Number(x) || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei' : eur_(x); }
// cum se plătește o proformă în euro (vânzătorul bifează una; textul apare pe proformă)
const PF_PLATA_EUR = { bnr05: 'BNR + 0,5%', bnr1: 'BNR + 1%', bcr: 'curs BCR vânzare' };

/* ---------------- conturi și sesiuni ---------------- */
function hashParola(u, p) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ADMIN_SALT + ':' + u + ':' + p, Utilities.Charset.UTF_8).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function secret_() { let s = PROPS.getProperty('SESS_SECRET'); if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); PROPS.setProperty('SESS_SECRET', s); } return s; }
function sign_(x) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(x, secret_())).replace(/=+$/, ''); }
function mkSess_(u) { const p = u + '.' + (Date.now() + 30 * 864e5); return p + '.' + sign_(p); }
function lc_(u) { return String(u || '').trim().toLowerCase(); }
function genPass_() { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return 'Foton-' + s.slice(0, 4) + '-' + s.slice(4); }
function usersAll_() {
  const sh = tab_(USERS, UCOLS, false); const n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, UCOLS.length).getValues().map((r, i) => {
    const o = { _row: i + 2 }; UCOLS.forEach((c, j) => o[c] = r[j]); o.user = lc_(o.user); o.activ = o.activ === true || String(o.activ).toUpperCase() === 'TRUE' || o.activ === 'da'; return o;
  }).filter(o => o.user);
}
function user_(u) {
  u = lc_(u);
  if (ADMINS[u]) return { user: u, nume: ADMINS[u].nume, email: ADMINS[u].email, telefon: PROPS.getProperty('TEL_' + u) || '', rol: 'admin', activ: true, fix: true };
  const r = usersAll_().find(x => x.user === u); return r && r.activ ? r : null;
}
function pub_(u) { return u ? { user: u.user, nume: u.nume, email: u.email, telefon: String(u.telefon || ''), rol: u.rol, activ: u.activ, fix: !!u.fix } : null; }
function me_(sess) {
  const p = String(sess || '').split('.'); if (p.length !== 3) return null;
  if (p[2] !== sign_(p[0] + '.' + p[1]) || +p[1] < Date.now()) return null;
  return user_(p[0]);
}
function checkPass_(u, p) {
  if (!u || !p) return false; const h = hashParola(u, String(p));
  const ov = PROPS.getProperty('PW_' + u); if (ov) return ov === h;
  if (ADMINS[u]) return ADMINS[u].hash === h;
  const r = usersAll_().find(x => x.user === u); return !!(r && r.activ && r.hash === h);
}

/* ---------------- API ---------------- */
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (req.token !== TOKEN) return out({ ok: false, error: 'Token greșit' });
    if (req.action === 'login') {
      const u = lc_(req.user);
      if (!/^[a-z0-9_-]{2,30}$/.test(u) || !checkPass_(u, req.pass)) return out({ ok: false, error: 'Utilizator sau parolă greșită' });
      const me = user_(u); if (!me) return out({ ok: false, error: 'Cont inactiv' });
      return out({ ok: true, sess: mkSess_(u), me: pub_(me) });
    }
    const me = me_(req.sess);
    if (!me) return out({ ok: false, auth: true, error: 'Sesiunea a expirat – autentifică-te din nou' });
    if (req.action === 'me') return out({ ok: true, me: pub_(me) });
    if (req.action === 'anaf') return out(anaf(req.cui));
    if (req.action === 'curs') return out(cursBnr_());
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      if (req.action === 'list')      return out(Object.assign({ ok: true }, list_(me)));
      if (req.action === 'preturi')   return out({ ok: true, preturi: prices_() });
      if (req.action === 'aprobare')  return out(Object.assign({ ok: true }, aprobare_(me, req.nr, req.decizie, req.motiv)));
      if (req.action === 'save')      return out(Object.assign({ ok: true }, save_(me, req.rec, req)));
      if (req.action === 'etapa')     return out(Object.assign({ ok: true }, etapa_(me, req.nr, req.etapa, req.date || {})));
      if (req.action === 'aloc')      return out(Object.assign({ ok: true }, aloc_(me, req.nr, req.vin)));
      if (req.action === 'proforma')  return out(Object.assign({ ok: true }, proforma_(me, req.nr, req.d || {})));
      if (req.action === 'proformaPdf') return out(Object.assign({ ok: true }, proformaPdf_(me, req.numar, req.pdf, req.pdfName)));
      if (req.action === 'proformaStinge') return out(Object.assign({ ok: true }, proformaStinge_(me, req.nr, req.motiv, req.nota)));
      if (req.action === 'comision')  return out(Object.assign({ ok: true }, comision_(me, req.nr, req.date || {})));
      if (req.action === 'parola')    return out(Object.assign({ ok: true }, parola_(me, req.vechi, req.noua)));
      if (req.action === 'telefon')   return out(Object.assign({ ok: true }, telefon_(me, req.telefon)));
      if (me.rol !== 'admin') return out({ ok: false, error: 'Doar administratorii au acces' });
      if (req.action === 'sterge')    return out(Object.assign({ ok: true }, sterge_(me, req.nrs || [])));
      if (req.action === 'proformaSterge') return out(Object.assign({ ok: true }, proformaSterge_(me, req.numar, req.motiv)));
      if (req.action === 'users')     return out({ ok: true, users: usersPub_() });
      if (req.action === 'userSave')  return out(Object.assign({ ok: true }, userSave_(me, req.u || {}, req.trimite)));
      if (req.action === 'userReset') return out(Object.assign({ ok: true }, userReset_(me, req.user, req.trimite)));
      return out({ ok: false, error: 'Acțiune necunoscută' });
    } finally { lock.releaseLock(); }
  } catch (err) { return out({ ok: false, error: String(err && err.message || err) }); }
}

/* ---------------- oferte ---------------- */
function rowsAll_() {
  const sh = sheet(); const n = sh.getLastRow(); if (n < 2) return { sh, rows: [] };
  const v = sh.getRange(2, 1, n - 1, COLS.length).getValues();
  const rows = [];
  v.forEach((r, i) => {
    if (!r[0]) return;
    const o = { _row: i + 2 };
    COLS.forEach((c, j) => { let x = r[j]; if (x instanceof Date) x = Utilities.formatDate(x, 'Europe/Bucharest', 'yyyy-MM-dd'); o[c] = x; });
    if (!o.etapa) o.etapa = LEGACY[o.status] || 'ofertata';
    rows.push(o);
  });
  return { sh, rows };
}
function writeRow_(sh, o) {
  const vals = [COLS.map(c => o[c] === undefined || o[c] === null ? '' : o[c])];
  sh.getRange(o._row || sh.getLastRow() + 1, 1, 1, COLS.length).setNumberFormat('@').setValues(vals);
}
function owner_(me, r) { return r.vanzatorUser ? r.vanzatorUser === me.user : (!!r.emailVanzator && String(r.emailVanzator).toLowerCase() === String(me.email).toLowerCase()); }
function visible_(me, r) {
  if (me.rol === 'admin') return true;
  if (owner_(me, r)) return true;
  if (me.rol === 'operator') return ['avans','incarcat','acte','pdi'].indexOf(r.etapa) >= 0 || (r.etapa === 'alocata' && !!r.facturaAvansNr);
  return false;
}
function hist_(nr, et, de, det) { tab_(HIST, HCOLS, false).appendRow([nowIso(), nr, et, (ET[et] || {}).l || et, de, det || '']); }
function list_(me) {
  const rows = rowsAll_().rows.filter(r => visible_(me, r));
  const nrs = {}; rows.forEach(r => nrs[r.nr] = true);
  const hs = tab_(HIST, HCOLS, false); const n = hs.getLastRow(); const ist = {};
  if (n > 1) hs.getRange(2, 1, n - 1, HCOLS.length).getValues().forEach(h => {
    if (!nrs[h[1]]) return; (ist[h[1]] = ist[h[1]] || []).push({ data: h[0] instanceof Date ? h[0].toISOString() : String(h[0]), etapa: h[2], eticheta: h[3], de: h[4], detalii: h[5] });
  });
  rows.forEach(r => { r.ist = ist[r.nr] || []; delete r._row; });
  const proforme = proformeAll_().filter(p => nrs[p.ofertaNr]).map(p => { delete p._row; return p; });
  return { rows, me: pub_(me), preturi: prices_(), proforme, leasing: leasing_() };
}
function getRow_(nr) { const a = rowsAll_(); const r = a.rows.find(x => String(x.nr) === String(nr)); if (!r) throw new Error('Oferta ' + nr + ' nu există'); return { sh: a.sh, r, all: a.rows }; }

const KEEP = ['vanzator','emailVanzator','vanzatorUser','status','etapa','etapaLa','motiv','alocare','vin','alocatDe','alocatLa','notificat','feedback','pretAprobat','aprobare',
  'proformaNr','proformaData','facturaAvansNr','dataIncasare','comision','comisionNota','comisionPlatit','livratLa','pdfLink','emailOferta','data','valabilaPana',
  'sumaAvans','monedaAvans','facturaAvansData','tipPlata','facturaFinalaNr','facturaFinalaData','proformaTip','proformaAmanata','proformaAlerta'];
function save_(me, rec, req) {
  const a = rowsAll_(); const cur = a.rows.find(x => String(x.nr) === String(rec.nr));
  const o = {};
  COLS.forEach(c => o[c] = rec[c]);
  if (cur) {
    if (!(me.rol === 'admin' || owner_(me, cur))) throw new Error('Poți modifica doar ofertele tale');
    if (['ofertata','negociere','cerere','aprobare','respinsa'].indexOf(cur.etapa) < 0 && me.rol !== 'admin') throw new Error('Oferta a trecut în etapa „' + ET[cur.etapa].l + '” și nu mai poate fi modificată');
    KEEP.forEach(c => o[c] = cur[c]); o._row = cur._row;
    if (rec.valabilaPana && ['ofertata','negociere'].indexOf(cur.etapa) >= 0) o.valabilaPana = rec.valabilaPana;
  } else {
    KEEP.forEach(c => { if (c !== 'data' && c !== 'valabilaPana') o[c] = ''; });
    o.vanzator = me.nume; o.emailVanzator = me.email; o.vanzatorUser = me.user;
    o.etapa = 'ofertata'; o.status = ET.ofertata.l; o.etapaLa = nowIso(); o.alocare = ''; o.vin = '';
  }
  o.actualizat = nowIso();
  const res = {};
  // control preț minim agent: sub minim → aprobare administrator
  const min = minFor_(o.modelId); o.pretMinim = min || '';
  const pf = Number(o.pretFinal) || 0, aprob = Number(o.pretAprobat) || 0;
  let cerereAprobare = false;
  if (me.rol !== 'admin' && ['ofertata','negociere','aprobare','respinsa'].indexOf(o.etapa) >= 0) {
    const sub = !!min && pf > 0 && pf < min && !(aprob && pf >= aprob);
    if (sub && o.etapa !== 'aprobare') { o.etapa = 'aprobare'; o.status = ET.aprobare.l; o.etapaLa = nowIso(); o.aprobare = ''; cerereAprobare = true; }
    else if (!sub && (o.etapa === 'aprobare' || o.etapa === 'respinsa')) { o.etapa = 'ofertata'; o.status = ET.ofertata.l; o.etapaLa = nowIso(); res.inLimita = true; }
    else if (sub && o.etapa === 'aprobare') cerereAprobare = true; // preț schimbat, dar tot sub minim: retrimitem cererea
  }
  if (req.pdf) {
    try {
      const name = (req.pdfName || ('Oferta ' + rec.nr + '.pdf')).replace(/[\\/:*?"<>|]/g, '-');
      const blob = Utilities.newBlob(Utilities.base64Decode(req.pdf), 'application/pdf', name);
      const file = folder_().createFile(blob);
      o.pdfLink = file.getUrl(); res.pdfLink = o.pdfLink;
      if (cerereAprobare) { trimiteCerereAprobare_(o, blob); o.emailOferta = o.emailOferta || nowIso(); res.emailTrimis = true; res.cerereAprobare = true; }
      else if (!o.emailOferta) { trimiteOfertaNoua_(o, blob); o.emailOferta = nowIso(); res.emailTrimis = true; }
    } catch (err) { res.emailEroare = String(err); }
  }
  writeRow_(a.sh, o);
  if (!cur) hist_(o.nr, 'ofertata', me.nume, 'Ofertă emisă · ' + (o.model || '') + ' · ' + eur_(o.totalCuTVA) + ' cu TVA');
  if (cerereAprobare) hist_(o.nr, 'aprobare', me.nume, 'Preț vehicul ' + eur_(pf) + ' sub minimul de agent ' + eur_(min) + ' – cerere aprobare');
  if (res.inLimita) hist_(o.nr, 'ofertata', me.nume, 'Preț vehicul ' + eur_(pf) + ' în limita de agent');
  if (cerereAprobare && !req.pdf) trimiteCerereAprobare_(o, null);
  res.etapa = o.etapa; res.pretMinim = min; res.pretAprobat = o.pretAprobat || '';
  return res;
}

function validDate_(s) { return /^\d{4}-\d\d-\d\d$/.test(String(s || '')); }
function etapa_(me, nr, t, d) {
  const g = getRow_(nr); const r = g.r; const cur = r.etapa; const T = ET[t];
  if (!T) throw new Error('Etapă necunoscută');
  if (t === 'alocata') throw new Error('Seria se alocă din ecranul de alocare');
  if (t === 'proforma') throw new Error('Proforma se emite din butonul „Emite factură proformă”');
  const isAdm = me.rol === 'admin', isOwn = owner_(me, r), isOp = me.rol === 'operator';
  const inFlow = nextOf_(r).indexOf(t) >= 0;
  const canCancel = t === 'anulata' && isAdm && ['finalizata','anulata','pierduta'].indexOf(cur) < 0;
  if (!inFlow && !canCancel) throw new Error('Din etapa „' + ET[cur].l + '” nu se poate trece în „' + T.l + '”');
  if (T.who === 'v' && !(isOwn || isAdm)) throw new Error('Această etapă o validează vânzătorul ofertei');
  if (T.who === 'o' && !(isOp || isAdm)) throw new Error('Această etapă o validează administratorul');
  if (T.who === 'a' && !isAdm) throw new Error('Doar administratorii pot face asta');
  (T.req || []).forEach(f => { if (!String(d[f] || '').trim()) throw new Error('Completează câmpul obligatoriu: ' + ({ facturaAvansNr: 'numărul facturii de avans', facturaAvansData: 'data facturii de avans', dataIncasare: 'data încasării', sumaAvans: 'suma încasată', facturaFinalaNr: 'numărul facturii finale', facturaFinalaData: 'data facturii finale', motiv: 'motivul' }[f] || f)); });
  ['dataIncasare','facturaAvansData','facturaFinalaData'].forEach(f => { if (d[f] && !validDate_(d[f])) throw new Error('Dată invalidă'); if (d[f] && d[f] > azi()) throw new Error('Data nu poate fi în viitor'); });
  let det = String(d.nota || '').trim();
  let final = t; // etapa în care rămâne oferta
  if (t === 'avans') {
    const s = Number(String(d.sumaAvans).replace(/\s/g, '').replace(',', '.')), mon = d.monedaAvans === 'EUR' ? 'EUR' : 'RON';
    if (!(s > 0)) throw new Error('Suma încasată trebuie să fie un număr mai mare ca zero');
    if (r.proformaData && d.dataIncasare < String(r.proformaData).slice(0, 10)) throw new Error('Data încasării nu poate fi înaintea datei proformei (' + fdt_(r.proformaData) + ')');
    r.facturaAvansNr = String(d.facturaAvansNr).trim(); r.facturaAvansData = d.facturaAvansData; r.dataIncasare = d.dataIncasare;
    r.sumaAvans = Math.round(s * 100) / 100; r.monedaAvans = mon; r.tipPlata = ['integral','rezervare'].indexOf(d.tipPlata) >= 0 ? d.tipPlata : 'avans';
    det = ({ integral: 'Plată integrală', rezervare: 'Rezervare' }[r.tipPlata] || 'Avans') + ' · factură ' + r.facturaAvansNr + ' din ' + fdt_(r.facturaAvansData) + ', încasat ' + fdt_(r.dataIncasare) + ', suma ' + r.sumaAvans.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' ' + mon + (det ? ' · ' + det : '');
    pfStare_(r.nr, 'Încasată');
    if (r.vin && r.alocare === 'Alocată') final = 'alocata'; // seria a fost alocată deja (ex. leasing): comanda merge direct spre livrare
  }
  if (t === 'acte') { r.facturaFinalaNr = String(d.facturaFinalaNr).trim(); r.facturaFinalaData = d.facturaFinalaData; det = 'Factură finală ' + r.facturaFinalaNr + ' din ' + fdt_(r.facturaFinalaData) + (det ? ' · ' + det : ''); }
  if (t === 'cerere') r.alocare = 'Cerută';
  if (t === 'negociere' && String(r.valabilaPana) < azi()) { const x = new Date(); x.setDate(x.getDate() + 7); r.valabilaPana = Utilities.formatDate(x, 'Europe/Bucharest', 'yyyy-MM-dd'); r.notificat = ''; }
  if (t === 'pierduta' || t === 'anulata') {
    r.motiv = String(d.motiv).trim(); det = r.motiv + (det ? ' · ' + det : '');
    if (r.vin) { det += ' · seria ' + r.vin + ' eliberată'; r.alocare = ''; r.vin = ''; }
    if (pfStare_(r.nr, 'Anulată – ' + r.motiv)) det += ' · proforma ' + r.proformaNr + ' anulată';
  }
  if (t === 'finalizata') r.livratLa = d.data && validDate_(d.data) ? d.data : azi();
  r.etapa = final; r.status = ET[final].l; r.etapaLa = nowIso(); r.actualizat = nowIso();
  writeRow_(g.sh, r); hist_(r.nr, t, me.nume, det);
  if (final !== t) hist_(r.nr, final, me.nume, 'Seria ' + r.vin + ' era deja alocată – comanda trece spre livrare');
  notify_(t, r, me, det);
  return { etapa: final };
}
function aloc_(me, nr, vin) {
  if (me.rol !== 'admin') throw new Error('Doar administratorii pot aloca serii');
  const g = getRow_(nr); const r = g.r;
  if (vin) {
    if (['ofertata','negociere','cerere','alocata','proforma','avans'].indexOf(r.etapa) < 0) throw new Error('Oferta este în etapa „' + ET[r.etapa].l + '” – seria nu mai poate fi schimbată de aici');
    const other = g.all.find(x => x.vin === vin && x.alocare === 'Alocată' && String(x.nr) !== String(nr) && ['pierduta','anulata'].indexOf(x.etapa) < 0);
    if (other) throw new Error('Seria ' + vin + ' este deja alocată pe oferta ' + other.nr);
    r.alocare = 'Alocată'; r.vin = vin; r.alocatDe = me.nume; r.alocatLa = nowIso();
    // în etapa proformă (ex. leasing, unde finanțatorul cere VIN-ul) seria se rezervă, iar oferta rămâne în așteptarea avansului
    if (r.etapa !== 'proforma') { r.etapa = 'alocata'; r.status = ET.alocata.l; r.etapaLa = nowIso(); }
    r.actualizat = nowIso();
    writeRow_(g.sh, r); hist_(nr, 'alocata', me.nume, 'Seria ' + vin);
    notify_('alocata', r, me, 'Seria ' + vin);
  } else {
    if (!(r.etapa === 'alocata' || (r.etapa === 'proforma' && r.vin))) throw new Error('Alocarea se poate anula doar cât oferta este în etapa „Serie alocată” sau „Proformă emisă”');
    const old = r.vin; r.vin = ''; r.alocatDe = ''; r.alocatLa = '';
    if (r.etapa === 'alocata') {
      const back = r.facturaAvansNr ? 'avans' : 'cerere';
      r.alocare = back === 'cerere' ? 'Cerută' : ''; r.etapa = back; r.status = ET[back].l; r.etapaLa = nowIso();
    } else r.alocare = '';
    r.actualizat = nowIso();
    writeRow_(g.sh, r); hist_(nr, r.etapa, me.nume, 'Alocare anulată (seria ' + old + ' eliberată)');
  }
  return {};
}

/* ---------------- facturi proforme ---------------- */
function proformeAll_() {
  const sh = tab_(PROF, PFCOLS, 'payload'); const n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, PFCOLS.length).getValues().map((v, i) => {
    const o = { _row: i + 2 }; PFCOLS.forEach((c, j) => { let x = v[j]; if (x instanceof Date) x = Utilities.formatDate(x, 'Europe/Bucharest', 'yyyy-MM-dd'); o[c] = x; });
    o.nr = String(o.nr).padStart(6, '0'); o.ofertaNr = String(o.ofertaNr); return o;
  }).filter(o => o.numar);
}
function pfWrite_(o) { tab_(PROF, PFCOLS, 'payload').getRange(o._row, 1, 1, PFCOLS.length).setNumberFormat('@').setValues([PFCOLS.map(c => o[c] == null ? '' : o[c])]); }
// schimbă starea proformei active („Emisă”) a ofertei; întoarce true dacă exista una
function pfStare_(nr, stare) {
  const a = proformeAll_().filter(p => p.ofertaNr === String(nr) && p.stare === 'Emisă');
  a.forEach(p => { p.stare = stare; pfWrite_(p); }); return a.length > 0;
}
function leasing_() {
  const sh = tab_(LEASING, LCOLS, false); const n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, LCOLS.length).getValues().map(v => ({ nume: String(v[0]).trim(), cui: String(v[1]).trim(), regCom: String(v[2]).trim(), adresa: String(v[3]).trim() })).filter(x => x.nume);
}
const num_ = x => Math.round((Number(x) || 0) * 100) / 100;
const str_ = (x, n) => String(x == null ? '' : x).trim().slice(0, n || 300);
/**
 * Emite (sau reemite) proforma unei oferte. Datele vin din aplicație (client, vehicul, linii, totaluri), numărul îl dă serverul.
 * La reemitere proforma anterioară rămâne în arhivă cu starea „Înlocuită”.
 */
function proforma_(me, nr, d) {
  const g = getRow_(nr); const r = g.r;
  if (!(me.rol === 'admin' || owner_(me, r))) throw new Error('Proforma o emite vânzătorul ofertei sau un administrator');
  const ok = ['ofertata','negociere','cerere','proforma'].indexOf(r.etapa) >= 0 || (r.etapa === 'alocata' && !r.facturaAvansNr);
  if (!ok) throw new Error('Din etapa „' + ET[r.etapa].l + '” nu se mai emite proformă');
  const p = d.pf || {}; const tip = ['leasing','rezervare'].indexOf(d.tip) >= 0 ? d.tip : 'direct';
  // moneda: rezervarea e doar în lei; celelalte în EUR sau lei (convertite la cursul ales de vânzător)
  const moneda = tip === 'rezervare' || d.moneda === 'RON' ? 'RON' : 'EUR';
  const plataEur = moneda === 'EUR' ? (PF_PLATA_EUR[d.plataEur] ? d.plataEur : '') : '';
  if (moneda === 'EUR' && !plataEur) throw new Error('Alege cursul la care se face plata proformei în euro');
  const curs = Math.round((Number(d.curs) || 0) * 10000) / 10000;
  if (moneda === 'RON' && tip !== 'rezervare' && !(curs > 3 && curs < 10)) throw new Error('Completează cursul EUR/RON (ex. 5,0912)');
  const c = p.cump || {};
  if (!str_(c.nume)) throw new Error('Completează numele clientului');
  if (!str_(c.adr)) throw new Error('Completează adresa clientului');
  if (!str_(c.cui)) throw new Error('Completează CUI-ul / CNP-ul clientului');
  let fin = null;
  if (tip === 'leasing') {
    fin = p.fin || {};
    if (!str_(fin.nume) || !str_(fin.cui) || !str_(fin.adr)) throw new Error('Completează firma de leasing: denumire, CUI și adresă');
  }
  let linii = (p.linii || []).slice(0, 30).map(l => ({ n: str_(l.n, 200), q: num_(l.q) || 1, p: num_(l.p), d: (l.d || []).slice(0, 20).map(x => [str_(x[0], 60), str_(x[1], 160)]) }));
  if (!linii.length || !(linii[0].p > 0)) throw new Error('Oferta nu are preț pentru vehicul');
  let net, vat, gross, avPct = Number(r.avansPct) || 20, avans;
  if (tip === 'rezervare') {
    // o singură linie: rezervarea vehiculului; suma (cu TVA) o scrie vânzătorul, fără minim
    const suma = num_(String(d.suma || '').replace(/\s/g, '').replace(',', '.'));
    if (!(suma > 0)) throw new Error('Completează suma de rezervare (lei, cu TVA)');
    gross = suma; net = num_(suma / 1.21); vat = num_(gross - net);
    linii = [{ n: 'Rezervare autovehicul ' + linii[0].n, q: 1, p: net, d: linii[0].d }];
    avPct = ''; avans = gross;
  } else {
    if (moneda === 'RON') linii = linii.map(l => Object.assign(l, { p: num_(l.p * curs) }));
    net = num_(linii.reduce((s, l) => s + l.p * l.q, 0)); vat = num_(net * 0.21); gross = num_(net + vat);
    avans = tip === 'leasing' ? 0 : num_(gross * avPct / 100);
  }
  const all = proformeAll_();
  const next = all.reduce((m, x) => Math.max(m, Number(x.nr) || 0), 0) + 1;
  const nrS = String(next).padStart(6, '0'), numar = PF_SERIE + ' ' + nrS;
  const P = { numar, serie: PF_SERIE, nr: nrS, data: azi(), ofertaNr: String(nr), tip, brand: p.brand === 'cavan' ? 'cavan' : 'foton', moneda, plataEur,
    curs: moneda === 'RON' && tip !== 'rezervare' ? curs : '', cursInfo: moneda === 'RON' && tip !== 'rezervare' ? str_(d.cursInfo, 120) : '',
    cump: { nume: str_(c.nume, 160), cui: str_(c.cui, 40), rc: str_(c.rc, 40), adr: str_(c.adr), pers: str_(c.pers, 80), tel: str_(c.tel, 40), mail: str_(c.mail, 80), pf: !!c.pf },
    fin: fin && { nume: str_(fin.nume, 160), cui: str_(fin.cui, 40), rc: str_(fin.rc, 40), adr: str_(fin.adr) },
    linii, net, vat, gross, avansPct: avPct, avans,
    emitent: { nume: me.nume, email: me.email, telefon: String(me.telefon || '') } };
  const vechi = all.filter(x => x.ofertaNr === String(nr) && x.stare === 'Emisă');
  vechi.forEach(x => { x.stare = 'Înlocuită de ' + numar; pfWrite_(x); });
  const sh = tab_(PROF, PFCOLS, 'payload');
  const row = { _row: sh.getLastRow() + 1, numar, serie: PF_SERIE, nr: nrS, data: P.data, ofertaNr: String(nr), stare: 'Emisă', tip,
    cumparator: fin ? fin.nume : P.cump.nume, cui: fin ? fin.cui : P.cump.cui, utilizator: fin ? P.cump.nume : '', vanzator: r.vanzator, emitent: me.nume,
    moneda, totalFaraTVA: net, totalCuTVA: gross, avansPct: tip === 'direct' ? avPct : '', avans: tip === 'leasing' ? '' : avans, pdfLink: '', creat: nowIso(), payload: JSON.stringify(P) };
  pfWrite_(row);
  if (fin && !leasing_().some(x => x.cui.replace(/\D/g, '') === fin.cui.replace(/\D/g, ''))) tab_(LEASING, LCOLS, false).appendRow([P.fin.nume, P.fin.cui, P.fin.rc, P.fin.adr]);
  const reemis = r.etapa === 'proforma';
  r.proformaNr = numar; r.proformaData = P.data; r.proformaTip = tip; r.proformaAmanata = ''; r.proformaAlerta = '';
  if (!reemis) { r.etapa = 'proforma'; r.status = ET.proforma.l; r.etapaLa = nowIso(); }
  r.actualizat = nowIso(); writeRow_(g.sh, r);
  hist_(nr, 'proforma', me.nume, (reemis ? 'Proformă reemisă ' : 'Proformă emisă ') + numar + (vechi.length ? ' (înlocuiește ' + vechi.map(x => x.numar).join(', ') + ')' : '') +
    (fin ? ' · leasing ' + fin.nume : '') + (tip === 'rezervare' ? ' · rezervare ' + bani_(gross, moneda) + ' cu TVA' : ' · total ' + bani_(gross, moneda) + ' cu TVA' + (avans ? ' · avans ' + avPct + '% ' + bani_(avans, moneda) : '')) + (P.curs ? ' · curs ' + P.curs : ''));
  return { proforma: P, etapa: r.etapa };
}
// PDF-ul proformei (generat în aplicație) se salvează în Drive și pleacă pe e-mail la conducere
function proformaPdf_(me, numar, b64, name) {
  const p = proformeAll_().find(x => x.numar === numar); if (!p) throw new Error('Proforma ' + numar + ' nu există');
  const r = getRow_(p.ofertaNr).r;
  if (!(me.rol === 'admin' || owner_(me, r))) throw new Error('Nu ai acces la această proformă');
  if (!b64) throw new Error('Lipsește PDF-ul');
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', String(name || ('Proforma ' + numar + '.pdf')).replace(/[\\/:*?"<>|]/g, '-'));
  const prima = !p.pdfLink;
  p.pdfLink = folder_().createFile(blob).getUrl(); pfWrite_(p);
  if (prima) {
    const P = JSON.parse(p.payload || '{}');
    const html = '<p><b>' + esc_(me.nume) + '</b> a emis proforma <b>' + esc_(numar) + '</b>' + (p.tip === 'leasing' ? ' pentru leasing (finanțator ' + esc_(p.cumparator) + ', utilizator ' + esc_(p.utilizator) + ')' : '') + '.</p>' +
      '<p>' + (p.tip === 'rezervare' ? 'Proformă de rezervare: <b>' + bani_(p.totalCuTVA, P.moneda) + '</b> cu TVA' : 'Total ' + bani_(p.totalCuTVA, P.moneda) + ' cu TVA' + (P.avans ? ' · avans ' + P.avansPct + '% = <b>' + bani_(P.avans, P.moneda) + '</b>' : '')) + '. PDF-ul este atașat.</p>' + rez_(r);
    const opt = { htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + html + '</div>', attachments: [blob], name: SENDER };
    if (r.emailVanzator) opt.replyTo = r.emailVanzator;
    try { MailApp.sendEmail(OFERTA_NOUA_CATRE, 'Proformă emisă ' + numar + ' – ' + r.vanzator + ' – ' + r.client, 'Proformă ' + numar + ' – PDF atașat.', opt); } catch (e) { Logger.log(e); }
  }
  return { pdfLink: p.pdfLink, emailTrimis: prima };
}
/**
 * Șterge o proformă (doar administrator; ex. proformă de test sau greșită). Rândul dispare din „Proforme”, PDF-ul merge în coș.
 * Dacă era proforma curentă a ofertei: revine proforma pe care a înlocuit-o, iar dacă nu există, oferta revine la „Ofertată”.
 * O proformă cu avansul încasat nu se șterge. În Istoric rămâne o notă.
 */
function proformaSterge_(me, numar, motiv) {
  if (me.rol !== 'admin') throw new Error('Doar administratorii pot șterge proforme');
  const all = proformeAll_(); const p = all.find(x => x.numar === numar);
  if (!p) throw new Error('Proforma ' + numar + ' nu există');
  if (p.stare === 'Încasată') throw new Error('Proforma ' + numar + ' are avansul încasat și nu se mai poate șterge');
  const g = getRow_(p.ofertaNr); const r = g.r;
  const curenta = r.proformaNr === numar;
  if (curenta && r.etapa !== 'proforma') throw new Error('Oferta a trecut în etapa „' + ET[r.etapa].l + '” – proforma nu se mai poate șterge');
  const m = String(p.pdfLink || '').match(/[-\w]{25,}/);
  if (m) { try { DriveApp.getFileById(m[0]).setTrashed(true); } catch (e) {} }
  tab_(PROF, PFCOLS, 'payload').deleteRow(p._row);
  let det = 'Proformă ' + numar + ' ștearsă' + (str_(motiv) ? ' · ' + str_(motiv, 300) : '');
  if (curenta) {
    const prev = all.filter(x => x.ofertaNr === p.ofertaNr && x.stare === 'Înlocuită de ' + numar).sort((a, b) => String(b.nr).localeCompare(String(a.nr)))[0];
    if (prev) {
      prev.stare = 'Emisă'; prev._row = prev._row > p._row ? prev._row - 1 : prev._row; pfWrite_(prev);
      r.proformaNr = prev.numar; r.proformaData = prev.data; r.proformaTip = prev.tip; det += ' · proforma curentă redevine ' + prev.numar;
    } else {
      r.proformaNr = ''; r.proformaData = ''; r.proformaTip = ''; r.proformaAmanata = ''; r.proformaAlerta = '';
      r.etapa = 'ofertata'; r.status = ET.ofertata.l; r.etapaLa = nowIso(); det += ' · oferta revine la „' + ET.ofertata.l + '”';
    }
    r.actualizat = nowIso(); writeRow_(g.sh, r);
  }
  hist_(p.ofertaNr, r.etapa, me.nume, det);
  return { etapa: r.etapa };
}
// Proformă neîncasată: vânzătorul spune ce s-a întâmplat. „timp” = alerta revine peste 3 zile lucrătoare.
function proformaStinge_(me, nr, motiv, nota) {
  const g = getRow_(nr); const r = g.r;
  if (r.etapa !== 'proforma') throw new Error('Oferta nu mai este în etapa „' + ET.proforma.l + '”');
  if (!(me.rol === 'admin' || owner_(me, r))) throw new Error('Doar vânzătorul ofertei sau un administrator');
  nota = str_(nota, 300);
  if (motiv === 'timp') {
    r.proformaAmanata = nowIso(); r.proformaAlerta = ''; r.actualizat = nowIso(); writeRow_(g.sh, r);
    hist_(nr, 'proforma', me.nume, 'Clientul mai are nevoie de timp' + (nota ? ' · ' + nota : '') + ' – reamintire peste ' + PF_ZILE + ' zile lucrătoare');
    return { etapa: 'proforma' };
  }
  const M = { renuntat: 'Clientul a renunțat', nuraspunde: 'Fără răspuns' }[motiv];
  if (!M) throw new Error('Alege ce s-a întâmplat cu proforma');
  return etapa_(me, nr, 'pierduta', { motiv: M, nota: nota });
}
function aprobare_(me, nr, decizie, motiv) {
  if (me.rol !== 'admin') throw new Error('Doar administratorii aprobă prețuri');
  const g = getRow_(nr); const r = g.r;
  if (r.etapa !== 'aprobare') throw new Error('Oferta nu așteaptă aprobare de preț');
  const pf = Number(r.pretFinal) || 0;
  if (decizie === 'aproba') {
    r.pretAprobat = pf; r.aprobare = 'Aprobat de ' + me.nume + ' la ' + fdt_(azi());
    r.etapa = 'ofertata'; r.status = ET.ofertata.l; r.etapaLa = nowIso(); r.actualizat = nowIso();
    writeRow_(g.sh, r); hist_(nr, 'ofertata', me.nume, 'Preț aprobat: ' + eur_(pf) + ' (minim agent ' + eur_(r.pretMinim) + ')');
    mail_(r.emailVanzator, 'Preț aprobat – ' + r.client + ' (' + nr + ')', '<p>' + esc_(me.nume) + ' a aprobat prețul vehiculului de <b>' + eur_(pf) + '</b> fără TVA. Poți descărca și trimite oferta clientului din Arhivă → Ofertă.</p>' + rez_(r));
  } else {
    if (!String(motiv || '').trim()) throw new Error('Scrie motivul respingerii');
    r.aprobare = 'Respins de ' + me.nume + ': ' + String(motiv).trim();
    r.etapa = 'respinsa'; r.status = ET.respinsa.l; r.etapaLa = nowIso(); r.actualizat = nowIso();
    writeRow_(g.sh, r); hist_(nr, 'respinsa', me.nume, String(motiv).trim());
    mail_(r.emailVanzator, 'Preț respins – ' + r.client + ' (' + nr + ')', '<p>' + esc_(me.nume) + ' a respins prețul de <b>' + eur_(pf) + '</b> fără TVA (minim agent ' + eur_(r.pretMinim) + ').</p><p>Motiv: ' + esc_(motiv) + '</p><p>Deschide oferta din Arhivă (butonul Ofertă), modifică prețul și salvează din nou.</p>' + rez_(r));
  }
  return { etapa: r.etapa };
}
function trimiteCerereAprobare_(r, blob) {
  const pf = Number(r.pretFinal) || 0, min = Number(r.pretMinim) || 0;
  const html = '<p><b>' + esc_(r.vanzator) + '</b> cere aprobarea unui preț sub minimul de agent.</p>' +
    '<table style="border-collapse:collapse"><tr><td style="padding:3px 12px 3px 0;color:#666">Preț vehicul ofertat</td><td><b>' + eur_(pf) + '</b> fără TVA</td></tr>' +
    '<tr><td style="padding:3px 12px 3px 0;color:#666">Preț minim agent</td><td>' + eur_(min) + '</td></tr>' +
    '<tr><td style="padding:3px 12px 3px 0;color:#666">Sub minim cu</td><td><b>' + eur_(min - pf) + '</b></td></tr></table><br>' + rez_(r) +
    '<p>Aprobă sau respinge din aplicație: Arhivă → oferta → Etape.</p>';
  const opt = { htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + html + '<p><a href="' + APP_URL + '" style="background:#3A4759;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none">Deschide aplicația</a></p></div>', name: SENDER };
  if (blob) opt.attachments = [blob];
  if (r.emailVanzator) opt.replyTo = r.emailVanzator;
  try { MailApp.sendEmail(OFERTA_NOUA_CATRE, 'Cerere aprobare preț – ' + r.vanzator + ' – ' + r.client, 'Cerere aprobare preț ' + r.nr, opt); } catch (e) { Logger.log(e); }
}
function sterge_(me, nrs) {
  if (me.rol !== 'admin') throw new Error('Doar administratorii pot șterge oferte');
  nrs = (nrs || []).map(String).filter(Boolean); if (!nrs.length) throw new Error('Nicio ofertă selectată');
  const set = {}; nrs.forEach(n => set[n] = true);
  const a = rowsAll_(); const del = a.rows.filter(r => set[String(r.nr)]).sort((x, y) => y._row - x._row);
  let pdf = 0;
  del.forEach(r => {
    const m = String(r.pdfLink || '').match(/[-\w]{25,}/);
    if (m) { try { DriveApp.getFileById(m[0]).setTrashed(true); pdf++; } catch (e) {} }
    a.sh.deleteRow(r._row);
  });
  const hs = tab_(HIST, HCOLS, false); const n = hs.getLastRow();
  if (n > 1) { const v = hs.getRange(2, 2, n - 1, 1).getValues(); for (let i = v.length - 1; i >= 0; i--) if (set[String(v[i][0])]) hs.deleteRow(i + 2); }
  Logger.log(me.nume + ' a șters ofertele: ' + del.map(r => r.nr).join(', '));
  return { sterse: del.length, pdf };
}
function comision_(me, nr, d) {
  if (me.rol !== 'admin') throw new Error('Doar administratorii setează comisioane');
  const g = getRow_(nr); const r = g.r;
  const v = String(d.comision == null ? '' : d.comision).replace(',', '.').trim();
  if (v && isNaN(Number(v))) throw new Error('Comision invalid');
  if (d.comisionPlatit && !validDate_(d.comisionPlatit)) throw new Error('Data plății invalidă');
  r.comision = v; r.comisionNota = String(d.comisionNota || '').trim(); r.comisionPlatit = d.comisionPlatit || ''; r.actualizat = nowIso();
  writeRow_(g.sh, r); hist_(nr, 'comision', me.nume, 'Comision ' + (v ? eur_(v) : 'șters') + (r.comisionPlatit ? ' · plătit ' + fdt_(r.comisionPlatit) : ''));
  return {};
}

/* ---------------- utilizatori ---------------- */
function usersPub_() {
  const fixed = Object.keys(ADMINS).map(k => pub_(user_(k)));
  return fixed.concat(usersAll_().map(pub_));
}
function credMail_(u, pass) {
  mail_(u.email, 'Cont Ofertare FOTON – ' + u.nume,
    '<p>Bună ziua, ' + esc_(u.nume) + ',</p><p>Ți-a fost creat contul în aplicația de ofertare <b>Foton by Inter Cargo</b>.</p>' +
    '<table><tr><td style="color:#666;padding-right:12px">Adresă</td><td><a href="' + APP_URL + '">' + APP_URL + '</a></td></tr>' +
    '<tr><td style="color:#666;padding-right:12px">Utilizator</td><td><b>' + esc_(u.user) + '</b></td></tr>' +
    '<tr><td style="color:#666;padding-right:12px">Parolă</td><td><b>' + esc_(pass) + '</b></td></tr></table>' +
    '<p>După prima autentificare îți poți schimba parola din ⚙ Setări.</p>');
}
function userSave_(me, u, trimite) {
  const user = lc_(u.user); const sh = tab_(USERS, UCOLS, false);
  if (!/^[a-z0-9_-]{2,30}$/.test(user)) throw new Error('Utilizator invalid (litere mici, cifre, - sau _)');
  if (ADMINS[user]) throw new Error('Acest utilizator este rezervat');
  if (!String(u.nume || '').trim()) throw new Error('Completează numele');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(u.email || ''))) throw new Error('E-mail invalid');
  const rol = ['vanzator','operator','admin'].indexOf(u.rol) >= 0 ? u.rol : 'vanzator';
  const ex = usersAll_().find(x => x.user === user);
  const res = {};
  if (ex) {
    sh.getRange(ex._row, 2, 1, 5).setValues([[String(u.nume).trim(), String(u.email).trim(), String(u.telefon || '').trim(), rol, u.activ === false ? false : true]]);
  } else {
    const pass = genPass_();
    sh.appendRow([user, String(u.nume).trim(), String(u.email).trim(), String(u.telefon || '').trim(), rol, true, hashParola(user, pass), nowIso()]);
    sh.getRange(sh.getLastRow(), 4).setNumberFormat('@').setValue(String(u.telefon || '').trim());
    res.parola = pass;
    if (trimite) { credMail_({ user, nume: u.nume, email: u.email }, pass); res.trimis = true; }
  }
  return res;
}
function userReset_(me, user, trimite) {
  user = lc_(user); if (ADMINS[user] && user !== me.user) throw new Error('Parola unui administrator fix o schimbă doar el');
  const pass = genPass_();
  if (ADMINS[user]) PROPS.setProperty('PW_' + user, hashParola(user, pass));
  else {
    const ex = usersAll_().find(x => x.user === user); if (!ex) throw new Error('Utilizator inexistent');
    tab_(USERS, UCOLS, false).getRange(ex._row, UCOLS.indexOf('hash') + 1).setValue(hashParola(user, pass));
    PROPS.deleteProperty('PW_' + user);
    if (trimite) credMail_(ex, pass);
  }
  return { parola: pass, trimis: !!trimite };
}
function parola_(me, vechi, noua) {
  if (!checkPass_(me.user, vechi)) throw new Error('Parola actuală este greșită');
  if (String(noua || '').length < 8) throw new Error('Parola nouă trebuie să aibă minim 8 caractere');
  PROPS.setProperty('PW_' + me.user, hashParola(me.user, String(noua)));
  return {};
}
function telefon_(me, tel) {
  tel = String(tel || '').trim();
  if (ADMINS[me.user]) PROPS.setProperty('TEL_' + me.user, tel);
  else { const ex = usersAll_().find(x => x.user === me.user); tab_(USERS, UCOLS, false).getRange(ex._row, UCOLS.indexOf('telefon') + 1).setNumberFormat('@').setValue(tel); }
  return {};
}

/* ---------------- e-mailuri ---------------- */
function mail_(to, subj, html, cc) {
  if (!to) return;
  const opt = { htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + html +
    '<p style="margin-top:18px"><a href="' + APP_URL + '" style="background:#3A4759;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none">Deschide aplicația de ofertare</a></p>' +
    '<p style="color:#888;font-size:12px">Inter Cargo Grup · Foton by Inter Cargo</p></div>', name: SENDER };
  if (cc) opt.cc = cc;
  try { MailApp.sendEmail(to, subj, html.replace(/<[^>]+>/g, ' '), opt); } catch (e) { Logger.log('mail: ' + e); }
}
function rez_(r) {
  const rand = (k, v) => v ? '<tr><td style="padding:3px 12px 3px 0;color:#666">' + k + '</td><td style="padding:3px 0"><b>' + esc_(v) + '</b></td></tr>' : '';
  return '<table style="border-collapse:collapse">' + rand('Nr. ofertă', r.nr) + rand('Vânzător', r.vanzator) + rand('Client', r.client) + rand('Model', r.model) +
    rand('Culoare', r.culoare) + rand('Serie (VIN)', r.vin) + rand('Total cu TVA', eur_(r.totalCuTVA)) + rand('Etapă', ET[r.etapa] ? ET[r.etapa].l : r.status) + '</table>';
}
function notify_(t, r, by, det) {
  const adm = OFERTA_NOUA_CATRE, vz = r.emailVanzator; const cl = r.client || '';
  const L = ET[t].l;
  if (t === 'cerere') mail_(adm, 'Cerere alocare serie – ' + r.vanzator + ' – ' + cl, '<p>Clientul a acceptat oferta. Vânzătorul cere alocarea unei serii din Stoc DBK.</p>' + rez_(r));
  else if (t === 'alocata') {
    if (r.etapa === 'proforma') mail_(vz, 'Serie alocată ' + r.vin + ' – ' + cl, '<p>Seria <b>' + esc_(r.vin) + '</b> a fost rezervată pe oferta ta. Dacă finanțatorul sau clientul are nevoie de VIN pe proformă, apasă în aplicație „Reemite proforma”.</p>' + rez_(r));
    else if (r.facturaAvansNr) mail_(vz, 'Serie alocată ' + r.vin + ' – ' + cl, '<p>Seria <b>' + esc_(r.vin) + '</b> a fost alocată pe comanda clientului tău. Comanda merge mai departe spre livrare.</p>' + rez_(r));
    else mail_(vz, 'Serie alocată ' + r.vin + ' – ' + cl + ': emite proforma', '<p>Seria <b>' + esc_(r.vin) + '</b> a fost alocată pe oferta ta. Pasul următor: emite factura proformă din aplicație.</p>' + rez_(r));
  }
  else if (t === 'avans') mail_(adm, (r.etapa === 'alocata' ? 'Comandă plasată' : 'Avans încasat – alocă serie') + ' – ' + r.vanzator + ' – ' + cl, '<p>' + esc_(det) + '</p>' + (r.etapa === 'alocata' ? '<p>Seria ' + esc_(r.vin) + ' era deja alocată.</p>' : '<p>Alocă o serie din Stoc DBK: Arhivă → oferta → Etape.</p>') + rez_(r), vz);
  else if (['incarcat','acte','pdi','finalizata'].indexOf(t) >= 0) mail_(vz, L + ' – ' + cl + ' (' + r.nr + ')', '<p>Comanda clientului tău a trecut în etapa <b>' + esc_(L) + '</b>.' + (det ? ' ' + esc_(det) : '') + '</p>' + rez_(r));
  else if (t === 'pierduta' || t === 'anulata') {
    if (by.rol === 'admin' && by.user !== r.vanzatorUser) mail_(vz, 'Ofertă ' + L.toLowerCase() + ' – ' + cl + ' (' + r.nr + ')', '<p>' + esc_(det) + '</p>' + rez_(r));
    else mail_(adm, 'Ofertă ' + L.toLowerCase() + ' – ' + r.vanzator + ' – ' + cl, '<p>Motiv: ' + esc_(det) + '</p>' + rez_(r));
  }
}
function trimiteOfertaNoua_(r, blob, catre) {
  const subiect = 'Ofertă nouă – ' + (r.vanzator || 'vânzător') + ' – ' + (r.client || 'client');
  const rand = (k, v) => v ? '<tr><td style="padding:3px 12px 3px 0;color:#666">' + k + '</td><td style="padding:3px 0"><b>' + esc_(v) + '</b></td></tr>' : '';
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<p>A fost emisă o ofertă nouă în aplicația Foton by Inter Cargo.</p><table style="border-collapse:collapse">' +
    rand('Nr. ofertă', r.nr) + rand('Vânzător', r.vanzator) + rand('Client', r.client) + rand('CUI', r.cui) +
    rand('Telefon client', r.telefon) + rand('Model', r.model) + rand('Culoare', r.culoare) +
    rand('Total fără TVA', eur_(r.totalFaraTVA)) + rand('Total cu TVA', eur_(r.totalCuTVA)) +
    rand('Termen livrare', r.termen) + rand('Valabilă până la', fdt_(r.valabilaPana)) +
    '</table><p>Oferta este atașată în PDF' + (r.pdfLink ? ' și salvată în <a href="' + r.pdfLink + '">Drive</a>' : '') + '.</p></div>';
  const opt = { htmlBody: html, attachments: [blob], name: SENDER };
  if (r.emailVanzator) opt.replyTo = r.emailVanzator;
  MailApp.sendEmail(catre || OFERTA_NOUA_CATRE, subiect, 'Ofertă nouă ' + r.nr + ' – PDF atașat.', opt);
}
/** Test manual: e-mail „Ofertă nouă” de probă doar către primul administrator. */
function testEmailOferta() {
  const blob = Utilities.newBlob('<h1>Ofertă de test</h1>', 'text/html', 'test.html').getAs('application/pdf').setName('Oferta TEST.pdf');
  trimiteOfertaNoua_({ nr: 'ICG-OF-TEST', vanzator: 'Vânzător Test', client: 'Client Test SRL', model: 'FOTON Tunland V9', totalCuTVA: 48400 }, blob, OFERTA_NOUA_CATRE.split(',')[0]);
}

/* ---------------- verificare zilnică (trigger ora 8) ---------------- */
function cheie(nr) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(nr), TOKEN)).slice(0, 16); }
function zileLucr_(iso) { // zile lucrătoare scurse de la iso până azi
  const a = new Date(iso); if (isNaN(a)) return 0; const b = new Date(); let n = 0; const d = new Date(a);
  d.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  while (d < b) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
function verificaExpirate() {
  const g = rowsAll_(); const url = ScriptApp.getService().getUrl(); const today = azi();
  const wd = new Date().getDay(); const lucru = wd !== 0 && wd !== 6;
  const cereri = [];
  g.rows.forEach(r => {
    // 1. ofertă expirată fără răspuns → feedback de la vânzător
    if (['ofertata','negociere'].indexOf(r.etapa) >= 0 && r.valabilaPana && String(r.valabilaPana) < today && !r.notificat && r.emailVanzator) {
      const link = url + '?action=feedback&nr=' + encodeURIComponent(r.nr) + '&k=' + cheie(r.nr);
      const html = '<p>Bună ziua, ' + esc_(r.vanzator) + ',</p><p>Oferta <b>' + esc_(r.nr) + '</b> pentru <b>' + esc_(r.client) + '</b> (' + esc_(r.model) + ', ' + eur_(r.totalCuTVA) + ' cu TVA) a expirat pe ' + fdt_(r.valabilaPana) + '.</p>' +
        '<p>Spune-ne ce a răspuns clientul: a acceptat (urmează proforma), a refuzat (și de ce) sau negocierea continuă.</p>' +
        '<p><a href="' + link + '" style="background:#05C3DE;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Trimite feedback</a></p>';
      mail_(r.emailVanzator, 'Ofertă expirată ' + r.nr + ' – ' + r.client + ': ce a răspuns clientul?', html, ADMIN_EMAILS || null);
      r.notificat = nowIso(); writeRow_(g.sh, r);
    }
    if (!lucru) return;
    const z = zileLucr_(r.etapaLa);
    // 2. ofertă veche: serie alocată, fără proformă după 2 zile lucrătoare
    if (r.etapa === 'alocata' && !r.facturaAvansNr && z >= 2) mail_(r.emailVanzator, 'Reamintire: emite proforma – ' + r.client + ' (' + r.nr + ')',
      '<p>Seria <b>' + esc_(r.vin) + '</b> este alocată de ' + z + ' zile lucrătoare pe oferta ta, dar proforma nu este emisă.</p><p>Emite factura proformă din aplicație (Arhivă → oferta → Etape).</p>' + rez_(r), z >= 4 ? OFERTA_NOUA_CATRE : null);
    // 3. proformă emisă, avans neîncasat după 3 zile lucrătoare (sau 3 zile după „mai are nevoie de timp”). O alertă pe fiecare termen.
    if (r.etapa === 'proforma') {
      const ref = String(r.proformaAmanata || r.proformaData || r.etapaLa || '');
      const zp = zileLucr_(ref);
      if (zp >= PF_ZILE && !(r.proformaAlerta && String(r.proformaAlerta) >= ref)) {
        mail_(r.emailVanzator, 'Avans neîncasat – proforma ' + r.proformaNr + ' – ' + r.client,
          '<p>Bună ziua, ' + esc_(r.vanzator) + ',</p><p>Proforma <b>' + esc_(r.proformaNr) + '</b> din ' + fdt_(r.proformaData) + ' pentru <b>' + esc_(r.client) + '</b> nu are avansul încasat de ' + zp + ' zile lucrătoare' + (r.proformaAmanata ? ' (de la ultima amânare, ' + fdt_(r.proformaAmanata) + ')' : '') + '.</p>' +
          '<p>Intră în aplicație (Raport → Proforme neîncasate) și alege ce s-a întâmplat:</p><ul><li><b>Avans încasat</b>: treci factura fiscală de avans, data și suma încasată;</li><li><b>Clientul mai are nevoie de timp</b>: alerta revine peste ' + PF_ZILE + ' zile lucrătoare;</li><li><b>Clientul a renunțat</b> sau <b>Clientul nu mai răspunde</b>: proforma se anulează și oferta trece la pierdute.</li></ul>' + rez_(r));
        r.proformaAlerta = nowIso(); writeRow_(g.sh, r);
      }
    }
    // 4. de făcut de administrator: avans încasat fără serie, cereri de alocare (oferte vechi), aprobări de preț
    if ((r.etapa === 'cerere' || r.etapa === 'aprobare' || r.etapa === 'avans') && z >= 1) cereri.push(r);
  });
  if (cereri.length && lucru) mail_(OFERTA_NOUA_CATRE, 'Cereri în așteptare (alocare serie / aprobare preț): ' + cereri.length,
    '<p>Aceste oferte așteaptă o decizie de la administrator:</p><ul>' + cereri.map(r => '<li><b>' + esc_(ET[r.etapa].l) + '</b> · <b>' + esc_(r.nr) + '</b> – ' + esc_(r.vanzator) + ' – ' + esc_(r.client) + ' – ' + esc_(r.model) + ' (' + esc_(r.culoare) + ')</li>').join('') + '</ul>');
}

/* ---------------- formular feedback (link din e-mail) ---------------- */
function doGet(e) {
  const p = e.parameter || {};
  if (p.action !== 'feedback') return HtmlService.createHtmlOutput('Foton by Inter Cargo');
  if (p.k !== cheie(p.nr)) return HtmlService.createHtmlOutput('Link invalid.');
  let r; try { r = getRow_(p.nr).r; } catch (err) { return HtmlService.createHtmlOutput('Oferta nu există.'); }
  const deschisa = ['ofertata','negociere'].indexOf(r.etapa) >= 0;
  const motive = ['Preț','Termen de livrare','A ales concurența','Finanțare / leasing','Clientul a renunțat','Fără răspuns','Altul'];
  const h = '<div style="font-family:Arial;max-width:520px;margin:20px auto;padding:0 14px">' +
    '<h2 style="color:#3A4759">Feedback ofertă ' + esc_(r.nr) + '</h2><p>' + esc_(r.client) + ' · ' + esc_(r.model) + ' · vânzător ' + esc_(r.vanzator) + '</p>' +
    (!deschisa ? '<p style="background:#e3f2ea;padding:10px">Oferta este deja în etapa: <b>' + esc_(ET[r.etapa].l) + '</b>.</p></div>' :
    '<form id="f" onsubmit="event.preventDefault();var f=this;var d={nr:f.nr.value,k:f.k.value,rez:(f.querySelector(\'input[name=rez]:checked\')||{}).value,motiv:f.motiv.value,com:f.com.value};if(d.rez===\'pierduta\'&&!d.motiv){alert(\'Alege motivul refuzului.\');return}f.querySelector(\'button\').disabled=true;google.script.run.withSuccessHandler(function(m){document.body.innerHTML=\'<h2 style=&quot;font-family:Arial;color:#3A4759;max-width:520px;margin:30px auto&quot;>\'+m+\'</h2>\'}).salveazaFeedback(d)"><input type="hidden" name="nr" value="' + esc_(r.nr) + '"><input type="hidden" name="k" value="' + esc_(p.k) + '">' +
    '<p><b>Răspunsul clientului</b><br>' +
    '<label><input type="radio" name="rez" value="accept" required> A acceptat oferta – urmează să emit proforma</label><br>' +
    '<label><input type="radio" name="rez" value="pierduta"> A refuzat oferta</label><br>' +
    '<label><input type="radio" name="rez" value="negociere"> Negocierea continuă (+7 zile valabilitate)</label></p>' +
    '<p><b>Motiv refuz</b> (obligatoriu la refuz)<br><select name="motiv" style="width:100%;padding:8px"><option value="">–</option>' + motive.map(m => '<option>' + m + '</option>').join('') + '</select></p>' +
    '<p><b>Comentariu</b><br><textarea name="com" rows="4" style="width:100%"></textarea></p>' +
    '<button style="background:#3A4759;color:#fff;border:0;padding:12px 18px;border-radius:6px">Trimite</button></form></div>');
  return HtmlService.createHtmlOutput(h).setTitle('Feedback ofertă').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function salveazaFeedback(p) {
  if (p.k !== cheie(p.nr)) return 'Link invalid.';
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const r = getRow_(p.nr).r; const own = user_(r.vanzatorUser) || { user: r.vanzatorUser, nume: r.vanzator, email: r.emailVanzator, rol: 'vanzator' };
    // „accept”: clientul a acceptat – oferta rămâne deschisă (+7 zile) până când vânzătorul emite proforma din aplicație
    const acc = p.rez === 'accept';
    const t = p.rez === 'pierduta' ? 'pierduta' : 'negociere';
    const txt = acc ? 'Clientul a acceptat – urmează proforma' : ET[t].l;
    if (t === 'negociere' && r.etapa === 'negociere') { // prelungire
      const g = getRow_(p.nr); const x = new Date(); x.setDate(x.getDate() + 7);
      g.r.valabilaPana = Utilities.formatDate(x, 'Europe/Bucharest', 'yyyy-MM-dd'); g.r.notificat = ''; g.r.feedback = azi() + ' · ' + txt + (p.com ? ' · ' + p.com : '');
      writeRow_(g.sh, g.r); hist_(p.nr, 'negociere', own.nume, 'Feedback: ' + (acc ? txt : 'negocierea continuă') + ', +7 zile' + (p.com ? ' · ' + p.com : ''));
    } else {
      etapa_(Object.assign({}, own, { rol: 'vanzator', user: r.vanzatorUser || own.user }), p.nr, t, { motiv: p.motiv || '', nota: (acc ? txt + (p.com ? ' · ' : '') : '') + (p.com || '') });
      const g = getRow_(p.nr); g.r.feedback = azi() + ' · ' + txt + (p.com ? ' · ' + p.com : ''); writeRow_(g.sh, g.r);
    }
    return 'Mulțumim! Răspunsul pentru oferta ' + p.nr + ' a fost salvat: ' + txt + '.' + (acc ? ' Emite factura proformă din aplicație.' : '');
  } catch (err) { return 'Nu s-a putut salva: ' + (err.message || err); }
  finally { lock.releaseLock(); }
}

/* ---------------- curs BNR EUR (pentru proformele în lei) ---------------- */
function cursBnr_() {
  const c = CacheService.getScriptCache(); const k = c.get('BNR_EUR'); if (k) return JSON.parse(k);
  const res = UrlFetchApp.fetch('https://www.bnr.ro/nbrfxrates.xml', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'BNR nu răspunde (' + res.getResponseCode() + ')' };
  const x = res.getContentText(); const m = x.match(/<Rate currency="EUR">([\d.]+)<\/Rate>/), d = x.match(/<Cube date="(\d{4}-\d\d-\d\d)">/);
  if (!m) return { ok: false, error: 'Cursul EUR lipsește din fișierul BNR' };
  const o = { ok: true, curs: Number(m[1]), data: d ? d[1] : azi() }; c.put('BNR_EUR', JSON.stringify(o), 3600); return o;
}

/* ---------------- ANAF ---------------- */
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
