"""Rulare lunară DGPCI (GitHub Actions).

1. Citește lista statisticilor DGPCI și găsește lunile noi (după ultima lună din db/).
2. Descarcă arhiva, verifică mărimea și luna, o extrage, o procesează (parse.py) și face controlul cu ACEA.
3. Reconstruiește datele aplicației (../data/dgpci.json) și Excelul.
4. Trimite în Google Drive / Google Sheets prin Apps Script (dacă sunt setate GAS_URL și GAS_TOKEN):
   arhiva originală, foaia lunii în baza de date Sheets și Excelul complet.
Argumente: --backfill  -> retrimite în Drive/Sheets toate lunile, nu doar cele noi.
           --force YYYYMM -> reprocesează o lună.
Iese cu cod != 0 la orice eroare de control, ca GitHub să trimită e-mail de eșec.
"""
import base64, datetime, glob, json, os, re, subprocess, sys, zipfile
import requests
import pandas as pd

os.chdir(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://dgpci.mai.gov.ro'
MONTHS = {'ianuarie': 1, 'februarie': 2, 'martie': 3, 'aprilie': 4, 'mai': 5, 'iunie': 6, 'iulie': 7,
          'august': 8, 'septembrie': 9, 'octombrie': 10, 'noiembrie': 11, 'decembrie': 12}
GAS_URL, GAS_TOKEN = os.environ.get('GAS_URL', '').strip(), os.environ.get('GAS_TOKEN', '').strip()
state = json.load(open('state.json'))
args = sys.argv[1:]
BACKFILL = '--backfill' in args
FORCE = args[args.index('--force') + 1] if '--force' in args else None
summary = []


def log(msg):
    print(msg, flush=True)
    summary.append(msg)


def dgpci_list():
    items = {}
    this_year = datetime.date.today().year
    for y in (this_year - 1, this_year):
        r = requests.post(BASE + '/drpciv-api/readNewsMedia', timeout=60,
                          json={'language': 'RO', 'page': 1, 'maxrows': 40, 'category': 'statistica', 'year': y})
        if r.status_code != 200:
            raise SystemExit(f'DGPCI lista {y}: HTTP {r.status_code} {r.text[:300]}')
        for d in r.json()['data']['news']:
            ro = next((i for i in d['i18n'] if i['language'] == 'RO'), None)
            if not ro or not ro.get('files'):
                continue
            m = re.match(r'^\s*înmatriculări\s+(\w+)\s+(\d{4})\s*$', ro['titleDescription'], re.I)
            if not m or m.group(1).lower() not in MONTHS:
                continue
            ym = f"{m.group(2)}{MONTHS[m.group(1).lower()]:02d}"
            f = ro['files'][0]
            items[ym] = dict(url=BASE + '/assets/uploads/stiri-comunicate/' + f['urlFileName'], size=int(f['size']),
                             ext=f['urlFileName'].rsplit('.', 1)[-1].lower(), pub=d.get('startDateDisplay', '')[:10])
    return items


def extract(ym, path, ext):
    out = f'raw/{ym}'
    os.makedirs(out, exist_ok=True)
    if ext == 'zip':
        with zipfile.ZipFile(path) as z:
            z.extractall(out)
            names = z.namelist()
    elif ext == 'rar':
        r = subprocess.run(['node', 'tools/unrar.mjs', path, out], capture_output=True, text=True, check=True)
        names = [l.split(' ')[0] for l in r.stdout.splitlines()]
    else:
        raise SystemExit(f'Format necunoscut pentru {ym}: {ext}')
    xl = [os.path.basename(n) for n in names if n.lower().endswith(('.xlsx', '.xls'))]
    bad = [n for n in xl if not n.startswith(ym)]
    if not xl or bad:
        raise SystemExit(f'Arhiva pentru {ym} nu conține fișierele lunii (găsit: {xl[:5]})')


def qc(ym):
    """Vehicule NOI parsate vs. sumarul ACEA din aceeași arhivă."""
    d = pd.read_parquet(f'db/rec_{ym}.parquet')
    n = d[d.is_new]
    a = pd.read_csv('db/acea.csv', dtype={'ym': str}).set_index('ym').loc[ym]
    motor = n[n.segment.isin(['N1 (<=3.5t)', 'N2 (3.5-12t)', 'N3 Rigide (>12t)', 'N3 Autotractoare',
                              'Microbuze (M2)', 'Autobuze/autocare (M3)'])
              & ~n.source.isin(['Vehicule speciale'])]['count'].sum()
    checks = {'LCV+MCV+HCV+BUS': (int(motor), int(a[['LCV', 'MCV', 'HCV', 'BUS']].sum())),
              'SPEC': (int(n[n.source == 'Vehicule speciale']['count'].sum()), int(a['SPEC'])),
              'SEMI': (int(n[n.source == 'Semiremorci']['count'].sum()), int(a['SEMI'])),
              'REM': (int(n[n.source == 'Remorci']['count'].sum()), int(a['REM']))}
    bad = {k: v for k, v in checks.items() if abs(v[0] - v[1]) > max(2, 0.001 * v[1])}
    if bad:
        raise SystemExit(f'Control ACEA eșuat pentru {ym}: {bad}')
    small = {k: v for k, v in checks.items() if v[0] != v[1]}
    if small:
        log(f'{ym}: diferențe minore față de ACEA (tolerate): {small}')
    log(f'{ym}: control ACEA OK ({checks["LCV+MCV+HCV+BUS"][0]} vehicule comerciale noi)')


def gas(payload):
    if not (GAS_URL and GAS_TOKEN):
        return None
    payload['token'] = GAS_TOKEN
    r = requests.post(GAS_URL, data=json.dumps(payload), timeout=300, headers={'Content-Type': 'text/plain'})
    r.raise_for_status()
    res = r.json()
    if not res.get('ok'):
        raise SystemExit(f'Apps Script a refuzat {payload.get("action")}: {res}')
    return res


def send_file(folder, name, path, mime):
    with open(path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    gas(dict(action='saveFile', folder=folder, name=name, mime=mime, b64=b64))


def sheet_rows(ym):
    n = pd.read_parquet('db/all_new.parquet')
    n = n[n.ym == ym]
    n = n.assign(tip=n['kind'].map({0: 'Nou', 1: 'Uzat - prima inmatriculare in acelasi an'}))
    cols = ['segment', 'eu_cat', 'supra', 'tip', 'fin', 'brand_n', 'model_k', 'fuel_group', 'county']
    g = n.groupby(cols)['count'].sum().reset_index().sort_values('count', ascending=False)
    header = ['An', 'Luna', 'Segment', 'Categorie', 'Suprastructura', 'Tip inmatriculare', 'Finantare', 'Marca',
              'Model', 'Combustibil', 'Judet', 'Inmatriculari']
    rows = [[int(ym[:4]), int(ym[4:])] + [str(v) for v in r[:-1]] + [int(r[-1])] for r in g.itertuples(index=False)]
    return header, rows


def main():
    items = dgpci_list()
    done = sorted(os.path.basename(p)[4:10] for p in glob.glob('db/rec_*.parquet'))
    new = sorted(ym for ym in items if ym >= '202301' and (ym not in done or ym == FORCE))
    log(f'DGPCI: {len(items)} luni listate; ultima procesată {done[-1] if done else "-"}; noi: {new or "niciuna"}')
    os.makedirs('raw', exist_ok=True)
    for ym in new:
        it = items[ym]
        path = f'raw/DGPCI_{ym}.{it["ext"]}'
        r = requests.get(it['url'], timeout=600)
        r.raise_for_status()
        if len(r.content) != it['size']:
            raise SystemExit(f'{ym}: descărcare incompletă ({len(r.content)} din {it["size"]} bytes)')
        open(path, 'wb').write(r.content)
        extract(ym, path, it['ext'])
        subprocess.run([sys.executable, 'parse.py', ym], check=True)
        state['pub'][ym] = it['pub'] or datetime.date.today().isoformat()
        log(f'{ym}: descărcat și procesat ({it["size"]} bytes)')
    if new:
        subprocess.run([sys.executable, 'acea.py'], check=True)
        for ym in new:
            qc(ym)
    if new or BACKFILL or not os.path.exists('db/all_new.parquet'):
        subprocess.run([sys.executable, 'build_data.py'], check=True)
    if new:
        os.replace('out/dgpci.json', '../data/dgpci.json')
        sw = open('../service-worker.js').read()
        v = int(re.search(r'foton-agenti-v(\d+)', sw).group(1))
        open('../service-worker.js', 'w').write(sw.replace(f'foton-agenti-v{v}', f'foton-agenti-v{v + 1}'))
        log(f'Aplicație actualizată: date până la {max(new)}, cache v{v + 1}')
    # Drive / Sheets
    to_send = sorted(p[4:10] for p in map(os.path.basename, glob.glob('db/rec_*.parquet'))) if BACKFILL else new
    if to_send and GAS_URL and GAS_TOKEN:
        for ym in to_send:
            arch = glob.glob(f'raw/DGPCI_{ym}.*')
            if not arch and ym in items:
                it = items[ym]
                arch = [f'raw/DGPCI_{ym}.{it["ext"]}']
                open(arch[0], 'wb').write(requests.get(it['url'], timeout=600).content)
            if arch:
                send_file('arhive_DGPCI', os.path.basename(arch[0]), arch[0], 'application/octet-stream')
            header, rows = sheet_rows(ym)
            gas(dict(action='sheetMonth', ym=ym, header=header, rows=rows))
            if ym not in state['drive_sent']:
                state['drive_sent'].append(ym)
            log(f'{ym}: trimis în Drive (arhivă) și Sheets ({len(rows)} rânduri)')
        subprocess.run([sys.executable, 'build_xlsx.py'], check=True)
        send_file('root', 'DGPCI_DATABASE.xlsx', 'out/DGPCI_DATABASE.xlsx',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        gas(dict(action='log', text=' | '.join(summary)))
        log('Excel complet actualizat în Drive')
    elif to_send:
        log('ATENȚIE: GAS_URL/GAS_TOKEN nu sunt setate; nimic nu a fost trimis în Drive/Sheets')
    state['last_run'] = datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    json.dump(state, open('state.json', 'w'), indent=1)
    with open(os.environ.get('GITHUB_STEP_SUMMARY', '/dev/null'), 'a') as f:
        f.write('\n'.join('- ' + s for s in summary) + '\n')


if __name__ == '__main__':
    main()
