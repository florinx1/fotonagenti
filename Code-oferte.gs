/**
 * Arhivă oferte FOTON – Inter Cargo
 * Backend Google Apps Script pentru aplicația de ofertare.
 *
 * Instalare:
 * 1. Creează un Google Sheet nou, de ex. „Arhivă oferte FOTON”.
 * 2. Extensii → Apps Script, șterge tot și lipește acest fișier.
 * 3. Schimbă TOKEN mai jos cu o parolă a voastră.
 * 4. Rulează o dată funcția setup (alege-o din listă și apasă Run), acceptă permisiunile.
 * 5. Implementare → Implementare nouă → Tip: Aplicație web
 *      Executare ca: Eu · Cine are acces: Oricine
 *    Copiază adresa „Web app URL”.
 * 6. În aplicația de ofertare: ⚙ Setări → lipește adresa și tokenul → Salvează → Testează conexiunea.
 */
const TOKEN = 'icgoferte2026';
const ADMIN_KEY = 'icgadmin2026'; // codul administratorilor care pot aloca serii din Stoc DBK – schimbați-l
const SHEET = 'Oferte';
const COLS = ['nr','data','valabilaPana','vanzator','client','cui','telefon','email','model','culoare',
  'pretLista','pretDiscount','pretSuport','pretFinal','totalFaraTVA','totalCuTVA','avansPct','termen',
  'status','motiv','actualizat','modelId','alocare','vin','alocatDe','alocatLa','payload'];

function setup() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.hideColumns(COLS.length); // payload (datele complete ale ofertei)
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (req.token !== TOKEN) return out({ ok: false, error: 'Token greșit' });
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (req.action === 'list')   return out({ ok: true, rows: list() });
      if (req.action === 'save')   { save(req.rec); return out({ ok: true }); }
      if (req.action === 'status') { setStatus(req.nr, req.status, req.motiv); return out({ ok: true }); }
      if (req.action === 'admin')  return out({ ok: req.adminKey === ADMIN_KEY });
      if (req.action === 'aloc') {
        // vânzătorul poate doar CERE alocarea; alocarea/anularea seriei cere codul de administrator
        if (req.alocare !== 'Cerută' || req.vin) { if (req.adminKey !== ADMIN_KEY) return out({ ok: false, error: 'Doar administratorii pot aloca serii' }); }
        setAlloc(req.nr, req.alocare, req.vin, req.de); return out({ ok: true });
      }
      return out({ ok: false, error: 'Acțiune necunoscută' });
    } finally { lock.releaseLock(); }
  } catch (err) { return out({ ok: false, error: String(err) }); }
}

function sheet() { const sh = SpreadsheetApp.getActive().getSheetByName(SHEET); if (!sh) { setup(); return SpreadsheetApp.getActive().getSheetByName(SHEET); } return sh; }

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

function save(rec) {
  const sh = sheet(); const row = findRow(sh, rec.nr);
  if (row > 0) { // oferta re-generată: păstrăm statusul și motivul existente
    const cur = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
    rec.status = cur[COLS.indexOf('status')] || rec.status; rec.motiv = cur[COLS.indexOf('motiv')] || '';
    ['alocare','vin','alocatDe','alocatLa'].forEach(c => { rec[c] = cur[COLS.indexOf(c)] || ''; });
  }
  const vals = [COLS.map(c => rec[c] === undefined ? '' : rec[c])];
  sh.getRange(row > 0 ? row : sh.getLastRow() + 1, 1, 1, COLS.length).setNumberFormat('@').setValues(vals);
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

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
