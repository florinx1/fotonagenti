# Foton by Inter Cargo – Ofertare vehicule

Aplicația PWA „Foton by Inter Cargo” (repo `florinx1/fotonagenti`) este folosită de agenții și vânzătorii FOTON/CAVAN ai Inter Cargo Grup (ICG). Fișierul acesta descrie modulul **Ofertare vehicule**. Restul aplicației (raportare discuții dealeri, Stoc DBK, fișe tehnice, catalog Tunland) trebuie să meargă în continuare după orice modificare.

## Cine o folosește
- Agenții și vânzătorii, aproape mereu de pe **telefon**. Nu sunt programatori și nu folosesc Claude.
- Administratori: Florin Loghin (Aftersales & Parts Manager) și Alex (conducerea ICG).
- Tot ce vede utilizatorul, adică interfața, e-mailurile și PDF-ul, este în **limba română**, cu diacritice.

## Structura repo-ului
- `index.html`, `app.js`, `styles.css`: aplicația principală (meniu, raportare discuții dealeri, Stoc DBK, hartă).
- `ofertare.html`: **modulul de ofertare vehicule**, tot într-un singur fișier. Are aprox. 2,6 MB pentru că pozele și siglele sunt incluse ca base64. **Nu citi fișierul întreg.** Caută cu `grep -n` și citește doar zonele de care ai nevoie.
- `catalog.html`: catalogul Tunland (aprox. 3,5 MB, tot cu imagini base64).
- `Code-oferte.gs`: backend-ul Apps Script al ofertelor (arhivă, numerotare, e-mailuri, aprobare preț). Repo-ul are doar o copie; codul activ e în proiectul Apps Script al lui Florin.
- `config.js`: URL-urile `/exec` ale Apps Script și setările.
- `service-worker.js`: cache-ul PWA. **Crește `CACHE_NAME` (ex. `foton-agenti-v41` → `v42`) la fiecare modificare publicată**, altfel telefoanele păstrează versiunea veche.
- `fise-tehnice/`: PDF-urile fișelor tehnice și `fise.json` (lista lor).
- `lib/leaflet`: biblioteca pentru hartă.
- Comutatorul Tekmodi este `const TEKMODI_ON=false;` în `ofertare.html`.

## Stack (nu se schimbă)
- Frontend: HTML/CSS/JS simplu, găzduit pe **GitHub Pages**. Nu se folosesc framework-uri și nu există build step pentru utilizator.
- Backend: **Google Apps Script** legat de Google Sheets. Ofertele au proiectul lor separat (`Code-oferte.gs`), legat de foaia „Oferte”.
- Fișele tehnice sunt găzduite chiar în aplicație, ca PDF-uri, ca să meargă și fără semnal.
- După fiecare publicare, utilizatorii trebuie să închidă complet aplicația și s-o redeschidă.

## Fluxul ofertei (5 pași)
1. Alegi modelul, apoi varianta, din butoane. Datele tehnice din ofertă se schimbă după variantă.
2. Alegi culoarea, opționalele (cu preț scris de mână) și poza de interior. În ofertă apare doar poza aleasă.
3. Completezi prețurile:
   - Rubrici: **preț de listă** (se completează singur), **preț cu discount** și **preț cu suport importator**.
   - Fiecare preț are un câmp fără TVA și unul cu TVA. Completezi unul și celălalt se calculează singur. **TVA este 21%.**
   - Bifa „În ofertă”: prețurile completate se bifează automat. Vânzătorul debifează treptele pe care nu vrea să le vadă clientul. **Prețul final apare mereu.**
   - **Prețul final** e ultimul preț completat: întâi cel cu suport importator, apoi cel cu discount, apoi cel de listă. Pe el se calculează totalul, TVA-ul și avansul.
4. Datele clientului și ale vânzătorului.
5. Oferta se salvează automat în arhivă, cu număr de ofertă, iar conducerea primește un e-mail cu PDF-ul.

## Factura proformă și etapele comenzii
- Flux: ofertată → **proformă emisă** (buton „Emite factură proformă”, din ofertă) → **avans încasat** → alocare serie (administrator) → încărcat → acte (factura finală) → PDI → livrată.
- Proforma: seria `ICG-PF`, numerotare continuă de la 000001, dată de Apps Script (`proforma_()` în `Code-oferte.gs`). Se salvează în fila **Proforme**; la reemitere cea veche rămâne „Înlocuită”.
- Tipuri: plată directă (avans % din ofertă), **leasing** (cumpărător = finanțatorul, clientul = utilizator; firmele în fila **Leasing**) și **rezervare** (sumă scrisă de vânzător, fără minim, doar în lei).
- Moneda: directă și leasing în **EUR** (vânzătorul bifează textul de plată: BNR + 0,5%, BNR + 1% sau curs BCR vânzare din data achitării facturii) sau în **lei** (curs BNR luat de Apps Script + adaos ales, ori curs scris de mână).
- Administratorii pot șterge o proformă (buton „Șterge” în cardul „Facturi proforme”); una cu avansul încasat nu se șterge.
- PDF-ul proformei: o pagină, `pfPdf()` în `ofertare.html` (html2canvas + jsPDF). FOTON: sigla FOTON stânga + Inter Cargo dreapta. CAVAN: doar CAVAN + Inter Cargo, fără FOTON. Datele ICG (sediu, conturi) sunt în `ICGF`.
- Avans neîncasat după 3 zile lucrătoare: e-mail la vânzător și apare în Raport → „Proforme neîncasate”. Vânzătorul alege: avans încasat, mai are nevoie de timp (alerta revine peste 3 zile), a renunțat, nu mai răspunde.

## Preț minim și aprobare
- Prețul de listă, discountul maxim și prețul minim pentru fiecare model se citesc din fila **Preturi** a Google Sheet-ului (coloanele `pretLista`, `discountMaximPct`, `pretMinim`). **Nu scrie prețuri în cod.**
- Dacă vânzătorul pune un preț sub minim, oferta primește starea „Așteaptă aprobare preț” și Florin și Alex primesc e-mail. Până la aprobare, vânzătorul nu poate descărca PDF-ul și nu poate printa.
- Administratorii pot da orice preț fără aprobare.
- Pentru „Preț respins” se cere un motiv. Vânzătorul modifică prețul din Arhivă și salvează din nou.

## PDF-ul ofertei
- Ofertele au **2 pagini**; eToano are 3, pentru că are în plus pagina cu spațiul de încărcare. Nu adăuga pagini noi fără acordul lui Florin.
- PDF-ul trimis pe e-mail și cel descărcat se fac cu **html2canvas + jsPDF** (`offerPdf()` în `ofertare.html`), nu cu printul din browser. html2canvas nu știe `object-fit`; de asta se ocupă `fitImgs()`, care redesenează pozele la mărimea căsuței. Testează mereu PDF-ul din `offerPdf()`, nu doar printul.
- Ofertele CAVAN au sigla și filigranul CAVAN. Celelalte au sigla FOTON și pe cea Inter Cargo.
- Se generează pe telefon, inclusiv pe iPhone. Ai grijă la dimensiunea imaginilor, pentru că pe iPhone generarea a mai picat din cauza lor.
- Antet ICG: INTER CARGO GRUP S.R.L., CIF RO18039372, Șos. de Centură nr. 5-7, Bragadiru, Ilfov.

## Funcții oprite temporar
- **Accesoriile Tekmodi** sunt oprite dintr-un singur comutator. Catalogul și regulile de montaj au rămas în cod. Nu le șterge și nu le porni fără confirmarea lui Florin.

## Cum lucrezi
- Fă modificări mici și țintite. Nu rescrie fișiere întregi fără motiv.
- Înainte de commit, testează în Chrome headless (Playwright), la dimensiune de telefon. Parcurge o ofertă completă pentru cel puțin un model FOTON și unul CAVAN, generează PDF-ul cu `offerPdf()` și verifică numărul de pagini și pozele.
- Nu pune în repo parole, chei sau date de clienți.
- Mesajele de commit se scriu în română, scurt.
- La final explică-i lui Florin, pe scurt și în română, ce s-a schimbat și ce trebuie să facă el: redeploy la Apps Script, coloane noi în Sheet sau altceva.
- Dacă o modificare cere schimbări în `Code-oferte.gs`, spune clar că Florin trebuie să facă o **nouă implementare** (Deploy → Manage deployments → versiune nouă) în Apps Script.
