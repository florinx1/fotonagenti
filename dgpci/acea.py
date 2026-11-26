import pandas as pd, glob, os, warnings; warnings.filterwarnings('ignore')
MAP={'Vehicule de pasageri':'M1','LCV':'LCV','MCV':'MCV','HCV':'HCV','Autobuze':'BUS','destinatie speciala':'SPEC','Semiremorci':'SEMI','Remorci':'REM','Motociclete':'MOTO'}
rows=[]
for p in sorted(glob.glob('raw/2*/**/2*_Acea.xlsx', recursive=True)):
    ym=os.path.basename(p)[:6]; d=pd.read_excel(p,header=None)
    for _,r in d.iterrows():
        n=str(r[1])
        for k,v in MAP.items():
            if n.startswith(k) or (k in n and v in('SPEC','BUS')):
                rows.append((ym,v,pd.to_numeric(r[2],errors='coerce'))); break
a=pd.DataFrame(rows,columns=['ym','cat','n']).drop_duplicates(['ym','cat']).pivot(index='ym',columns='cat',values='n')
if os.path.exists('db/acea.csv'):
    old=pd.read_csv('db/acea.csv',dtype={'ym':str}).set_index('ym')
    a=pd.concat([old[~old.index.isin(a.index)],a]).sort_index()
a.to_csv('db/acea.csv'); print(a.tail(3))
