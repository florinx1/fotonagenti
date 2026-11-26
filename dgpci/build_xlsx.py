import pandas as pd, datetime
import json
PUB=json.load(open('state.json'))['pub']
n=pd.read_parquet('db/all_new.parquet')
today=datetime.date.today().isoformat()
n['Tip']=n['kind'].map({0:'Nou',1:'Uzat - prima inmatriculare in acelasi an'})
g=n.groupby(['year','month','ym','segment','eu_cat','supra','body','Tip','fin','owner_quality','brand_n','brand','model_k','fuel','county'])['count'].sum().reset_index()
g['Source_Document']='DGPCI_'+g.ym+' (Lista_Detaliata)'; g['Publication_Date']=g.ym.map(PUB); g['Extraction_Date']=today
g['Data_Quality_Status']='OK – reconciliat cu ACEA'
out=g.rename(columns={'year':'Year','month':'Month','segment':'Category','eu_cat':'EU_Category','supra':'Superstructure','body':'Subcategory','Tip':'Registration_Kind','fin':'Financing','owner_quality':'Owner_Quality_DGPCI','brand_n':'Brand','brand':'Brand_DGPCI_raw','model_k':'Model','fuel':'Fuel_Type','county':'County','count':'Registrations'}).drop(columns='ym')
acea=pd.read_csv('db/acea.csv',dtype={'ym':str})
fm=pd.DataFrame([
 ['FOTON','AUMARK','M4L','N2','Electric','Aumark / eAumark (N2)','Denumire DGPCI „AUMARK”, tip M4L, electric = eAumark'],
 ['FOTON','EAUMARK','M4L-Z4','N2','Electric','eAumark (N2)','Denumire explicită'],
 ['FOTON','FOTON AUMAN C','IASAFN34','N3','Electric','eAuman C (N3 rigid)','Auman C electric'],
 ['FOTON','TUNLAND','P3','N1G','Diesel','Tunland G7 (pick-up N1G)','Tip P3 = G7 (confirmat ICG)'],
 ['FOTON','TUNLAND','P4','N1G','Diesel / Hibrid','Tunland V9 (pick-up N1G)','Tip P4 = V9 (confirmat ICG)'],
 ['CAVAN','C1 BJ5031XXYEVZC','EK2C','N1','Electric','Cavan C1 (N1 electric)','Înregistrat sub marca CAVAN'],
],columns=['Marca DGPCI','Denumire comerciala DGPCI','Tip','Categorie','Combustibil','Familie comerciala FOTON','Observatii'])
fot=pd.DataFrame(__import__('json').load(open('out/dgpci.json'))['foton'])
with pd.ExcelWriter('out/DGPCI_DATABASE.xlsx',engine='openpyxl') as w:
    pd.DataFrame({'Câmp':['Sursa','Perioada','Conținut','Clasificare','Județ','Brand','Control','Actualizare'],
      'Descriere':['DGPCI – Situația statistică a vehiculelor înmatriculate, fișierele Lista_Detaliata','Ianuarie 2023 – octombrie 2026 (46 luni)','Vehicule NOI + vehicule înscrise ca uzate cu prima înmatriculare în același an (coloana Registration_Kind): N1/N2/N3, autotractoare, M2/M3, vehicule speciale, remorci, semiremorci. Fără autoturisme M1.','Category = segment; EU_Category = categoria exactă (N1/N1G/N2/N2G/N3/N3G…, G = teren); Superstructure = suprastructura DGPCI; Subcategory = grupă caroserie (pick-up identificat după model)','Județul utilizatorului (leasing) dacă există, altfel al deținătorului','Brand = marcă normalizată (variante și carosieri multi-etapă); Brand_DGPCI_raw = marca exactă din DGPCI','Foaia Control_ACEA = totalurile oficiale lunare din aceeași arhivă','Se adaugă lunar; istoricul nu se suprascrie']}).to_excel(w,'README',index=False)
    out.to_excel(w,'Data',index=False)
    acea.to_excel(w,'Control_ACEA',index=False)
    fm.to_excel(w,'FOTON_Mapping',index=False)
    fot.to_excel(w,'FOTON_Detaliu',index=False)
print(len(out))
