# 0001 – Modellen for blokkeditoren

- **Status:** Forslag, venter på Tors beslutning (porten P1)
- **Dato:** 2026-10-25
- **Milepæl:** M0.6, prototype av editoren
- **Kode:** `packages/blocks` (format, `block.json`, validering, blokktre, historikk), `apps/admin/app/components/editor` og
  `pages/editor-prototype` (editoren), `apps/admin/app/components/blocks` (visning), `apps/api/src/*/editor-prototype.ts`
  (prototype-endepunktene)

## Spørsmålet

PLAN («Slik er editoren bygget») beskriver en modell der innholdet er et blokktre i en egen Vue-modell, der hver tekstblokk har
sin egen TipTap-instans for formatering inne i teksten, der strukturen (kolonner, grupper, omslag) eies av blokktreet og ikke av
ProseMirror, og der angre og gjenta virker på tvers av blokker. Prototypen skal svare på om modellen holder før fase 1 estimeres.

## Svaret, kort

Modellen holder. Med én historikk i blokktreet og TipTap uten egen historikk virker angre og gjenta på tvers av skriving,
formatering, innsetting, flytting og sletting. Det gjelder også inn i og ut av kolonner, og ytelsen med 200 tekstblokker er god.
Det som krever mest arbeid i fase 1, er ikke modellen. Det er det som ligger *mellom* blokkene: markering over flere blokker,
kopier og lim inn av flere avsnitt, og fokus når en blokk bytter forelder. **Anbefaling: fortsett med modellen, med fire
justeringer** (se «Anbefaling»).

## Hva prototypen er

- **Format** (`packages/blocks`): hver blokk lagres som `{ id, type, version, attrs, children }`. Hver blokktype har sin egen
  `block.json` (`core/paragraph`, `core/image`, `core/columns`, `core/column`). Ren TypeScript uten Vue, TipTap eller Node-API,
  så api, worker og nettleser bruker samme kode.
- **Rik tekst er data, ikke HTML.** Et avsnitts `content` er innholdet i et ProseMirror-avsnitt slik TipTap skriver det, men bare
  tekst med merkene `bold`, `italic`, `code` og `link` (bare `href`, og bare `http:`, `https:`, `mailto:`, `/…` og `#…`), og
  `hardBreak`. Zod-skjemaet er tillatt-listen. Visningen bygger elementer av dataene, så ingenting går gjennom `v-html`.
- **Validering** mot `block.json` skjer i editoren før lagring og på serveren før `content.blocks` skrives. Begge bruker samme
  funksjon (`validateDocument`), og alle feil samles med sti, så editoren kan vise hver av dem.
- **Blokktreet** er uforanderlige verdier. Hver operasjon (`insertBlock`, `removeBlock`, `moveBlock`, `splitParagraph`,
  `mergeWithPrevious`, `updateAttrs`) lager nye objekter langs stien til blokken som endres og deler resten. Uendrede blokker
  beholder identiteten, og det er det som gjør både historikken og Vue billige.
- **Én historikk** (`createHistory`): hvert steg lagrer hele dokumentet slik det var. Det koster bare stien som ble endret.
  Skriving i samme blokk slås sammen så lenge pausene er under 1 s og gruppen er under 5 s gammel. Formatering, innsetting,
  flytting og sletting er alltid egne steg. Hvert steg husker markøren før og etter, så angre setter markøren tilbake i riktig
  blokk og på riktig plass.
- **TipTap** (3.32.0, `@tiptap/vue-3`): én instans per avsnitt, med bare dokument, avsnitt, tekst, linjeskift, fet, kursiv, kode
  og lenke, uten `UndoRedo` og uten `injectCSS`. TipTap sender hver endring til modellen som et tekststeg eller et formatsteg
  (en transaksjon med bare `AddMarkStep`/`RemoveMarkStep`). Innhold som kommer fra modellen (angre, gjenta, deling) settes inn
  med `setContent(…, { emitUpdate: false })`, så det ikke kommer tilbake som et nytt steg.
- **Editoren** i `/admin/editor-prototype` har `/`-meny og «+» mellom blokker, verktøylinje per blokk (flytt opp og ned, sett inn
  etter, slett, formatering, lenke, antall kolonner) og tastatur for alt. Enter deler avsnittet, Backspace først i et avsnitt
  slår det sammen med avsnittet før eller sletter det hvis det er tomt, Alt+Shift+Pil flytter blokken, Alt+Shift+Z sletter den,
  og Ctrl+Z og Ctrl+Shift+Z angrer og gjentar. Utkastet lagres på det innloggede kontoens eget innlegg via
  `/api/v1/prototype/editor/*` (`edit_posts`, opplasting `upload_files`).
- **Visning** i `/admin/editor-prototype/preview`: serveren lager HTML av den lagrede JSON-en med Vue-komponenter, uten editoren
  og uten skript.

Valg av TipTap-versjon: 3.32.0 var `latest` på npm 2026-10-25 (publisert 2026-10-13, sjekket mot registeret og kildekoden av
`researcher`). `@tiptap/vue-3` er den offisielle Vue 3-integrasjonen. Den lager editoren i `onMounted`, så den kjører aldri på
serveren og trenger ingen `<ClientOnly>`. Den låser `@tiptap/core` og `@tiptap/pm` til nøyaktig samme versjon, så alle
TipTap-pakkene står med samme faste versjon i katalogen. Under CSP-en er det to ting å passe på: `injectCSS: false` (den
innsatte `<style>` har ingen nonce), og ProseMirror setter stiler bare gjennom CSSOM, som `style-src-attr` ikke stopper.

## Erfaringer

### Angre og gjenta på tvers av TipTap-instanser

Det virket fra første forsøk, og det er det viktigste funnet. Grunnen er at TipTap aldri eier noe: den speiler blokkens innhold og
melder fra om endringer. Tre detaljer måtte være riktige:

1. **Ekko.** Når modellen får ny tekst fra TipTap, endres blokken, og avsnittet ser et «nytt» innhold. Avsnittet husker derfor
   det siste innholdet det selv sendte (samme objekt, sammenlignet med `===`) og setter bare inn innhold som kom utenfra.
2. **Markøren før en endring.** TipTap sender `transaction` før `update`, og `selectionUpdate` kommer imellom. Markøren *før*
   endringen må derfor tas fra forrige transaksjon, ellers lagrer historikken feil sted å gå tilbake til.
3. **Nettleserens egen angre.** Ctrl+Z fanges på redigeringsflaten i capture-fasen, før TipTap og tekstfeltene ser tastene.
   `beforeinput` med `historyUndo` og `historyRedo` (fra menyer og bevegelser) sendes også til modellen. Ellers angrer et
   bildetekstfelt sin egen tekst, og dokumentet kommer ut av takt.

Enhetstestene kjører ekte TipTap-formatering, med samme utvidelser og skjema og ProseMirrors kommandoer, inn i modellen. De
angrer og gjentar skriving, fet, kursiv, lenke og en flytting i én historikk (`apps/admin/test/rich-text-editor.test.ts`).
Playwright-flyten gjør det samme i nettleseren med tre angre og to gjenta.

Gruppering av skriving etter tid (pause over 1 s, høyst 5 s per steg) føles naturlig. Gutenberg og Google Docs grupperer også
etter ord. Det kan legges til uten å endre modellen.

### Fokus og markør ved flytting

Det var dette som tok mest tid, og ingenting av det skyldes modellen:

- **En blokk som bytter liste, monteres på nytt.** Vue gjenbruker en komponent bare innenfor samme `v-for`. Når et avsnitt
  flyttes fra toppnivå inn i en kolonne, lages en ny TipTap-instans, og markøren må settes tilbake etterpå. Det løses med et
  register der hver blokk melder inn en `focus(offset)`, og modellen gir markøren til blokken etter neste tegning. Det virker,
  men ProseMirror-tilstand som ikke ligger i dokumentet (lagrede merker, markeringsretning) går tapt ved slike flyttinger.
- **Menyer gir fokus tilbake.** Reka UI-menyen gir fokus til «+»-knappen når den lukkes, og den nye blokken mistet da markøren.
  Når en blokk er valgt, stopper `onCloseAutoFocus` tilbakeføringen.
- **ProseMirror leser markeringen asynkront** fra `selectionchange`. Et menneske merker ikke det, men Playwright trykker raskere
  enn det, så testen venter én frame før Ctrl+B.
- **Flytting inn og ut av kolonner** følger lesestedet: ned fra blokken over kolonnene går inn øverst i første kolonne, ned fra
  bunnen av en kolonne går til toppen av neste, og ned fra siste kolonne går ut under kolonneblokken. Det er tydelig med
  tastaturet, men det trenger brukertesting. Gutenberg flytter bare innenfor samme forelder.

### Kolonner

At strukturen ligger i blokktreet, gjorde kolonner enkle. En kolonneblokk er bare en liste av lister. `parent`, `allowedBlocks`
og `childCount` i `block.json` avgjør hva som kan stå hvor, og den samme regelen brukes av innsetteren, flyttingen og
valideringen. Ingenting av dette måtte uttrykkes i et ProseMirror-skjema. `childCount` (2–4 kolonner) er toascribes tillegg,
fordi WordPress ikke har noe felt for det.

### Ytelse med 200 blokker

Målt med `apps/admin/e2e/editor-performance.spec.ts`: 200 tekstblokker (180 avsnitt og 10 kolonneblokker med to avsnitt hver,
230 blokker i alt), hvert avsnitt med fet tekst og en lenke. Testen bruker headless Chromium i den lokale stacken på en AMD
Ryzen 9 9950X3D, og «Klar» er tiden til alle 200 TipTap-instansene er montert. Tastetrykk er målt med Event Timing API (fra
tast til neste maling), og API-et rapporterer bare hendelser over 16 ms.

| Måling | Uten struping | CPU strupet ×4 |
| --- | --- | --- |
| Siden klar med 200 TipTap | 0,71–0,78 s | 2,6 s |
| DOMContentLoaded | 0,29–0,34 s | 0,52 s |
| Skriving, 42 tegn: p95 / maks | 24 / 24 ms | 24 / 56 ms |
| Flytting (Alt+Shift+Pil), 5 steg: p95 / maks | 32 / 32 ms | 96 / 96 ms |
| Angre, 6 steg: p95 / maks | 24–40 / 40 ms | 80 / 80 ms |
| JS-heap etter testen | 84–89 MB | 87 MB |

Skriving holder seg under én frame, fordi bare én blokk endres og resten beholder identiteten. Flytting og angre tegner hele
listen på nytt. Med svak CPU er det godt under 100 ms, men det vokser lineært. Monteringen av 200 TipTap-instanser er det
største enkeltbeløpet ved oppstart. Med 1 000 blokker eller mer bør TipTap monteres først når blokken får fokus, og blokken vises
som statisk visning før det.

### Ytelse i M1.3: 200 blokker av blandet type

Målt 2026-10-27 med samme test (`apps/admin/e2e/editor-performance.spec.ts`), nå med 200 blokker av blandet type: 13 runder med
avsnitt, overskrift, liste med to punkter, sitat med avsnitt, tabell, kode, skillelinje og to kolonner med et avsnitt hver, og 5
avsnitt til slutt. Hvert avsnitt har fet tekst og en lenke. Editoren er nå den i M1.3: TipTap lages først når en tekst får fokus
(justering 1), og hver blokk tegnes én gang i en dokk som flyttes inn i treet (justering 2). «Klar» er tiden til alle 200 blokkene
er tegnet; ingen TipTap-instans er laget da. Samme maskin og oppsett som i M0.6, to kjøringer uten struping.

| Måling | Uten struping | CPU strupet ×4 |
| --- | --- | --- |
| Siden klar med 200 blokker | 0,48–0,51 s | 1,76 s |
| TipTap-instanser ved lasting | 0 | 0 |
| DOMContentLoaded | 0,15 s | 0,39 s |
| Skriving, 42 tegn: p95 / maks | 32 / 32–40 ms | 40 / 56 ms |
| Flytting (Alt+Shift+Pil), 5 steg: p95 / maks | 16–24 / 16–24 ms | 64 / 64 ms |
| Angre, 6 steg: p95 / maks | 24–32 / 24–32 ms | 80 / 80 ms |
| JS-heap etter testen | 81–132 MB | 136 MB |

Sammenlignet med M0.6 er oppstarten raskere (0,48–0,51 s mot 0,71–0,78 s, og 1,76 s mot 2,6 s med struping), selv om dokumentet
nå har tabeller, lister og sitater. Det er fordi ingen TipTap lages før en tekst får fokus. Skriving ligger litt over én frame
(p95 32 ms mot 24 ms). Grunnen er at hver endring nå også går gjennom dokken og sidepanelet, som følger valgt blokk. Flytting
er raskere enn før, fordi blokkene beholder komponenten sin og bare dokken flyttes. Heapen varierer mellom kjøringene (81–132 MB)
og følger hvor mange tekster som har fått fokus. Ingen måling er i nærheten av grensen på 100 ms, heller ikke med svak CPU.

## Hva var vanskelig

1. Fokus og markør når blokker bytter forelder, og samspillet med menyer (se over).
2. CSP. TipTaps innsatte `<style>` måtte slås av og CSS-en flyttes til admin-stilarket. Bilder fra andre verter krevde
   `img-src https:`, som nå er en regel per rute for de to prototype-sidene. Typene til nuxt-security 2.6 kjenner ikke `security`
   i rutereglene til Nuxt 4.6, så linjen har en `@ts-expect-error` med begrunnelse. En e2e-test sjekker headeren.
3. ARIA for et contenteditable-felt med en blokkliste (`/`-menyen): `role="textbox"` med `aria-autocomplete`, `aria-controls`
   og `aria-activedescendant`, som må oppdateres uten en ProseMirror-transaksjon (`setOptions`).
4. Smalt skjermbilde. Verktøylinjen i navbaren presset bort tittelen på 375 px, og axe meldte for små trykkflater. Den ligger nå
   i innholdet.

## Hva jeg ville gjort annerledes

- **Én komponent per blokk som overlever flytting.** Tegn dokumentet som én flat, nøklet liste (med kolonner som visuell
  gruppering, eller en teleport per blokk), slik at TipTap-instansen ikke lages på nytt når blokken bytter forelder.
- **TipTap først ved fokus.** Vis blokken med den statiske visningen til den får fokus, og monter TipTap da. Det gir rask oppstart
  for lange dokumenter og mindre minne.
- **Markering og utklippstavle på trenivå fra start.** Markering av flere blokker (Shift+klikk, Shift+Pil forbi kanten),
  kopier og klipp ut av flere blokker, og innliming av flere avsnitt (som deles i blokker) hører hjemme i blokktreet og bør
  bygges i M1.3, ikke etterpå.
- **Gruppering etter ord** i tillegg til tid.

## Alternativer som ble vurdert

| Alternativ | Hvorfor ikke |
| --- | --- |
| **Ett stort ProseMirror-dokument** med noder for kolonner, bilder og grupper (slik TipTap-baserte blokkeditorer gjør) | Markering, kopier og lim inn og angre på tvers av blokker kommer gratis, men strukturen blir et ProseMirror-skjema. Hver `block.json` måtte oversettes til en nodespesifikasjon med `attrs`, temaer og utvidelser måtte skrive ProseMirror-noder, og validering, versjonering og `migrate.ts` måtte gå via ProseMirror-JSON. Verktøylinje og fokus per blokk og kolonner med 2–4 barn er tungvint å uttrykke der. Det bryter med PLAN-beslutningen om at strukturen eies av blokktreet. |
| **BlockNote** (ProseMirror-basert blokkeditor) | Bare React. Formatet er BlockNotes eget. |
| **Editor.js** | Eget JSON-format og en svak historikk på tvers av blokker. Nestede blokker (kolonner) er ikke en del av kjernen. |
| **Lexical** | Rammeverksnøytral kjerne og nestede editorer, men Vue-bindingene er ikke offisielle, og strukturen havner også her i editorens egen trestruktur. |
| **Gutenbergs egne pakker** | React, og GPL. Kjernen skal være MIT (PLAN, «Lisens»). |
| **Rik tekst som HTML-streng renset med en tillatt-liste** (PLAN, «Regler for blokker» 2) | Krever en HTML-renser på serveren (DOMPurify med jsdom, eller sanitize-html) og `v-html` i visningen. JSON-noder gjør skjemaet til tillatt-listen og gjør `v-html` unødvendig. WXR-importen (fase 2) må uansett gjøre HTML om til blokker, og kan gjøre den om til noder med TipTaps egen parser på serveren. |
| **Ajv eller Zods `fromJSONSchema`** for `block.json` | Ajv kompilerer med `new Function`, som admin-CSP-en forbyr (`'unsafe-eval'`). `fromJSONSchema` i Zod 4.6 er merket «semi-experimental». En egen validator for et lite delsett (`string`, `number`/`integer`, `boolean`, `rich-text`, `enum`, grenser, `format: url`) avviser alle andre nøkkelord, så en `block.json` aldri kan be om en sjekk som ikke blir gjort. |

## Anbefaling

**Fortsett med modellen**, med disse justeringene i M1.3:

1. Rik tekst lagres som JSON-noder (som i prototypen), ikke som HTML. *(Krever Tors beslutning, se under.)*
2. TipTap monteres først ved fokus, og blokken vises statisk til da.
3. En komponent per blokk som overlever bytte av forelder, eller en tilsvarende måte å flytte TipTap-tilstanden på.
4. Markering av flere blokker, kopier og lim inn og innliming fra Word og Google Docs bygges i blokktreet i M1.3, med egne tester.

## Estimat for fase 1

Dagene er arbeidsdager for dette teamet: lead, reviewer og researcher med Tor som eier, review og merge. Grunnlaget er
tempoet i fase 0. M0.1–M0.6 tok sju kalenderdager (2026-10-20 til 2026-10-25) med én til to reviewrunder per milepæl. Fase 1 har
mer skjerm per milepæl, og mer som Tor må se på.

| Milepæl | Innhold | Dager | Usikkerhet |
| --- | --- | --- | --- |
| M1.1 | Innholds-API (innlegg og sider: status, papirkurv, forfattere, søkevektor) og listeskjermer som `edit.php` | 3–4 | Middels |
| M1.2 | Taksonomier, media (opplasting, sikker lagring og levering, bildestørrelser, mediebibliotek) | 4–6 | Middels–høy |
| M1.3 | Editor med grunnblokkene, sidepanel og planlagt publisering, datamigrering av `content.blocks` fra WordPress-formen, markering og lim inn | 8–12 | Høy |
| M1.4 | Tema-SDK, catch-all-rute, standardtema, arkiver og cache under renderingen | 5–7 | Høy |
| M1.5 | Menyer, globale sett, innstillingssidene, permalenker og omdirigeringer | 4–5 | Middels |
| M1.6 | RSS, sitemap, SEO og oEmbed | 2–3 | Lav |
| M1.7 | Nettstedshelse Info, sikkerhetskopi via CLI og oppdateringssiden | 3–4 | Middels |
| M1.8 | Egen blogg i drift i 14 dager | 1–2 dagers arbeid + 14 dagers drift | Middels |
| **Sum** | | **30–43 arbeidsdager + 14 dagers drift** | |

**De største risikoene**

1. **M1.3 er størst og mest usikker.** Grunnblokkene er mange (liste, sitat, kode, tabell, galleri, omslag med flere), og
   flere av dem (liste og tabell) har struktur *inne i* teksten som ikke passer i ett avsnitts TipTap. Liste og tabell bør
   prototypes tidlig i M1.3.
2. **Markering og utklippstavle over flere blokker.** Det er det modellen ikke gir gratis, og det brukerne merker først.
3. **Cache og nonce i M1.4** (AGENTS.md, «Public site: CSP and caching»): cachen må ligge under renderingen, og det er nytt for
   prosjektet.
4. **Bildebehandling i M1.2** krever en ny avhengighet med native kode (for eksempel sharp/libvips) i api-imaget. Det gir
   Trivy-funn og flere plattformer å bygge for.
5. **M1.8 trenger innhold.** WXR-importen kommer i fase 2, så innholdet til Tors blogg må legges inn for hånd, eller deler av
   importen må flyttes fram.

## Avvik fra PLAN og toa-rules i prototypen

- **Rik tekst som JSON-noder i stedet for renset HTML** (PLAN, «Regler for blokker» 2). Strengere, men et formatvalg Tor
  må godta.
- **`Edit.vue` og `View.vue` ligger i admin**, ikke i blokkmappen i `packages/blocks` som PLAN viser. `packages/blocks` er et
  rent TypeScript-bibliotek som api-et laster i Node, og Vue-filer der krever egen bygging, lint og typesjekk. I fase 1 bør
  visningene ligge der nettstedet og temaene også kan bruke dem.
- **`block.json`** har et eget felt (`childCount`) og attributtypen `rich-text` (som WordPress 6.5). Valideringen er et delsett
  av JSON Schema, ikke hele.
- **Admin-CSP:** de to prototype-sidene tillater `img-src https:` (regel per rute). Alle andre admin-sider har fortsatt
  `'self' data:`.
- **`content.search`** skrives ikke for prototype-utkastet. Innholdstjenesten i M1.1 gjør det.
- **Opplastinger** ligger i api-ets midlertidige mappe (tmpfs, høyst 50 filer, borte etter omstart). Mediebiblioteket i M1.2
  erstatter det. Grensen er felles for hele nettstedet, ikke per konto, så én konto kan skyve ut andres prototype-bilder.
- **Prototype-dataene blir liggende.** Hver konto som lagrer, får et ekte utkast i `content` (`type = 'post'`, slug
  `editor-prototype-<konto-id>`) med en rad i `content_author`. Når prototypen fjernes (M1.1–M1.3), må fjerningen ha en migrering
  som sletter disse radene. Ellers dukker de opp som utkast i innleggslisten og i datamigreringen av `content.blocks`.
- **Lenkene inn og ut av prototypen er hele sidelastinger**, fordi CSP-headeren følger dokumentet som lastes, ikke ruten Vue
  navigerer til.

## Hva fase 1 trenger avklart før start

1. **Formatet for rik tekst:** JSON-noder (anbefalt) eller HTML-strenger med renser? Valget påvirker WXR-importen,
   utvidelsenes blokker og søket.
2. **Hvor `Edit.vue` og `View.vue` ligger**, og hvordan et tema overstyrer visningen av en kjerneblokk.
3. **Bilder fra andre verter i admin:** skal admin-CSP-en tillate `https:` for bilder i editoren (M1.3), eller skal bilder fra
   en adresse alltid hentes inn i mediebiblioteket først?
4. **Hvilke grunnblokker M1.3 skal ha.** Funksjonsregisteret har mange. Liste, overskrift, sitat, kode, bilde, kolonner og gruppe
   er nok for en blogg. Galleri, omslag, tabell og media og tekst kan vente til M1.3b eller fase 2.
5. **Innhold til M1.8:** for hånd, eller WXR-import (helt eller delvis) flyttet fram fra fase 2.
6. **Flytting inn og ut av kolonner med tastaturet:** godkjenne oppførselen i prototypen, eller gjøre som Gutenberg (bare innenfor
   samme forelder, og et eget «flytt til»-valg).
