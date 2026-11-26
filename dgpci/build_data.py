"""Build compact JSON for the app tab (piata.html) + Excel database, from db/rec_*.parquet."""
import pandas as pd, glob, json, re, datetime, os
from brands import norm_brand, CHINESE

d = pd.concat([pd.read_parquet(p) for p in sorted(glob.glob('db/rec_*.parquet'))], ignore_index=True)
d['brand_n'] = [norm_brand(b, m, c) for b, m, c in zip(d.brand, d.model, d.eu_cat)]
d['chinese'] = d.brand_n.isin(CHINESE)

def body_group(sc):
    s = str(sc)
    if 'PICK' in s: return 'Pick-up'
    if 'TEMPERATURA' in s or 'IZOTERM' in s: return 'Frigorific/izoterm'
    if 'FURGON' in s: return 'Furgon (van)'
    if 'BASCUL' in s: return 'Basculantă'
    if 'PRELATA' in s or 'OBLOANE' in s or 'DESCHISA' in s or 'PLATFORM' in s and 'LUCRU' not in s: return 'Platformă/prelată'
    if 'TRANSPORT VEHICULE' in s: return 'Transport auto'
    return 'Altele'
d['body'] = d.subcat.map(body_group)
PICKUP_RX = r'RANGER|HILUX|AMAROK|\bBTF\b|D-?MAX|MUSSO|\bT60\b|\bT90\b|TUNLAND|GLADIATOR|L200|TRITON|NAVARA|DUSTER PICK|\bRAM\b|T9EV|\bKP\d|\bPOER\b|CANNON|RIDDARA|SHARK'
_pk = (d.segment == 'N1 (<=3.5t)') & (d.model.str.contains(PICKUP_RX, regex=True) | d.type.str.contains(r'^PICK', regex=True))
d.loc[_pk, 'body'] = 'Pick-up'
FIX = {'AMOBIBILA': 'AMOVIBILA', 'LEMNE': 'LEMN'}
def supra(sc):
    t = str(sc).strip().upper()
    t = re.sub(r'^[A-Z]{1,2}\d{0,2}\s+', '', t) if re.match(r'^[A-Z]{1,2}\d{0,2}\s+\S', t) else ('' if re.match(r'^[A-Z]{1,2}\d{0,2}$', t) else t)
    for a, b in FIX.items(): t = t.replace(a, b)
    t = t.replace('(DOAR N3)', '').strip()
    if not t or t in ('NAN',): return 'Nespecificat'
    return t[:1] + t[1:].lower()
d['supra'] = d.subcat.map(supra)
d.loc[_pk, 'supra'] = 'Camionetă pick-up'
d['supra'] = d['supra'].replace({'Camioneta pick-up': 'Camionetă pick-up', 'Basculanta': 'Basculantă', 'Cu prelata': 'Cu prelată', 'Betoniera': 'Betonieră', 'Gunoiera': 'Gunoieră', 'Cisterna': 'Cisternă', 'Cisterna marfuri periculoase': 'Cisternă mărfuri periculoase', 'Cu temperatura controlata': 'Cu temperatură controlată', 'Izoterma': 'Izotermă', 'Obloane rabatabile': 'Obloane rabatabile', 'Cu carlig ridicator': 'Cu cârlig ridicător', 'Ambulanta': 'Ambulanță', 'Vidanja': 'Vidanjă', 'Pompa': 'Pompă', 'Pompiera': 'Pompieră', 'Platforma': 'Platformă', 'Platforma de lucru aeriana': 'Platformă de lucru aeriană', 'Suprastructura deschisa': 'Suprastructură deschisă', 'Caroserie amovibila': 'Caroserie amovibilă', 'Macara mobila': 'Macara mobilă', 'Vehicul curatare strazi/canalizari': 'Vehicul curățare străzi/canalizări', 'Alte activitati': 'Alte activități', 'Autorulota': 'Autorulotă', 'Autorulanta': 'Autorulantă', 'Autosasiu': 'Autoșasiu', 'Vehicul accesibil scaunelor rulante': 'Vehicul accesibil scaunelor rulante', 'Incarcaturi exceptionale': 'Încărcături excepționale', 'Transport butelii': 'Transport butelii', 'Stropitoare': 'Stropitoare', 'Funerar': 'Funerar', 'Blindat': 'Blindat'})

def model_key(r):
    m = r['model'].strip()
    if not m or m in ('NAN', '-'):
        m = r['type'].strip()
    m = re.sub(r'\s+', ' ', m)
    return m[:40]
d['model_k'] = d.apply(model_key, axis=1)

SEG_ORDER = ['N1 (<=3.5t)', 'N2 (3.5-12t)', 'N3 Rigide (>12t)', 'N3 Autotractoare', 'Microbuze (M2)',
             'Autobuze/autocare (M3)', 'Speciale', 'Semiremorci (O)', 'Remorci grele (O3/O4)', 'Remorci usoare (O1/O2)']
SEG_LABEL = {'N1 (<=3.5t)': 'N1 · LCV ≤3,5 t', 'N2 (3.5-12t)': 'N2 · camioane 3,5–12 t',
             'N3 Rigide (>12t)': 'N3 · camioane rigide >12 t', 'N3 Autotractoare': 'N3 · autotractoare',
             'Microbuze (M2)': 'M2 · microbuze', 'Autobuze/autocare (M3)': 'M3 · autobuze/autocare',
             'Speciale': 'Vehicule speciale', 'Semiremorci (O)': 'Semiremorci', 'Remorci grele (O3/O4)': 'Remorci grele O3/O4',
             'Remorci usoare (O1/O2)': 'Remorci ușoare O1/O2'}

d['used_same_year'] = d['used_same_year'].fillna(False)
n = d[d.is_new | d.used_same_year].copy()
n['kind'] = (~n.is_new).astype(int)  # 0 = nou, 1 = uzat cu prima înmatriculare în același an
months = sorted(d.ym.unique())
ix = lambda lst: {v: i for i, v in enumerate(lst)}

brands = sorted(n.brand_n.unique()); models = sorted(n.model_k.unique()); counties = sorted(n.county.unique())
fuels = ['Diesel', 'Electric', 'Hibrid', 'Benzina', 'Gaz (GPL/GNC/GNL)', 'Hidrogen', 'Altul', 'Fara motor/N.A.']

bodies = ['Furgon (van)', 'Pick-up', 'Platformă/prelată', 'Frigorific/izoterm', 'Basculantă', 'Transport auto', 'Altele']
fins = ['Achiziție directă', 'Leasing', 'Altele']
supras = sorted(d.supra.unique()); eucats = sorted(d.eu_cat.unique())
I = dict(fi=ix(fins), u=ix(supras), e=ix(eucats), ym=ix(months), s=ix(SEG_ORDER), b=ix(brands), m=ix(models), c=ix(counties), f=ix(fuels), o=ix(bodies))

g = n.groupby(['ym', 'segment', 'brand_n', 'model_k', 'fuel_group', 'body', 'kind', 'eu_cat', 'supra', 'fin'])['count'].sum().reset_index().rename(columns={'count':'cnt'})
cube = [[I['ym'][r.ym], I['s'][r.segment], I['b'][r.brand_n], I['m'][r.model_k], I['f'][r.fuel_group], I['o'][r.body], int(r.kind), I['e'][r.eu_cat], I['u'][r.supra], I['fi'][r.fin], int(r.cnt)]
        for r in g.itertuples()]
gc = n.groupby(['ym', 'segment', 'county', 'brand_n', 'kind'])['count'].sum().reset_index().rename(columns={'count':'cnt'})
cty = [[I['ym'][r.ym], I['s'][r.segment], I['c'][r.county], I['b'][r.brand_n], int(r.kind), int(r.cnt)] for r in gc.itertuples()]
go = n.assign(pj=n.owner_type.ne('PERSOANA FIZICA')).groupby(['ym', 'segment', 'pj'])['count'].sum().unstack(fill_value=0)
own = [[I['ym'][ym], I['s'][sg], int(row.get(True, 0)), int(row.get(False, 0))] for (ym, sg), row in go.iterrows()]  # [ym,seg,pj,pf]
gu = d[~d.is_new & ~d.used_same_year].groupby(['ym', 'segment'])['count'].sum().reset_index().rename(columns={'count':'cnt'})
used = [[I['ym'][r.ym], I['s'][r.segment], int(r.cnt)] for r in gu.itertuples()]

acea = pd.read_csv('db/acea.csv', dtype={'ym': str}).set_index('ym')
m1 = {ym: int(acea.loc[ym, 'M1']) for ym in months if ym in acea.index}

# FOTON detail (all records, incl. used) for transparency
fot = d[d.brand_n.isin(['FOTON', 'FOTON CAVAN']) & (d.is_new | d.used_same_year)]
foton_rows = fot.groupby(['ym', 'brand', 'type', 'model', 'eu_cat', 'fuel', 'county', 'is_new', 'owner_type', 'first_reg', 'supra', 'fin'])['count'].sum().reset_index().rename(columns={'count':'cnt'})
FAM = {'P3': 'Tunland G7', 'P4': 'Tunland V9', 'M4L': 'eAumark', 'M4L-Z4': 'eAumark', 'IASAFN34': 'eAuman C', 'EK2C': 'Cavan C1'}
def fam(r):
    if r.type in FAM: return FAM[r.type]
    m = (r.model or '').upper()
    for k, v in (('TUNLAND', 'Tunland'), ('AUMARK', 'Aumark'), ('AUMAN', 'Auman'), ('TOANO', 'eToano'), ('MILER', 'eMiler'), ('GALAXUS', 'Galaxus'), ('C1', 'Cavan C1')):
        if k in m: return v
    return r.model or r.type
foton = [dict(fam=fam(r), ym=r.ym, marca=r.brand, tip=r.type, model=r.model, cat=r.eu_cat, comb=r.fuel, judet=r.county,
              nou=bool(r.is_new), prima=r.first_reg, supra=r.supra, fin=r.fin, detinator=r.owner_type, n=int(r.cnt)) for r in foton_rows.itertuples()]

out = dict(
    meta=dict(last=months[-1], generated=datetime.date.today().isoformat(), source='DGPCI – Situația statistică a vehiculelor înmatriculate (Lista detaliată)',
              note='Vehicule noi (ÎNSCRIERE VEHICUL NOU) plus vehicule înscrise ca uzate, dar cu prima înmatriculare (în străinătate) în același an cu înmatricularea în România (practic noi, de ex. aduse prin alt importator UE); filtrabile separat. Segmentare după categoria comunitară (N1/N2/N3, M2/M3, O). Autoturismele M1 nu sunt incluse în piața vehiculelor comerciale.'),
    months=months, seg=SEG_ORDER, segLabel=SEG_LABEL, brands=brands, models=models, counties=counties, fuels=fuels, bodies=bodies,
    chinese=sorted(CHINESE), eucats=eucats, supras=supras, fins=fins, cube=cube, cty=cty, own=own, used=used, m1=m1, foton=foton)
os.makedirs('out', exist_ok=True)
s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
open('out/dgpci.json', 'w').write(s)
print('json KB', len(s) // 1024, 'cube', len(cube), 'cty', len(cty))
n.to_parquet('db/all_new.parquet'); d.to_parquet('db/all.parquet')
