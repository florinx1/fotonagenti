"""Parse DGPCI monthly archives (Lista_Detaliata sheets) into one record-level table.
Usage: python3 parse.py [YYYYMM ...]   (default: all folders under raw/)
"""
import pandas as pd, glob, os, sys, re, warnings
warnings.filterwarnings('ignore')

FILES = {
    'Autovehicule_Marfuri': 'Autovehicule marfuri (N)',
    'Autotractoare': 'Autotractoare',
    'Autobuze_Microbuze': 'Autobuze/microbuze (M2,M3)',
    'Vehicule_Speciale': 'Vehicule speciale',
    'Semiremorci': 'Semiremorci',
    'Remorci': 'Remorci',
}
COLS = {'Judet':'county','Marca':'brand','Tip':'type','Extensie':'ext','Versiune':'version',
        'Denumire comerciala':'model','Subcategorie':'subcat','Tip caroserie':'body',
        'Putere(kw)':'kw','Combustibil':'fuel','Tip tractiune':'traction','Masa maxima autorizata':'mma',
        'Sarcina utila':'payload','Numar axe':'axles','An fabricatie':'year_built','Detinator':'owner_type','Calitate detinator':'owner_quality',
        'Judet_utilizator':'user_county','Motiv de inmatriculare':'reg_type','Data primei inmatriculari(LLAAAA)':'first_reg','Categorie comunitara':'eu_cat','Total':'count'}

def fuel_group(f):
    f = str(f).upper()
    if f.startswith('ELECTRIC'): return 'Electric'
    if f.startswith('HIBRID'): return 'Hibrid'
    if 'MOTORINA' in f: return 'Diesel'
    if 'GPL' in f or 'GNC' in f or 'GNL' in f or 'GAZ' in f: return 'Gaz (GPL/GNC/GNL)'
    if 'BENZINA' in f: return 'Benzina'
    if 'HIDROGEN' in f: return 'Hidrogen'
    if f in ('NAN', '', 'FARA', 'NONE'): return 'Fara motor/N.A.'
    return 'Altul'

def segment(row):
    src, cat, mma = row['source'], str(row['eu_cat']).upper(), row['mma']
    if src == 'Semiremorci': return 'Semiremorci (O)'
    if src == 'Remorci':
        return 'Remorci grele (O3/O4)' if cat.startswith(('O3', 'O4')) else 'Remorci usoare (O1/O2)'
    if src == 'Autobuze/microbuze (M2,M3)':
        return 'Microbuze (M2)' if cat.startswith('M2') else 'Autobuze/autocare (M3)'
    if src == 'Autotractoare': return 'N3 Autotractoare'
    if cat.startswith('N1'): return 'N1 (<=3.5t)'
    if cat.startswith('N2'): return 'N2 (3.5-12t)'
    if cat.startswith('N3'): return 'N3 Rigide (>12t)'
    if src == 'Vehicule speciale':
        return 'Speciale'
    if pd.notna(mma):
        return 'N1 (<=3.5t)' if mma <= 3500 else ('N2 (3.5-12t)' if mma <= 12000 else 'N3 Rigide (>12t)')
    return 'Necunoscut'

def parse_month(ym):
    frames = []
    for key, label in FILES.items():
        fs = glob.glob(f'raw/{ym}/**/{ym}_{key}.xlsx', recursive=True)
        if not fs: print('MISSING', ym, key); continue
        d = pd.read_excel(fs[0], sheet_name='Lista_Detaliata', header=5, dtype=str)
        d = d.iloc[1:]  # English header row
        d = d[[c for c in COLS if c in d.columns]].rename(columns=COLS)
        d = d[d['brand'].notna() & d['count'].notna()]
        d['count'] = pd.to_numeric(d['count'], errors='coerce').fillna(0).astype(int)
        for c in ('mma', 'kw', 'payload', 'axles'):
            d[c] = pd.to_numeric(d[c], errors='coerce')
        d['source'] = label
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df['ym'] = ym
    df['year'] = int(ym[:4]); df['month'] = int(ym[4:])
    for c in ('owner_quality', 'brand', 'model', 'county', 'user_county', 'fuel', 'eu_cat', 'reg_type', 'owner_type', 'subcat', 'type'):
        df[c] = df[c].fillna('').astype(str).str.strip().str.upper()
    df['brand'] = df['brand'].str.replace(r'\s+', ' ', regex=True)
    df['county_reg'] = df['county']
    df['county'] = df['user_county'].where(df['user_county'].ne('') & df['user_county'].ne('NAN'), df['county_reg'])
    fr = df['first_reg'].fillna('').astype(str).str.strip().str.replace(r'\.0$', '', regex=True).str.zfill(6)
    df['first_year'] = pd.to_numeric(fr.str[-4:], errors='coerce')
    df['is_new'] = df['reg_type'].str.contains('NOU')
    df['fuel_group'] = df['fuel'].map(fuel_group)
    q = df['owner_quality']
    df['fin'] = 'Altele'
    df.loc[q.str.contains('NETITULAR'), 'fin'] = 'Leasing'
    df.loc[q.str.contains('PROPRIETAR') & ~q.str.contains('NETITULAR'), 'fin'] = 'Achiziție directă'
    df['segment'] = df.apply(segment, axis=1)
    df['used_same_year'] = (~df['is_new']) & (df['first_year'] == df['year'])
    return df

if __name__ == '__main__':
    yms = sys.argv[1:] or sorted(os.path.basename(p) for p in glob.glob('raw/2*') if os.path.isdir(p))
    os.makedirs('db', exist_ok=True)
    for ym in yms:
        df = parse_month(ym)
        df.to_parquet(f'db/rec_{ym}.parquet', index=False)
        n = df[df.is_new]['count'].sum()
        print(ym, len(df), 'new:', n, 'used:', df[~df.is_new]['count'].sum())
