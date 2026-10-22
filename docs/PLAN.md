# toascribe: WordPress i TypeScript

Oct 20, 2026 · @Tor

## Mål og prinsipper

Målet er et selvhostet publiseringssystem som gjør det samme som WordPress gjør i dag: innlegg, sider, media, brukere, temaer og utvidelser, bygget i TypeScript hele veien: Nuxt 4, et API i Hono på Node og PostgreSQL. Koden følger toa-rules TYPESCRIPT\_STANDARD\_2026. Det leveres som et åpent repo og startes med Docker: for drift lastes compose.yaml og .env.example ned, og resten fullføres i en setup-wizard. Prosjektet heter toascribe og får hjem på toascribe.dev.

**Vi beholder fra WordPress**

- Alt er innhold med en type: innlegg, sider og egne innholdstyper i samme modell
- Taxonomies (kategorier, tagger, egne) som førsteklasses borgere
- Hooks og filters: kjernen kan utvides uten å røres
- Template-hierarkiet for temaer
- Mediebibliotek med automatiske bildestørrelser
- Revisjoner, autosave og planlagt publisering
- Roller og capabilities
- En admin som ikke-tekniske redaktører klarer seg i
- Import/eksport via WXR

**Vi kaster**

- postmeta-EAV og serialiserte PHP-arrays: erstattes av typede kolonner og JSONB
- Globale variabler og «The Loop»
- HTML-suppe fra editoren: innhold lagres som strukturerte blokker (JSON)
- WP-Cron som bare kjører ved besøk: erstattes av en ekte jobbkø
- XML-RPC, pingbacks og trackbacks
- Plugins som kjører vilkårlig kode i samme prosess uten typer eller rekkefølge

**Prinsipper**

1. Innholdsmodeller defineres i kode og versjoneres i git, men kan utvides fra admin.
2. API-først: admin og temaer bruker samme offentlige API som alle andre.
3. Raskt som standard: SSR/ISR-caching i Nuxt, ingen database-kall per besøk for statisk innhold.
4. Sikkert som standard: setup-token, genererte hemmeligheter, ingen `changeme`.
5. Kompatibel på kantene: WXR-import og valgfritt `/wp-json/wp/v2`-lag.

## Innlogging og kontoer

toascribe får sin egen innloggingsside som oppfører seg som `wp-login.php`: samme felter, samme lenker og samme flyt, slik at en WordPress-bruker kjenner seg igjen med en gang. Gamle adresser videresendes, så muskelminnet fungerer.

| Funksjon i WordPress | toascribe | Fase |
| --- | --- | --- |
| `wp-login.php` med brukernavn eller e-post, passord, «Husk meg» | `/login` med samme felter; logo og nettstedsnavn fra innstillingene | 0 |
| «Husk meg» gir lang økt (14 dager), ellers kort (2 dager) | Samme varigheter, httpOnly-cookie, økter lagret i databasen | 0 |
| «Mistet passordet?» med e-postlenke | Tidsbegrenset engangslenke (24 timer), deretter «Sett nytt passord» med styrkemåler | 0 |
| Registrering når «Hvem som helst kan registrere seg» er på | `/register`, standardrolle valgt i Innstillinger → Generelt, e-post med lenke for å sette passord | 0 |
| Utlogging med bekreftelse | `/logout` med CSRF-token; «Du er nå logget ut» på innloggingssiden | 0 |
| `redirect_to` etter innlogging | Samme parameter, kun til egne adresser | 0 |
| `/wp-admin` og `/wp-login.php` | Videresendes til admin-stien og `/login` | 0 |
| Innloggings-popup når økten utløper i editoren | Samme: modal innlogging uten å miste ulagret arbeid | 1 |
| Profil: fornavn, etternavn, kallenavn, «Vis navn offentlig som», e-post, nettsted, biografi | Samme felter på `/admin/profile` | 0 |
| E-postbytte krever bekreftelse via lenke | Samme | 0 |
| Generer passord, «Logg ut overalt ellers» | Samme, pluss liste over aktive økter | 0 |
| Profilbilde via Gravatar | Gravatar som standard, valgfritt eget opplastet bilde | 1 |
| Applikasjonspassord for API-tilgang | Samme, med navn, opprettet dato og sist brukt | 1 |
| Varsel til admin ved ny bruker og passordbytte | Samme e-poster, kan slås av | 0 |

**Roller og capabilities**

De fem standardrollene beholdes med samme navn og samme rettigheter, slik at dokumentasjon og vaner overføres direkte:

- **Administrator**: alt, inkludert innstillinger, temaer, utvidelser og brukere
- **Redaktør**: publisere og redigere alles innlegg og sider, moderere kommentarer, administrere kategorier
- **Forfatter**: publisere og redigere egne innlegg, laste opp media
- **Bidragsyter**: skrive egne innlegg, men ikke publisere
- **Abonnent**: lese og redigere egen profil

Capabilities får samme navn som i WordPress (`edit_posts`, `publish_posts`, `edit_others_posts`, `manage_options`, `upload_files` og så videre). Plugins kan legge til egne, og administrator kan lage nye roller.

**Utover WordPress (av som standard, unntatt begrensning av innlogginger)**

- Begrensning av feilede innlogginger per IP og konto (`login_attempt`): fase 0, alltid på
- Tofaktor med TOTP-app og gjenopprettingskoder: fase 0, valgfritt per bruker eller påkrevd per rolle
- Passkeys og pålogging via OIDC (Authentik, Google, Microsoft): fase 2

## Admin-opplevelsen

Admin skal se ut og oppføre seg som wp-admin: samme meny, samme rekkefølge, samme ord og de samme skjermmønstrene. Under panseret er det en moderne Vue-app, men en WordPress-bruker skal finne fram uten opplæring. Norske tekster følger ordene i den offisielle norske WordPress-oversettelsen.

**Hovedmenyen (venstre side, sammenleggbar, med ikoner)**

| Meny | Undersider |
| --- | --- |
| Kontrollpanel | Hjem, Oppdateringer |
| Innlegg | Alle innlegg, Legg til nytt, Kategorier, Stikkord |
| Media | Bibliotek (med mapper), Legg til ny |
| Sider | Alle sider, Legg til ny |
| Kommentarer | Én side med teller for ventende (fase 3) |
| Utseende | Temaer, Tilpass, Menyer, Widgets, Mønstre, Globale sett, Nettstedsredigering (fase 4) |
| Utvidelser | Installerte utvidelser, Legg til ny |
| Brukere | Alle brukere, Legg til ny, Roller, Profil |
| Verktøy | Importer, Eksporter, Omdirigeringer, Sikkerhetskopi, Rapporter, Revisjonslogg, Nettstedshelse, Eksporter persondata, Slett persondata |
| Innstillinger | Generelt, Skriving, Lesing, Diskusjon, Media, Permalenker, Personvern, Webhooks, AI, Avansert (CORS og API) |

Egne innholdstyper og plugins legger seg inn i menyen på samme måte som i WordPress, med egen plassering og ikon. Hver menyoppføring vises bare for roller som har rettigheten.

**Verktøylinjen (admin bar)**

- Vises øverst i admin og på nettstedet for innloggede brukere, kan slås av per bruker
- Nettstedsnavn, «+ Ny» (innlegg, side, media, bruker), «Rediger side» når man ser på innhold, kommentarteller, «Hei, navn» med profil og logg ut

**Kontrollpanelet**

- Widgets: Velkommen, Et øyeblikk (antall innlegg, sider, kommentarer), Aktivitet, Hurtigutkast, Nettstedshelse-status
- Kan flyttes, skjules og legges til av plugins

**Listeskjermene (innlegg, sider, media, kommentarer, brukere)**

- Statusfiltre med antall: Alle (12) | Publisert (8) | Utkast (3) | Papirkurv (1)
- Søk, filtrer etter dato og kategori, sortering på kolonner, paginering
- Massehandlinger: rediger, flytt til papirkurv, gjenopprett, slett permanent
- Lenker ved hover på tittel: Rediger | Hurtigredigering | Papirkurv | Vis
- Hurtigredigering direkte i listen (tittel, slug, dato, status, kategorier, stikkord)
- «Skjermalternativer» for synlige kolonner og antall per side, lagret per bruker

**Redigeringsskjermen**

- Tittel øverst, blokkeditor i midten, sidepanel til høyre
- Sidepanel: status og synlighet (offentlig, privat, passordbeskyttet), publiseringsdato, permalenke, forfatter, kategorier, stikkord, fremhevet bilde, utdrag, diskusjon (tillat kommentarer), «Fest øverst på forsiden»
- For sider: forelder, mal og rekkefølge (sideattributter)
- Knappene Lagre utkast, Forhåndsvis, Publiser/Oppdater, Flytt til papirkurv
- Revisjoner med sammenligning og gjenoppretting
- Låsing: «Ola redigerer dette innlegget nå», med mulighet til å ta over
- Blokkinnsetter med søk, skråstrek-kommandoer, mønstre og gjenbrukbare blokker

**Mediebiblioteket**

- Rutenett- og listevisning, dra-og-slipp-opplasting
- Detaljvindu: alternativ tekst, bildetekst, beskrivelse, filinfo, «Kopier URL»
- Enkel bilderedigering: beskjær, roter, speil, skaler

**Øvrig**

- Admin-varsler (notices) øverst som kan avvises, også fra plugins
- Fargeskjema for admin per bruker
- Kommandopalett (Ctrl+K) som i WordPress (siden 6.3)
- Admin på bokmål, nynorsk og engelsk fra fase 1, flere språk via oversettelsesfiler

## Funksjonskart

Hver WordPress-funksjon får en moderne erstatning og en fase (se faseplanen). Alt merket fase 1 er nødvendig for at systemet kan erstatte WordPress for en vanlig blogg eller firmaside.

| WordPress-funksjon | Ny implementasjon | Fase |
| --- | --- | --- |
| Innlegg og sider | `content`-tabell med `type`-felt, slugs og status (draft, pending, future, publish, private, trash) | 1 |
| Custom post types | Innholdstyper i kode (Zod-skjema) og fra admin (`content_type`), felter i JSONB med skjema | 2 |
| Kategorier, tagger, taxonomies | `taxonomy` + `term` + `content_term`, hierarkiske termer via `parent_id` | 1 |
| Gutenberg-editor | Blokktre i Vue med TipTap per tekstblokk; blokker lagret som JSON og rendret av Vue-komponenter i temaet | 1 (prototype i 0) |
| Revisjoner og autosave | `content_revision` og `content_autosave`, autosave hvert 30. sekund, diff-visning | 2 |
| Planlagt publisering | Styres av databasen, med en fast jobb hvert minutt i jobbkøen (pg-boss) | 1 |
| Mediebibliotek | Opplasting til lokal disk eller S3-kompatibel lagring, bildestørrelser og WebP/AVIF med pyvips | 1 |
| Brukere, roller, capabilities | `account`, `role`, `account_role` og økter med httpOnly-cookie | 0 |
| Kommentarer | Trådede kommentarer med moderering og spamfilter-hook; de importeres allerede i fase 2 | 3 |
| Menyer | Menyer som JSON-tre med lenker til innhold, termer eller eksterne URL-er | 1 |
| Widgets og sidebars | Områder i temaet som tar blokker, redigert i admin | 3 |
| Temaer og template-hierarki | Nuxt layers + hierarki-oppslag i en catch-all-rute; ett tema valgt i konfigurasjonen til fase 3 | 1 |
| Full site editing | Maler og malbiter av blokker (`template`), redigerbare i admin | 4 |
| Permalinks | Konfigurerbare mønstre (`/{year}/{slug}`), 301 lagret ved slug-endring | 1 |
| Shortcodes | Erstattet av blokker; plassholder og enkel parser ved WXR-import | 2 |
| RSS, sitemap, robots.txt | Nuxt-server-ruter fra API-et | 1 |
| Søk | PostgreSQL fulltekst (`tsvector`), valgfritt Meilisearch via utvidelse | 2 |
| REST API | Eget API under `/api/v1/` med OpenAPI; `/wp-json/wp/v2` som innebygd modul | 1 (eget) / 2 (WP-lesing) / 4 (WP-skriving) |
| Innstillinger (`wp_options`) | `setting`-tabell med typede nøkler validert av Zod | 1 |
| WP-Cron | Jobbkø i PostgreSQL (pg-boss) med faste tidsplaner | 0 |
| Plugins | npm-pakker med serverdel og Nuxt layer, med manifest, se utvidelsesspesifikasjonen | 3 |
| Flerspråk (i18n) | Admin på bokmål, nynorsk og engelsk; flere språk via filer; oversettelse av innhold | 1 (admin) / 2 (flere språk) / 4 (innhold) |
| Multisite | Utsettes; én installasjon per nettsted til behovet er bevist | Senere |
| Import/eksport | WXR-import (innhold, termer, media, brukere og kommentarer), WXR- og JSON-eksport | 2 |
| Oppdateringer | Ny Docker-image + automatiske migrasjoner; Kontrollpanel → Oppdateringer viser status | 1 |
| Site Health | Verktøy → Nettstedshelse: Info, logg, test-e-post og siste sikkerhetskopi; Status med anbefalinger kommer senere | 1 (Info) / 3 (Status) |

Detaljseksjonene har ikke alltid egen fasekolonne. Fasen for det som ikke står i en tabell, er fastsatt her, og ved uenighet gjelder funksjonsregisteret i egen fane:

- **Fase 0:** CSRF, rettighetssjekk per endepunkt, begrensning av innlogginger, sikkerhetsheadere, SSRF-klient, jobbkø og e-posttjeneste med SMTP, healthcheck, delte Zod-skjemaer og typer i packages/shared med OpenAPI generert fra dem, tofaktor (TOTP) med gjenopprettingskoder.
- **Fase 1:** grunnblokkene (avsnitt, overskrift, liste, sitat, bilde, galleri, knapper, kolonner, gruppe, avstand, skillelinje, innbygging, kode, tabell, HTML, Les mer, sideskift), blokkinnsetter med skråstrek, tema-SDK med ScribeHead, ScribeFooter og ScribeBlocks, Query Loop, arkiver, søkeside og 404, innstillingssidene Generelt, Skriving, Lesing, Media, Permalenker og Personvern, Tilpass, verktøylinjen, kontrollpanelet, admin-varsler, fargeskjema, forhåndsvisningslenke, SSR-cache med tagger, revisjonslogg, mediemapper, privat media, opplastingsvern, srcset, oEmbed, barnetemaer og sikkerhetskopi via CLI.
- **Fase 2:** mønstre og synkroniserte mønstre, klassisk blokk, blokkmigrering, innliming fra Word, persondataeksport og -sletting, passkeys, OIDC, stikkord og duplikatdeteksjon for media, CORS, RSS-import, blokk-lekeplass og låsing av innlegg (i fase 1 varsles det ved lagring hvis noen andre har endret innholdet).
- **Fase 3:** mu-plugins, automatiske oppdateringer av utvidelser, blokkbindinger, Innstillinger → Diskusjon og sårbarhetsvarsler.

## Arkitektur

Systemet består av en proxy-container (Caddy) som ruter etter sti, to Nuxt-apper (`site` for nettstedet og `admin` for `/admin` og `/setup`), API-et i Hono på Node (`api`), en `worker` og en `builder`. En ekstern Traefik eller nginx sender all trafikk til proxy-containeren. API-et eier all data og forretningslogikk, og admin og temaer bruker samme API som eksterne klienter, så det finnes ingen bakdører.

&#91;embedded content: arkitektur · to app-containere, én worker, tre datalagre\]

**Repo-struktur (monorepo)**

- `apps/api/`: Hono-API på Node: ruter, tjenester, repositories og hook-registry
- `apps/worker/`: pg-boss-arbeider for bakgrunnsjobber og faste tidsplaner, samme image som API-et
- `apps/site/`: Nuxt-appen for nettstedet, med tema-oppslag og tema-SDK
- `apps/admin/`: Nuxt-appen for admin og setup
- `packages/shared/`: Zod-skjemaer og typer som API, admin, temaer og utvidelser deler
- `packages/db/`: Drizzle-skjema, databaseklient og SQL-migrasjoner
- `packages/sdk/`: utvidelses- og tema-SDK (`definePlugin`, hook-typer, testhjelpere)
- `packages/ui/`: felles komponenter for admin og utvidelser
- `packages/blocks/`: blokkdefinisjoner (JSON Schema) brukt av både editor og API
- `themes/default/`: standardtemaet som Nuxt layer
- `docker/`: Dockerfiler, `compose.yaml` og proxy-oppsett
- `cli/`: `toa`-kommandoen, skrevet i TypeScript

**Verktøy**: ett pnpm-workspace med kataloger (én versjon per avhengighet), TypeScript 6.0 med streng tsconfig, ESLint med typet linting, Vitest for enhets- og integrasjonstester og Playwright for ende-til-ende. API og frontend deler Zod-skjemaene i packages/shared, så typene aldri glir fra hverandre; OpenAPI-dokumentet lages fra de samme skjemaene, for eksterne klienter.

**Stacken lag for lag**

| Lag | Valg | Erstatter fra Python-planen |
| --- | --- | --- |
| Kjøremiljø | Node 24 LTS (≥ 24.12), TypeScript 6.0 | Python 3.14 |
| API | Hono med @hono/zod-openapi | FastAPI |
| Validering og typer | Zod 4 i packages/shared | Pydantic |
| Database | Drizzle ORM med pg, PostgreSQL | SQLAlchemy med asyncpg |
| Migrasjoner | drizzle-kit, gjennomleste SQL-filer i git | Alembic |
| Jobbkø | pg-boss | procrastinate |
| Logging | pino | logging |
| Tester | Vitest og Playwright | pytest |
| Lint og formatering | ESLint med typescript-eslint, Prettier | Ruff |
| Pakker | pnpm-workspace med kataloger | uv |
| Utvidelser | npm-pakker med definePlugin() | Python-pakker med entry point |

Detaljene og versjonsgulvene står i toa-rules TYPESCRIPT\_STANDARD\_2026 (v1.0). Den viktigste begrunnelsen for byttet: kjerne, temaer og utvidelser skrives i samme språk og deler typer, så en utvidelsesutvikler trenger bare TypeScript.

**API-versjonering**: eget API ligger under `/api/v1/`. Endepunkter fjernes ikke innen en hovedversjon, og avvikling merkes med `Deprecation`-header i minst én minor-versjon. Ekstern tilgang bruker applikasjonspassord, med OAuth senere. CORS er av som standard og settes per opprinnelse under Innstillinger → Avansert. `/wp-json/wp/v2` er en innebygd modul i kjernen som kan slås av under Innstillinger → Lesing: lesing av innlegg, sider, media, termer og brukere kommer i fase 2, skriving i fase 4.

**API-endepunktkart (v1)**

Alle stier ligger under `/api/v1`. Ressurser følger mønsteret liste, opprett, hent, endre og slett (`GET`, `POST`, `GET/PATCH/DELETE /{id}`). Lister tar `page`, `per_page`, `orderby`, `order`, `search`, `status` og `include`, og svarer med `X-Total-Count` og `X-Total-Pages`. Endrende kall krever `X-CSRF-Token` ved innlogging med cookie, eller applikasjonspassord. En funksjon regnes ikke som planlagt før endepunktet står her.

| Område | Endepunkter | Rettighet | Fase |
| --- | --- | --- | --- |
| Innlogging | `POST /auth/login`, `/auth/logout`, `/auth/register`, `/auth/mfa/verify`, `/auth/password/lost`, `/auth/password/reset`, `/auth/password/set`; `GET /auth/session`, `/auth/options` | – | 0 |
| Meg | `GET/PATCH /me`, `PATCH /me/password`, `POST /me/email-change`, `/me/email-change/confirm`; `GET/DELETE /me/sessions`, `DELETE /me/sessions/{id}`; `GET /me/mfa`, `POST /me/mfa/totp`, `/me/mfa/totp/{id}/confirm`, `/me/mfa/recovery-codes`, `DELETE /me/mfa/{id}`; `/me/app-passwords`, `PATCH /me/preferences` | read; passord, e-post og tofaktor krever passordet på nytt | 0–1 |
| Brukere og roller | `/users`, `POST /users/bulk`, `POST /users/{id}/reset-password`, `DELETE /users/{id}?reassign=`, `/roles` | list\_users, edit\_users, promote\_users | 0–1 |
| Innhold | `/content?type=`, `POST /content/{id}/publish`, `/trash`, `/restore`, `/preview-link`, `POST /content/bulk`; `GET /content/{id}/revisions`, `PUT /content/{id}/autosave`, `GET/PUT/DELETE /content/{id}/draft`, `POST /content/{id}/lock` | edit\_posts, publish\_posts, edit\_others\_posts | 1–2 |
| Innholdstyper og felter | `/content-types`, `/field-groups` | manage\_options | 2 |
| Taxonomies | `/taxonomies`, `/taxonomies/{tax}/terms` | manage\_categories | 1 |
| Media | `/media` (multipart), `POST /media/{id}/replace`, `/media/{id}/edit`, `/media/regenerate`, `/media-folders` | upload\_files | 1 |
| Menyer, områder, sett, mønstre, maler | `/menus`, `/menu-locations`, `/global-sets`, `/areas`, `/patterns`, `/templates` | edit\_theme\_options | 1–4 |
| Kommentarer | `/comments`, `POST /comments/{id}/approve`, `/spam` | moderate\_comments | 3 |
| Innstillinger | `GET/PATCH /settings/{gruppe}` for general, writing, reading, discussion, media, permalinks, privacy, webhooks, ai og advanced | manage\_options | 1 |
| Offentlig lesing (tema-SDK) | `GET /public/resolve?path=`, `/public/query`, `/public/menus/{location}`, `/public/areas/{id}`, `/public/settings`, `/public/search`; `POST /public/comments`, `/public/consent` | – | 1–3 |
| Verktøy | `POST /import/wxr`, `GET /import/{jobb}`, `POST /export`, `/redirects`, `GET /not-found-log`, `/privacy-requests`, `/webhooks`, `GET /webhooks/{id}/deliveries` | import, export, manage\_options | 2 |
| System | `GET /site-health`, `/updates`, `/audit-log`, `/jobs`; `/backups`, `POST /backups/{id}/restore`, `POST /cache/flush`, `POST /system/test-email`. Utenfor `/api/v1` og uten innlogging: `GET /api/health`, `/api/ready` | manage\_options | 0–2 |
| Temaer og utvidelser | `/themes`, `POST /themes/{slug}/preview`, `/activate`; `/plugins`, `POST /plugins/{slug}/activate`, `/deactivate`; `GET /builds/{id}` | switch\_themes, activate\_plugins | 3 |
| Butikk | `/shop/products`, `/shop/variants`, `/shop/stock`, `/shop/cart`, `/shop/checkout`, `/shop/orders` med `capture`, `refund`, `notes` og `resend-email`, `/shop/customers`, `/shop/coupons`, `/shop/shipping-zones`, `/shop/tax-classes`, `/shop/reports`, `/shop/withdrawals`, `POST /shop/payments/{leverandør}/webhook` | manage\_shop | B1–B2 |

## Datamodell i PostgreSQL

Tabellen under er den fullstendige listen for kjernen, med ekte typer og fremmednøkler, og alle tabellene opprettes i fase 0 selv om noen først tas i bruk senere. Nye funksjoner legger til rader her før de får kode. Alle tidspunkt lagres som timestamptz i UTC; alt som i WordPress lå i `postmeta` havner i et JSONB-felt validert mot innholdstypens skjema. Skjemaet skrives i Drizzle (packages/db), og migrasjonene er SQL-filer i git som drizzle-kit lager og kjører.

| Tabell | Innhold | Erstatter i WordPress |
| --- | --- | --- |
| `account` | brukernavn (unikt), e-post, visningsnavn, nicename (slug for forfatterarkiv), passord-hash, status, locale, `profile` og `preferences` (JSONB: adminfarge, verktøylinje, skjermalternativer, avviste varsler, kontrollpanel) | `wp_users` + `wp_usermeta` |
| `role`, `account_role` | roller med capabilities, og hvem som har hvilke | `wp_user_roles` |
| `session` | økter med enhet, IP og utløp | `session_tokens` |
| `app_password`, `mfa_credential`, `recovery_code` | applikasjonspassord, TOTP, passkeys, gjenopprettingskoder | applikasjonspassord |
| `login_attempt` | IP, konto og tidspunkt, for begrensning av innlogginger uten Valkey | utvidelser |
| `content` | id (UUID), short\_id (heltall for `/?p=`), type, locale, translation\_group, slug (unik per type, språk og forelder), title, excerpt, status, status\_before\_trash, password, sticky, comment\_status, menu\_order, template, parent\_id, featured\_media\_id, published\_at, unpublish\_at, workflow\_state, `blocks`, `fields`, `seo` (tittel, beskrivelse, bilde, noindex), `search`, created\_at, modified\_at, legacy\_wp\_id | `wp_posts` + `wp_postmeta` |
| `content_type`, `field_group` | innholdstyper og feltgrupper laget i admin, skjema som JSONB, låst når de finnes i kode | `register_post_type()`, ACF |
| `content_author` | content\_id, account\_id, sort | `post_author` |
| `content_draft` | ventende utkast til publisert innhold, med release\_id og workflow\_state | finnes ikke |
| `content_autosave` | én rad per bruker og innhold, overskrives | autosave-revisjoner |
| `content_revision` | snapshot ved lagring og publisering, maks 25 per innhold som standard | revisjoner |
| `content_lock` | content\_id, account\_id, heartbeat\_at | `_edit_lock` |
| `content_ref` | lenker og mediebruk mellom innhold | finnes ikke |
| `block_note` | content\_id, block\_id, account\_id, tekst, løst | Notes (6.9) |
| `template` | slug, type (mal eller malbit), tema, `blocks` | `wp_template`, `wp_template_part` |
| `taxonomy`, `term`, `content_term` | taxonomies, termer (med beskrivelse) og koblinger | `wp_terms`, `wp_term_taxonomy`, `wp_term_relationships` |
| `media`, `media_folder`, `media_term` | title, alt, caption, description, mime, størrelse, dimensjoner, sha256, focal\_point, folder\_id, uploaded\_by, attached\_to, visibility (offentlig eller privat), `variants`, storage\_key; mapper og stikkord | vedlegg |
| `menu`, `area`, `global_set`, `pattern` | menyer, widget-områder, globale sett og synkroniserte mønstre (JSONB) | `nav_menu_item`, `sidebars_widgets`, `wp_block` |
| `comment` | content\_id, parent\_id, account\_id, author, author\_email, author\_url, ip, user\_agent, type, body, status, created\_at | `wp_comments` |
| `setting` | key, value (JSONB), autoload | `wp_options` |
| `oembed_cache` | url, data, utløper | `_oembed_*` |
| `redirect`, `not_found_log` | omdirigeringer og 404-logg | utvidelser |
| `webhook`, `webhook_delivery` | webhooks og leveranselogg | finnes ikke |
| `release`, `workflow` | samlede utgivelser og arbeidsflyter | finnes ikke |
| `extension_state` | installerte temaer og utvidelser, versjon, aktiv, innstillinger | `active_plugins` |
| `backup` | type, start og slutt, størrelse, lagringsmål, status, verifisert | utvidelser |
| `audit_log` | hvem gjorde hva; IP lagres i 90 dager | finnes ikke |
| `privacy_request`, `consent` | GDPR-forespørsler og samtykker | `user_request` |

Jobbkøen (pg-boss) oppretter sine egne tabeller i skjemaet `pgboss`.

**Valg som skiller seg fra WordPress**

- UUID-er som ID-er, slik at innhold kan flyttes mellom installasjoner uten kollisjoner.
- Media er sin egen tabell, ikke en post-type.
- Menyelementer lagres som ett JSON-tre per meny, ikke som egne rader.
- GIN-indekser på `fields` og `blocks` slik at spørringer på egendefinerte felt er raske.
- Soft delete via `status = trash` med automatisk tømming etter 30 dager, som i WordPress.

`content` holder alltid den publiserte versjonen. Et utkast til noe som allerede er publisert, ligger i `content_draft` (maks ett per innhold) til det publiseres. `status` beskriver synlighet (draft, pending, future, publish, private, trash), mens `workflow_state` bare er det redaksjonelle steget og aldri publiserer på egen hånd. I fase 1 lagrer «Oppdater» direkte i content, som i WordPress; fra fase 2 kan redaktøren velge «Lagre som ventende endring», som skriver til content\_draft. Tabellen heter `account` fordi `user` er et reservert ord i PostgreSQL.

## Utvidelsessystem: hooks, plugins og temaer

Utvidelser får de samme mulighetene som i WordPress, men gjennom typede, navngitte hendelser i stedet for globale strenger. En utvidelse kan ha en serverdel (TypeScript som kjører i API-et og workeren), en frontend-del (Nuxt layer), eller begge.

**Hooks i API-et**

- *Actions* er hendelser uten returverdi: `content.published`, `media.uploaded`, `user.created`.
- *Filters* endrer en verdi og sender den videre: `content.before_save`, `content.render_blocks`, `api.response`.
- Hver hook har et Zod-skjema og en TypeScript-type for argumentene i packages/sdk, og hver lytter har en eksplisitt prioritet. En utvidelse som lytter på feil hook eller sender feil verdi, får kompileringsfeil.
- Implementeres med en liten egen typet hook-registry i API-et, async-vennlig.

**Plugins**

- En utvidelse er en npm-pakke med et manifest (`plugin.json`: navn, versjon, capabilities den trenger, migrasjoner, innstillingsskjema) og et serverinngangspunkt som eksporterer `definePlugin()` fra SDK-et.
- Plugins kan registrere innholdstyper, felter, taxonomies, API-ruter, admin-sider, blokker og jobber.
- Egne tabeller får plugins via egne Drizzle-migrasjoner (SQL-filer i pakken) med tabellprefikset plugin\_\<slug>\_.
- Installasjon skjer med pnpm til et eget workspace på volumet «plugins/» (se «Kjøremodell for temaer, utvidelser og bygg»), ikke som zip-filer lastet opp i admin. Det er tryggere og reproduserbart.

**Temaer**

- Et tema er et Nuxt layer med layouts, komponenter for blokker og maler for template-hierarkiet.
- Hierarkiet slås opp i en catch-all-rute: `single-{type}-{slug}` → `single-{type}` → `single` → `index`, tilsvarende for arkiv, termer, søk og 404.
- `theme.json`-lignende manifest definerer farger, fonter, menyplasseringer, områder og innstillinger som redigeres i admin uten rebuild.
- Bytte av tema trigger en bakgrunns-build; gammel versjon kjører til den nye er klar, og feilet build endrer ingenting.
- Standardtemaet er minimalt og fungerer som referanse og dokumentasjon for å lage egne temaer.

## Kjøremodell for temaer, utvidelser og bygg

Temaer og utvidelser er kode som kommer inn i et system som oppdateres ved å bytte Docker-image. Denne seksjonen bestemmer hvor koden ligger, hvem som bygger den og hva den får tilgang til, og den går foran alt annet i dokumentet. Den skal være avklart før fase 0 avsluttes.

**Begge er betrodd kode**

- Utvidelser er TypeScript i samme Node-prosess som kjernen, og temaer kjører i Nuxt med serverrendring. Ingen av dem kan sandkasses fullt ut.
- `permissions` i manifestet er en erklæring som vises før aktivering og kontrolleres i katalog-gjennomgangen. Det er ikke en sandkasse.
- Derfor installeres utvidelser bare fra katalogen eller med pakkehåndterer. Temaer kan lastes opp som zip bare av administrator, med en tydelig advarsel.

**Admin som egen app på /admin**

- Som i WordPress ligger admin på samme domene, under `/admin` (og `/wp-admin` videresender dit). Den bygges og kjøres som en egen Nuxt-app som proxyen ruter til etter sti, så et tema som krasjer tar ikke ned admin.
- Alle API-kall som endrer noe, krever et CSRF-token i en header i tillegg til innloggingscookien, slik WordPress krever nonces.
- Admin har streng Content-Security-Policy, og skript fra temaer og tredjeparter lastes aldri inn i admin.
- Eget domene for admin (f.eks. `admin.<domene>`) er et valgfritt herdingsvalg i oppsettet. Egen port brukes ikke.

**Hvor koden ligger**

- Utvidelser installeres med pnpm i et eget workspace på volumet `plugins/`, låst i `plugins/pnpm-lock.yaml`. API-et og workeren laster bare det som står i låsefila.
- Utvidelser leveres som bygget JavaScript (`dist/`) med typer. Node kjører ikke `.ts`-filer fra `node_modules`, og en ferdig bygget pakke er det katalog-gjennomgangen faktisk har sett.
- Temaer ligger på volumet `themes/`.
- Ved oppdatering av kjernen installeres låsefila på nytt mot ny image. En utvidelse som ikke lar seg installere, eller som krever en annen `pluginApi`, deaktiveres med varsel.
- Aktivering av en utvidelse med bare serverdel starter API-et og workeren på nytt (sekunder). Har den frontend-del, trengs et bygg, også ved deaktivering.

**Byggetjenesten (`builder`)**

- Egen container uten tilgang til databasens hemmeligheter. Den kjører `pnpm install --ignore-scripts` og bygger kjernen, aktivt tema og aktive frontend-utvidelser til `builds/<hash>/` på et delt volum.
- Nettstedet peker på `builds/current`, som byttes når bygget er ferdig. Forrige bygg beholdes, og feiler forsiden i helsesjekken etter byttet, rulles det tilbake automatisk.
- Et Nuxt-bygg tar minutter og 2–4 GB minne. Minstekrav: 2 GB RAM i drift og 4 GB under bygg. Temaer i katalogen kan leveres ferdig bygget for vanlige kombinasjoner.
- Forhåndsvisning og bytte av tema fra admin kommer derfor i fase 3; før det velges tema i `toascribe.toml`.

## Temaspesifikasjon og installasjon

Et tema er gyldig bare hvis det følger en fast kontrakt: en bestemt mappestruktur, et manifest (`theme.json`) og noen få regler for hva temaet får og ikke får gjøre. Appen sjekker kontrakten automatisk før et tema kan installeres, forhåndsvises eller aktiveres. Kontrakten versjoneres (`themeApi: 1`), slik at gamle temaer kan avvises med en tydelig melding i stedet for å knekke nettstedet.

**Mappestruktur**

```
mitt-tema/
  theme.json          påkrevd: manifestet
  screenshot.png      påkrevd: 1200×900, vises under Utseende → Temaer
  nuxt.config.ts      påkrevd: temaet er et Nuxt layer
  templates/
    index.vue         påkrevd: siste fallback for alt
    single.vue        valgfri: enkeltinnlegg
    page.vue          valgfri: sider
    archive.vue       valgfri: arkiver
    search.vue        valgfri
    404.vue           valgfri
    front-page.vue    valgfri: statisk forside
  layouts/            valgfri: rammer rundt malene
  blocks/             valgfri: egen visning av kjerneblokker
  components/         valgfri
  locales/            valgfri: nb.json, en.json
  public/             valgfri: bilder, fonter
  README.md
  CHANGELOG.md
```

Bare `theme.json`, `screenshot.png`, `nuxt.config.ts` og `templates/index.vue` er påkrevd, akkurat som `style.css` og `index.php` er minimum i WordPress. Alt annet faller tilbake etter template-hierarkiet.

**Manifestet (`theme.json`)**

| Felt | Innhold | Tilsvarer i WordPress |
| --- | --- | --- |
| `name`, `slug`, `version`, `description` | Navn, unik slug, semver-versjon, beskrivelse | Header i `style.css` |
| `author`, `authorUri`, `themeUri`, `license` | Opphav og lisens | Header i `style.css` |
| `requires` | Minste toascribe-versjon og `themeApi`-versjon | «Requires at least» |
| `parent` | Slug til foreldretema (for barnetemaer) | «Template» |
| `menus` | Menyplasseringer temaet tilbyr (f.eks. `primary`, `footer`) | `register_nav_menus()` |
| `areas` | Widget-områder (f.eks. `sidebar`, `footer-1`) | `register_sidebar()` |
| `supports` | Funksjoner: fremhevet bilde, logo, egendefinert bakgrunn, kommentarer, ekstra CSS | `add_theme_support()` |
| `settings` | Farger, fonter, avstander og egne valg med typer og standardverdier, vist i Tilpass | `theme.json` + Customizer |
| `templates` | Egne sidemaler brukeren kan velge per side (f.eks. «Full bredde») | «Template Name:» |
| `imageSizes` | Ekstra bildestørrelser temaet trenger | `add_image_size()` |

Manifestet valideres mot et JSON Schema som publiseres på toascribe.dev, så editorer gir autofullføring og feilmeldinger mens man skriver.

**Regler et tema må følge**

1. Data hentes bare via tema-SDK-et (`useContent`, `useQuery`, `useMenu`, `useArea`, `useSettings`, `useUser`), aldri ved direkte kall mot interne adresser.
2. Hver layout må ha `<ScribeHead />` og `<ScribeFooter />`, som tilsvarer `wp_head()` og `wp_footer()`. Der setter kjernen og utvidelser inn SEO-meta, verktøylinjen, skript og stiler.
3. Innhold rendres med `<ScribeBlocks :blocks />`. Kjernen har standardvisning for alle blokker, så temaet trenger bare overstyre de det vil style annerledes.
4. Kjernens komponenter for kommentarer, passordskjema, paginering og søk brukes eller overstyres, ikke bygges fra bunnen.
5. Ingen `server/`-mappe, Nitro-ruter, servermiddleware eller kode som kjører i API-et. Temaer er kun visning; logikk hører hjemme i utvidelser.
6. Avhengigheter i `package.json` må være låst med lockfil og er begrenset i størrelse.
7. All tekst går via `t()` slik at temaet kan oversettes.
8. Standardtemaet og temaer i katalogen skal følge WCAG 2.2 AA.

Regel 5 holder logikk ute av temaer, men er ingen sikkerhetsgrense: temaer regnes som betrodd kode, se «Kjøremodell for temaer, utvidelser og bygg».

**Barnetemaer**

Som i WordPress kan et tema ha `parent` i manifestet. Barnetemaet arver alt fra foreldretemaet og overstyrer bare filene det selv har, noe Nuxt layers støtter direkte. Oppdatering av foreldretemaet overskriver aldri endringene i barnetemaet.

**Installasjon (Utseende → Temaer → Legg til nytt)**

1. Brukeren velger kilde: katalogen på toascribe.dev, opplasting av zip, eller git-URL.
2. Pakken pakkes ut i et midlertidig område, aldri rett i temamappen.
3. Validering: påkrevde filer, manifest mot schema, `requires` mot installert versjon, forbudte mapper og filer, størrelsesgrense, at foreldretema finnes.
4. Feiler valideringen, vises en liste over hva som er feil, og ingenting installeres.
5. Godkjent tema lagres på temavolumet og vises i listen med skjermbilde.
6. «Forhåndsvis» bygger temaet i en isolert byggecontainer og åpner det på en midlertidig adresse med nettstedets ekte innhold.
7. «Aktiver» bygger på nytt og bytter atomisk; feilet bygg betyr at det gamle temaet blir stående.
8. Ved aktivering kobles menyer og widget-områder automatisk når plasseringene har samme navn, ellers spør admin hvor de skal flyttes, som i WordPress.

**Oppdatering og sletting**

- Temaer fra katalogen sjekkes for nye versjoner og vises under Kontrollpanel → Oppdateringer
- En oppdatering går gjennom samme validering og bygg; forrige versjon beholdes til den nye kjører
- Aktivt tema og foreldre til aktivt tema kan ikke slettes
- Tema-innstillinger lagres per tema, så de er der igjen hvis man bytter tilbake

**Verktøy for temautviklere**

- `toa theme create <navn>` lager et nytt tema eller barnetema fra mal
- `toa theme dev` kjører temaet med hot reload mot en lokal installasjon
- `toa theme validate` kjører samme sjekk som installasjonen
- `toa theme package` lager zip klar for opplasting eller katalogen

**Utvidelser**

Utvidelser følger samme tankegang, men med en strengere kontrakt fordi de kjører serverkode. Den er beskrevet i neste seksjon.

## Utvidelsesspesifikasjon

En utvidelse er gyldig bare hvis den følger kontrakten: fast mappestruktur, et manifest (`plugin.json`), en definert livssyklus og regler for hva den får røre. I admin heter de «Utvidelser», som i norsk WordPress; i kode og dokumentasjon brukes «plugin». Kontrakten versjoneres som `pluginApi: 1`, og kjernen lover at hooks og SDK-funksjoner i en `pluginApi`-versjon ikke fjernes uten ny hovedversjon.

**Mappestruktur**

```
min-utvidelse/
  plugin.json           påkrevd: manifestet
  package.json          påkrevd: npm-pakke, "type": "module", exports peker på dist/
  tsconfig.json         arver toascribes base-tsconfig
  server/
    index.ts            definePlugin({ register }): kobler til hooks, ruter, jobber
    schema.ts           egne tabeller (Drizzle)
    migrations/         egne SQL-migrasjoner (drizzle-kit)
    routes.ts           API-ruter under /api/plugins/<slug>/ (Hono + Zod)
    jobs.ts             bakgrunnsjobber og faste tidsplaner (pg-boss)
    uninstall.ts        valgfri: rydder data ved sletting
  dist/                 bygget JavaScript + typer, det som publiseres
  frontend/
    nuxt.config.ts      Nuxt layer
    admin/              egne admin-sider
    blocks/             blokker for editor og visning
    components/         komponenter temaer kan bruke
  blocks/<blokk>/block.json   skjema for hver blokk
  locales/              nb.json, en.json
  assets/icon.svg, assets/banner.png   for katalogen
  README.md, CHANGELOG.md, LICENSE
```

Påkrevd er `plugin.json` og minst én av `server/` eller `frontend/`. En ren server-utvidelse (f.eks. SMTP-oppsett eller spamfilter) trenger ingen frontend-del.

**Manifestet (`plugin.json`)**

| Felt | Innhold | Tilsvarer i WordPress |
| --- | --- | --- |
| `name`, `slug`, `version`, `description`, `author`, `license` | Identitet og semver-versjon | Plugin-headeren |
| `requires` | Minste toascribe-, `pluginApi`- og Node-versjon | «Requires at least», «Requires PHP» |
| `dependsOn` | Andre utvidelser som må være aktive | «Requires Plugins» |
| `permissions` | Det utvidelsen trenger: `network`, `email`, `media.write`, `users.read`, `settings.write` osv. | Finnes ikke; nytt |
| `capabilities` | Nye rettigheter den legger til og hvilke roller som får dem | `add_cap()` |
| `adminMenu` | Menyoppføringer: tittel, ikon, plassering, påkrevd rettighet | `add_menu_page()` |
| `settings` | Innstillingsskjema; kjernen lager innstillingssiden automatisk | Settings API |
| `contentTypes`, `taxonomies` | Innholdstyper og taxonomies den registrerer | `register_post_type()` |
| `blocks` | Blokkene den leverer | `register_block_type()` |
| `schedules` | Faste jobber (f.eks. hver time) | WP-Cron |
| `uninstall` | Om data slettes ved avinstallering, og hvordan | `uninstall.php` |

**Livssyklus (som i WordPress)**

| Steg | Hva skjer | WordPress |
| --- | --- | --- |
| Installer | Pakken valideres og legges til; ingenting kjører ennå | Installer |
| Aktiver | Rettigheter vises og godkjennes, migrasjoner kjøres, `on_activate` kalles, API-et og workeren startes på nytt i bakgrunnen; har den frontend-del, bygges nettstedet på nytt | `register_activation_hook` |
| Deaktiver | Hooks og ruter kobles fra, `on_deactivate` kalles; data beholdes | `register_deactivation_hook` |
| Slett | Bare mulig når deaktivert; `uninstall.ts` kjøres, egne tabeller fjernes etter bekreftelse | `uninstall.php` |
| Oppdater | Ny versjon valideres, nye migrasjoner kjøres, gammel versjon kjører til den nye er klar | Oppdater |

**Regler en utvidelse må følge**

1. Kjernen nås bare via plugin-SDK-et: hooks, tjenester for innhold, media, brukere, innstillinger og e-post. Aldri direkte SQL mot kjernens tabeller.
2. Egne tabeller får prefikset `plugin_<slug>_` og opprettes og endres bare med egne migrasjoner, som må kunne rulles tilbake.
3. Alle API-ruter ligger under `/api/plugins/<slug>/` og må oppgi hvilken rettighet som kreves.
4. Utvidelsen får bare gjøre det den har oppgitt i `permissions`. Admin ser listen før aktivering. Det er en erklæring, ikke en sandkasse: SDK-tjenestene avviser kall som ikke er erklært, men det stopper bare ærlige feil.
5. Hooks er asynkrone og raske; tungt arbeid legges i jobbkøen. Tidsgrensen gjelder asynkrone lyttere; synkron eller tung kode legges i jobbkøen.
6. Ingen endring av andre utvidelsers tabeller, ingen monkeypatching av kjernen.
7. Admin-sider bygges med kjernens admin-komponenter, så de ser ut som resten av admin.
8. All tekst går via oversettelser; admin-sider følger WCAG 2.2 AA.

**Unntak for første-parts utvidelser:** utvidelser i navnerommet `toascribe/` kan få et reservert tabellprefiks og en API-sti som er godkjent i kjernen. Butikk bruker `shop_` og `/api/v1/shop/`. Alle andre bruker `plugin_<slug>_` og `/api/plugins/<slug>/`. `/wp-json/wp/v2` er en innebygd modul i kjernen, ikke en utvidelse.

**Feilisolering (som WordPress' gjenopprettingsmodus)**

- Kaster en utvidelse feil ved oppstart, deaktiveres den automatisk og admin får et varsel med feilmeldingen
- Administrator får e-post med en lenke til gjenopprettingsmodus, der den feilende utvidelsen er slått av mens resten av nettstedet kjører
- `toa plugin deactivate <slug>` fungerer selv om admin ikke laster

**Utvidelser som alltid er aktive**

Som WordPress' `mu-plugins`: utvidelser i mappen `mu-plugins/` lastes alltid og kan ikke deaktiveres fra admin. Nyttig for driftsoppsett og vertsleverandører.

**Installasjon (Utvidelser → Legg til ny)**

1. Søk i katalogen på toascribe.dev, eller installer med `toa plugin install <pakke>`.
2. Pakken valideres: manifest mot schema, `requires`, `dependsOn`, signatur for katalogpakker, forbudte importer.
3. Feiler valideringen, vises hva som er feil, og ingenting installeres.
4. Godkjent utvidelse vises i listen med «Aktiver».
5. Utvidelser kan ikke lastes opp som zip.

**Katalogen på toascribe.dev**

- Automatiske sjekker ved innsending: validering, tester, avhengighetsskanning
- Manuell gjennomgang før første publisering, deretter automatisk for oppdateringer
- Pakker signeres, og appen viser hvem som har publisert dem

**Verktøy for utviklere**

- `toa plugin create <navn>` lager ny utvidelse fra mal (server, frontend eller begge)
- `toa plugin dev` kjører den mot en lokal installasjon med reload
- `toa plugin validate` kjører samme sjekk som installasjonen
- `toa plugin package` lager pakke klar for katalogen
- Testhjelpere for Vitest i SDK-et som starter et midlertidig nettsted med utvidelsen aktiv
- En generert oversikt over alle hooks med typer og eksempler på toascribe.dev

## Blokkspesifikasjon

Alt innhold er blokker lagret som JSON, og hver blokktype beskrives av en `block.json` som både editoren, backend og temaer leser. Det samme formatet brukes av kjernen, temaer og utvidelser. Den største forskjellen fra WordPress er at innhold lagres som data, ikke som ferdig HTML med kommentarmarkører, så en endret blokk ødelegger aldri gammelt innhold.

**Slik lagres en blokk**

```json
{
  "id": "b_7f3a",
  "type": "core/image",
  "version": 2,
  "attrs": { "mediaId": "…", "alt": "…", "caption": "…", "align": "wide" },
  "children": []
}
```

**Mappestruktur for én blokk**

```
blocks/bildegalleri/
  block.json      påkrevd: navn, attributter, støtte, versjon
  Edit.vue        påkrevd: slik blokken ser ut og redigeres i editoren
  View.vue        påkrevd: slik blokken vises på nettstedet
  migrate.ts      valgfri: oppgraderer lagrede blokker til ny versjon
  render.ts       valgfri: serverside data for dynamiske blokker
```

**`block.json`**

| Felt | Innhold | Tilsvarer i WordPress |
| --- | --- | --- |
| `name` | `navnerom/navn`, f.eks. `core/image`, `minutvidelse/kart` | `name` |
| `title`, `description`, `icon`, `category`, `keywords` | Hvordan blokken vises i blokkinnsetteren | Samme |
| `version` | Heltall som økes ved endring i attributter | `deprecated` (erstattes) |
| `attributes` | JSON Schema for hvert felt, med type, standardverdi og validering | `attributes` |
| `supports` | Felles valg kjernen tegner panel for: justering, farger, typografi, avstand, kantlinjer, anker, egne CSS-klasser | `supports` |
| `parent`, `allowedBlocks` | Hvor blokken kan stå, og hvilke barn den tar | Samme |
| `variations` | Ferdige varianter av samme blokk (f.eks. YouTube og Vimeo som varianter av Innbygging) | Samme |
| `styles` | Navngitte stilvarianter temaet kan style | Block styles |
| `transforms` | Hvilke blokker den kan gjøres om til og fra | Samme |
| `dynamic` | `true` når innholdet hentes ved visning (siste innlegg, meny) | Dynamiske blokker |

**Standard blokksett i kjernen**

- Tekst: avsnitt, overskrift, liste, sitat, kode, tabell, uthevet sitat, detaljer (sammenleggbar)
- Media: bilde, galleri, lyd, video, fil, media og tekst, omslag
- Oppsett: gruppe, kolonner, rad, stabel, rutenett, avstand, skillelinje, knapper
- Innbygging: oEmbed-varianter for de vanligste tjenestene
- Nettsted: tittel, logo, slagord, navigasjon, brødsmuler, søk, innloggings-/utloggingslenke
- Innhold: innleggstittel, innleggsinnhold, utdrag, dato, forfatter, fremhevet bilde, kategorier og stikkord, kommentarer, paginering
- Dynamisk: Query Loop, siste innlegg, arkiver, kategoriliste

**Mønstre og gjenbruk**

- **Mønstre**: ferdige blokkoppsett fra kjernen, temaer og utvidelser, vist i innsetteren med forhåndsvisning
- **Synkroniserte mønstre**: én definisjon brukt mange steder, endring slår inn overalt (WordPress' gjenbrukbare blokker), med mulighet til å overstyre enkeltfelt lokalt
- **Startmønstre**: når man lager en ny side, kan man velge et utgangspunkt

**Query Loop**

Som i WordPress kan redaktøren lage en liste over innhold uten kode: innholdstype, kategori, stikkord, forfatter, sortering, antall, ekskluder festede innlegg, og en mal for hvert element bygget av blokker. Spørringen kjøres i backend med samme rettighetssjekk som API-et.

**Bindinger til felter**

Som WordPress' Block Bindings: et attributt kan kobles til et felt i innholdet (f.eks. et bilde bundet til «Fremhevet bilde» eller en tekst bundet til et egendefinert felt). Det gjør at temaer og mønstre kan bygges med blokker uten å duplisere data.

**Versjonering i stedet for «deprecated»**

I WordPress må en blokk bære med seg alle gamle versjoner av markupen sin, ellers får redaktøren «Denne blokken inneholder uventet innhold». I toascribe økes `version`, og `migrate.ts` oppgraderer gamle blokker en gang for alle, enten når innholdet åpnes eller i en bakgrunnsjobb. Ugyldige blokker vises som en tydelig feilboks i editoren med rådata, aldri som ødelagt side.

**Regler for blokker**

1. Attributter valideres mot skjemaet både i editoren og i backend før lagring.
2. HTML i tekstattributter renses mot en tillatt liste (tilsvarer `kses`).
3. `View.vue` skal rendres på serveren uten JavaScript; interaktivitet legges på etterpå (tilsvarer WordPress' Interactivity API).
4. Blokker fra utvidelser vises med utvidelsens navn i innsetteren og forsvinner ikke stille hvis utvidelsen deaktiveres; de vises som en plassholder.
5. Blokker skal være tilgjengelige: tastaturbruk i editoren og semantisk HTML i visningen.

**Verktøy**: `toa block create <navn>` lager ny blokk i et tema eller en utvidelse, og en blokk-lekeplass i admin viser alle blokker med alle varianter for testing.

**Slik er editoren bygget**

Editoren er et blokktre i en egen Vue-modell, der hver tekstblokk har sin egen TipTap-instans for formatering inne i teksten. Strukturen (kolonner, grupper, omslag) eies av blokktreet, ikke av ProseMirror, og angre/gjenta virker på tvers av blokker. Dette prototypes i fase 0 (kolonner, bilde og avsnitt med angre/gjenta) før fase 1 estimeres.

- Ekstra kjerneblokker: egendefinert HTML, klassisk (renset HTML fra import), «Les mer», sideskift, forhåndsformatert tekst og fotnoter.
- WXR-import gjør Gutenberg-kommentarer om til blokker der typen er kjent, og legger resten i en klassisk blokk.
- Innliming fra Word og Google Docs renses og gjøres om til blokker.
- Rettigheten `unfiltered_html` gis til Administrator og Redaktør som i WordPress; andre får HTML renset.

**Egendefinerte felter (fase 2)**

Dette erstatter det ACF og Meta Box gjør i WordPress.

- Felttyper: tekst, langtekst, rik tekst, tall, ja/nei, valg, dato og tid, lenke, e-post, media, galleri, relasjon (innhold, term eller bruker), gruppe, gjentakende gruppe og fleksibelt innhold (blokker).
- Hvert felt har nøkkel, etikett, påkrevd, standardverdi, validering, oversettbar, rettighet og betinget visning.
- Feltene vises i sidepanelet eller i en egen boks under editoren.
- Felter laget i admin kan eksporteres med `toa config export`, og låses i admin når de finnes i kode.

## Innstillinger, verktøy, utseende og personvern

Hver innstillingsside i WordPress får en tilsvarende side med de samme feltene i samme rekkefølge. Det som er utdatert, faller bort, og det er listet under hver side.

| Side | Felter som beholdes | Faller bort |
| --- | --- | --- |
| Generelt | Nettstedstittel, slagord, nettstedsikon, nettstedsadresse, administrator-e-post (endring bekreftes), medlemskap, standardrolle, språk, tidssone, dato- og tidsformat, uken starter på | Eget felt for «WordPress-adresse» |
| Skriving | Standard innleggskategori, standard editor-oppførsel | Publisering via e-post, ping-tjenester |
| Lesing | Forsiden viser (siste innlegg eller statisk side, pluss innleggsside), innlegg per side, elementer i RSS, fulltekst eller utdrag i RSS, «Be søkemotorer om ikke å indeksere» | – |
| Diskusjon | Tillat kommentarer, krev navn og e-post, krev innlogging, lukk etter N dager, trådede kommentarer (nivåer), paginering, e-postvarsler, manuell godkjenning, moderering på antall lenker og ord, blokkerte ord, avatarer | Pingbacks og trackbacks |
| Media | Størrelser for miniatyr, medium og stor, beskjæring av miniatyr, mapper per år og måned | – |
| Permalenker | Vanlig, dag og navn, måned og navn, numerisk, innleggsnavn, egendefinert med `%year%`, `%monthnum%`, `%postname%` osv., kategori- og stikkordbase | – |
| Personvern | Velg eller opprett personvernside, med veiledning | – |

**Utseende**

- **Temaer**: installerte temaer som kort med skjermbilde, «Aktiver» (starter bakgrunns-build), «Forhåndsvis», temadetaljer
- **Tilpass**: live forhåndsvisning med panel for nettstedsidentitet (logo, ikon), farger og fonter fra temaet, menyer, widgets, startsideinnstillinger og «Ekstra CSS». Alt dette lagres i databasen og krever ikke rebuild
- **Menyer**: dra-og-slipp-bygger med sider, innlegg, kategorier og egne lenker, tilordnet temaets menyplasseringer
- **Widgets**: temaets områder fylt med blokker

**Utvidelser**

- Listen ser ut som i WordPress: navn, beskrivelse, versjon, forfatter, Aktiver/Deaktiver, Slett, automatiske oppdateringer
- Aktivering og deaktivering av en installert utvidelse skjer uten rebuild når den bare har serverdel; har den frontend-del, startes en bakgrunns-build
- «Legg til ny» henter fra en katalog på toascribe.dev og installerer via pakkehåndterer, ikke zip-opplasting

**Verktøy**

- **Importer**: WordPress (WXR) med media, forfattertilordning og omskriving av lenker; RSS-import
- **Eksporter**: alt innhold, eller bare innlegg, sider eller media, med filtre for dato, forfatter og kategori. Eksporterer både WXR (for å kunne flytte tilbake) og JSON
- **Nettstedshelse**: fanene Status (anbefalte forbedringer og kritiske problemer) og Info (versjoner, database, lagring, kø, cache) med «Kopier til utklippstavlen»
- **Eksporter persondata** og **Slett persondata**: GDPR-forespørsler med e-postbekreftelse fra den registrerte, som i WordPress

**Oppdateringer**

- Kontrollpanel → Oppdateringer viser installert og tilgjengelig versjon av kjernen, temaer og utvidelser
- Selve oppdateringen skjer ved å hente ny Docker-image; siden viser kommandoen og endringsloggen; automatiske oppdateringer gjøres av en valgfri oppdateringscontainer eller av verten, aldri av appen selv

## Nettstedet, e-post, sikkerhet og ytelse

Dette er funksjonene som ikke har en egen admin-side, men som WordPress-brukere forventer at bare virker.

**Det besøkende ser (temaet får det gratis fra kjernen)**

- Arkiver for kategori, stikkord, forfatter, år, måned og dag, pluss søkeside og 404
- Passordbeskyttede innlegg med passordskjema, og private innlegg som bare innloggede med rett rolle ser
- Festede innlegg øverst på forsiden
- Utdrag med «Les mer», og innlegg delt over flere sider
- Innbygging ved å lime inn en lenke (oEmbed) for YouTube, Vimeo, Spotify og lignende
- Kommentarskjema og trådede kommentarer
- RSS for hele nettstedet, per kategori, per stikkord og for kommentarer
- Sitemap (`/sitemap.xml`), `robots.txt`, kanoniske lenker, meta-beskrivelse og Open Graph fra kjernen
- Forhåndsvisning av utkast via tidsbegrenset lenke

**E-post**

- All e-post (passord, registrering, kommentarvarsler, GDPR, admin-varsler) går via én e-posttjeneste med SMTP-oppsett i setup-wizarden
- Maler kan overstyres av temaet og oversettes
- «Send test-e-post» i Nettstedshelse

**Sikkerhet**

- Argon2-hashing av passord; import fra WXR beholder WordPress-hasher og oppgraderer dem ved første innlogging
- CSRF-beskyttelse på alle skjemaer (tilsvarer WordPress' nonces)
- Rettighetssjekk på hvert API-endepunkt mot capabilities
- Opplastinger: tillatte filtyper per rolle, SVG renses, filer serveres ikke som kjørbar kode
- Rensing av HTML i blokker og kommentarer (tilsvarer `kses`)
- Begrensning av forespørsler på innlogging, registrering og kommentarer
- Sikkerhetsheadere (CSP, HSTS) med fornuftige standarder
- Revisjonslogg for innlogginger og endringer i innstillinger, roller og utvidelser

I tillegg, etter gjennomgangen:

- All utgående HTTP fra kjernen og utvidelser går via én klient som blokkerer private, link-local og metadata-adresser (vern mot SSRF), også for oEmbed, webhooks, mediehenting ved import og temaer fra git.
- XML tolkes med `defusedxml`, arkiver pakkes ut med kontroll av stier, og bilder har pikselgrense (f.eks. 100 MP) og tidsgrense.
- Import støtter WordPress-hasher av typene `$P$` (phpass) og `$wp$2y$` (bcrypt fra 6.8).
- All e-post sendes via jobbkøen, ikke direkte i forespørselen.
- `SECURITY.md`, `/.well-known/security.txt` og en fast rutine for sikkerhetsutgivelser er på plass før første offentlige versjon.

**Ytelse**

- Offentlige sider rendres på serveren og caches; publisering eller endring tømmer bare de berørte sidene
- Responsive bilder med `srcset`, WebP/AVIF og lat lasting som standard
- Mål: sider uten innlogging svarer på under 100 ms fra cache

**Cache og invalidering**: hver rendret side får cache-tagger (innhold, term, meny, område, globalt sett og liste per innholdstype). Én instans cacher i minnet eller på disk; flere instanser deler cachen i Valkey. Endringer tømmer sider med de berørte taggene, og ukjent avhengighet tømmer alt. Forespørsler med innloggings- eller passordcookie caches aldri, og heller ikke handlekurv, kasse og Min konto. `content_ref` holdes oppdatert ved lagring og brukes til invalidering, ødelagte lenker, «brukes på» i mediebiblioteket og advarsel før sletting.

**Samtykke til informasjonskapsler (fase 2)**: norske nettsteder må ha aktivt samtykke til cookies som ikke er nødvendige. Kjernen har et samtykke-API (som WordPress' Consent API) med kategoriene nødvendig, preferanser, statistikk og markedsføring, et samtykkebanner i kjernens komponenter, og innbygginger fra tredjepart som lastes først etter klikk. Utvidelser oppgir hvilke cookies de setter i `plugin.json`.

**Kvalitet**

- CI med lint, typer, enhetstester (Vitest), ende-til-ende-tester (Playwright) med axe, og oppgraderingstest fra forrige minor- og hovedversjon med testdata
- Kontrakttester per `pluginApi` og `themeApi`, lasttest (k6) før hver hovedversjon og fuzzing av WXR-import
- Ytelsesmål uten cache: API p95 under 150 ms og adminlister p95 under 300 ms ved 50 000 innlegg
- OpenTelemetry-støtte og valgfri Sentry for feilinnsamling
- Universell utforming: WCAG 2.2 AA for admin, editor, standardtema og butikkens kasse. axe stopper bygget ved nye brudd, editoren testes med NVDA og VoiceOver før hver hovedversjon, og kjernen kan lage en tilgjengelighetserklæring
- Flere instanser av appen forutsetter S3-kompatibel medielagring
- Dokumentasjon på toascribe.dev for brukere, temautviklere og plugin-utviklere

## Nytt i WordPress 6.3–7.0

WordPress 7.0 kom 20. mai 2026, så «slik WordPress er i dag» betyr 7.0-linjen. Tabellen tar med det viktigste som har kommet fra 6.3 til 7.0, slik at toascribe ikke føles som en kopi av en eldre versjon; versjonen står der funksjonen kom før 7.0.

| Nytt i 7.0 | toascribe | Fase |
| --- | --- | --- |
| Modernisert admin med nye listevisninger (DataViews) | Listeskjermene bygges moderne fra start, men med den klassiske oppbyggingen beskrevet over | 1 |
| Kommandopalett (Ctrl+K), fra 6.3 | Med fra start | 1 |
| Fontbibliotek | Opplasting og valg av fonter under Utseende → Tilpass | 2 |
| Nye blokker: brødsmuler og ikoner; lysboks for bilder | Del av standard blokksett | 2 |
| Notater på blokker (fra 6.9) og visuelle revisjoner | Notater som intern kommentar per blokk; revisjoner vist side om side | 3 |
| Sanntidssamarbeid i editoren | Kildene er uenige om det er på som standard i 7.0; vi starter med låsing og vurderer sanntid (Yjs) senere | 4 |
| AI-klient og «Connectors»-side under Innstillinger | Innstillinger → AI med valg av leverandør og egne nøkler, brukt av editoren og plugins | 3 |
| Abilities API (fra 6.9) og MCP-adapter | Kjernefunksjoner beskrevet som «abilities» som både plugins og AI-agenter kan kalle, med en innebygd MCP-server | 4 |

Kilder: [Raidboxes om WordPress 7.0](https://raidboxes.io/en/blog/wordpress/wordpress-7-0/), [GreenGeeks om WordPress 7.0](https://www.greengeeks.com/blog/whats-new-in-wordpress-7-0/), [WP Marmite om WordPress 7.0](https://wpmarmite.com/en/wordpress-7-0/), [Excelisys om WordPress 7.0](https://excelisys.com/wordpress-7-0-release-brings-new-features/).

## Gjennomgang mot WordPress: detaljer som lett glipper

Dette er små ting WordPress-brukere tar for gitt, og som ikke står i seksjonene over. Hver har fått en beslutning.

| Detalj i WordPress | Beslutning i toascribe | Fase |
| --- | --- | --- |
| Korte lenker `/?p=123` og «Kopier lenke» i editoren | Støttes, videresender til permalenken | 1 |
| Gammel slug videresendes automatisk etter endring | Lagres i `redirect`-tabellen automatisk | 1 |
| Autosave og «Det finnes et nyere autolagret utkast» | Samme melding med valg om å gjenopprette | 2 |
| Heartbeat (holder økt i live, låser innlegg) | Erstattes av én WebSocket/SSE-kobling i admin | 2 |
| «Planlagt publisering mislyktes» | Styres av databasen: en fast jobb hvert minutt publiserer alt som har forfalt, uten dobbeltkjøring; køen brukes bare for å trigge raskere | 1 |
| Innlegg i papirkurv slettes etter 30 dager | Samme, konfigurerbart | 1 |
| Passordbeskyttet innhold husker passordet i en cookie | Samme, 10 dager | 1 |
| Kommentar-cookie («Lagre navnet mitt … i denne nettleseren») med samtykke | Samme avkrysning, kun med samtykke | 3 |
| Avatarer fra Gravatar, standard-avatar ved mangel | Samme, pluss eget opplastet bilde | 1 |
| `wp_options` med autoload | `setting`-tabellen med `autoload`, cachet | 1 |
| Transients og objektcache | Cache-API i SDK-et (minne eller disk, Valkey ved flere instanser), med utløp og tagger | 1 |
| Rewrite API for egne adresser | Utvidelser og temaer registrerer ruter i manifestet | 3 |
| Admin-AJAX (`admin-ajax.php`) | Utgår; alt går via REST-API-et | – |
| Shortcodes | Utgår for nytt innhold; vises som plassholderblokk ved import | 3 |
| Innleggsformater (aside, galleri, sitat …) | Utgår; dekkes av mønstre | – |
| Vedleggssider for media | Av som standard (som i WordPress 6.4+), kan slås på | 2 |
| Lenkebehandleren (blogroll) | Utgår | – |
| Emoji-skript | Utgår; nettlesere viser emoji selv | – |
| «Hendelser og nyheter»-widget | Erstattes av nyheter fra toascribe.dev, kan skjules | 3 |
| Automatiske sikkerhetsoppdateringer | Patch-versjoner kan oppdateres automatisk; hovedversjoner krever bekreftelse | 2 |
| Oppdateringsvarsel i menyen (tall ved «Oppdateringer») | Samme | 2 |
| Hjelp-fanen og «Skjermalternativer» | Skjermalternativer beholdes; hjelp lenker til dokumentasjonen | 1 |
| `WP_DEBUG` og feillogg | `TOASCRIBE_DEBUG` og strukturert logg, vist i Nettstedshelse | 1 |
| `wp-config.php` | Miljøvariabler og `toascribe.toml`, aldri i webroten | 0 |
| WP-CLI | `toa`-CLI med de samme hovedkommandoene: `user`, `post`, `option`, `plugin`, `theme`, `cache`, `db`, `search-replace`, `cron`, `export`, `import` | 1–3 |
| Søk og erstatt i databasen ved domenebytte | Ikke nødvendig: lenker lagres relativt eller som ID; `toa search-replace` finnes likevel | 2 |
| REST-API med `_embed`, `X-WP-Total`, `X-WP-TotalPages` | Eget API med inkludering av relasjoner og paginering i headere (fase 1); WP-formatet i den innebygde wp/v2-modulen (lesing fase 2, skriving fase 4) | 1 / 4 |
| Privat innhold og «Kun synlig for meg»-utkast i forhåndsvisning | Samme regler | 1 |
| Bidragsyter kan ikke publisere, men «Send til gjennomgang» | Samme knapp for bidragsytere, status «Venter på gjennomgang» | 1 |

Flere detaljer funnet i en uavhengig gjennomgang av planen:

- Sletting av bruker spør hva som skal skje med innholdet: overføres til en annen bruker eller slettes (fase 1).
- Endre rolle for flere brukere samtidig, og «Send tilbakestilling av passord» fra brukerlisten (fase 1).
- Erstatte en mediefil, og lage bildestørrelser på nytt når temaet endrer dem, med `toa media regenerate` og en bakgrunnsjobb (fase 1).
- Kommentaradmin med svar, redigering, Spam-fane og IP og e-post i listen (fase 3).
- Spamvern ved registrering (honningkrukke eller captcha) (fase 1).
- «Mistet passord» svarer likt enten kontoen finnes eller ikke (fase 0).
- Gjenopprettingskoder for tofaktor og «Vis passord» på innlogging (fase 0).
- Største filstørrelse vises i opplastingsdialogen (fase 1).
- Publisert personvernside lenkes automatisk i bunnteksten og i registreringsskjemaet (fase 1).

WordPress-funksjoner som ikke var nevnt før siste gjennomgang, med beslutning:

- **Fase 1:** språk per bruker i admin; listevisning, dokumentoversikt, ordtelling og lesetid i editoren; distraksjonsfri modus og tastatursnarveier; kopier og lim inn stiler mellom blokker; egen mal per innlegg, ikke bare per side; teller for tegn i utdrag og noindex per side i SEO-panelet; skalering av store bilder (2560 px), EXIF-rotasjon og HEIC-konvertering ved opplasting; Atom-feed og RSS per forfatter.
- **Fase 2:** kodeeditor-modus («Rediger som HTML» for hele innlegget); blokklåsing og «bare innhold»-redigering; globale stiler med stilvarianter og revisjoner av stiler; miniatyrbilde for PDF; spillelister for lyd og video; nettstedet som oEmbed-leverandør for egne innlegg; forhåndslasting av lenker (speculative loading, som i 6.8); innstillingen «forfatteren må ha en godkjent kommentar fra før» og avatarvurdering (sammen med kommentarene i fase 3).
- **Fase 3:** Block Hooks (utvidelser setter inn blokker automatisk); utvidelser kan registrere egne eksportører og slettere for persondata; mønster- og blokkatalog fra toascribe.dev i innsetteren.
- **Fase 4:** malbiter for header og footer redigert i admin, og Zoom out, sammen med full site editing.
- **Utgår:** fileditoren for temaer og utvidelser i admin, fordi kode endres i repoet og bygges.
- **Sjekkes mot WordPress' egne kilder før fase 2:** om blokkene Accordion, Math og Terms Query kom i 6.9.

## WordPress-svakheter vi designer bort

Dette er de vanligste klagene på WordPress, og hvordan arkitekturen gjør at de ikke oppstår. Ingen av dem endrer hvordan admin føles for brukeren.

| Svakhet i WordPress | Løsning i toascribe |
| --- | --- |
| Ingen ekte staging; innstillinger og struktur ligger bare i databasen | Prosjektkonfig: innholdstyper, felter, taxonomies, menyplasseringer og innstillinger kan eksporteres til YAML i git og importeres i et annet miljø (`toa config export/import`) |
| Utvidelser krasjer hverandre eller nettstedet | Typede hooks med prioritet, rettigheter i manifest, feilisolering og gjenopprettingsmodus |
| Admin full av reklame og varsler fra utvidelser | Regel i katalogen: varsler må kunne avvises, ingen reklame i admin; admin kan skjule alle varsler fra én utvidelse |
| Sikkerhetshull fra utdaterte utvidelser | Erklærte rettigheter, manuell gjennomgang i katalogen, avhengighetsskanning, signerte pakker, varsel om sårbare versjoner |
| Treg backend med mange `postmeta`-spørringer | Typede kolonner og JSONB med indekser |
| Tregt nettsted uten cache-utvidelse | Cache innebygd og invaliderer seg selv |
| Mediebiblioteket blir rotete | Mapper og stikkord for media, duplikatdeteksjon ved opplasting |
| «Denne blokken inneholder uventet innhold» | Blokker lagres som data med versjoner og migreringer |
| Dårlig innebygd søk | PostgreSQL full-text med vekting og norsk ordstamme |
| Ingen webhooks i kjernen | Webhooks innebygd (se neste seksjon) |
| Ingen redaksjonell flyt utover «Venter på gjennomgang» | Valgfrie arbeidsflyter med steg (se neste seksjon) |
| Oppdateringer kan knekke nettstedet | Sikkerhetskopi rett før oppdatering, migrasjoner som bare legger til, og gjenoppretting av kopien hvis helsesjekken feiler |
| Domenebytte krever søk og erstatt i databasen | Interne lenker lagres som referanser, ikke absolutte URL-er |
| Ingen tofaktor i kjernen | Tofaktor og passkeys innebygd, valgfritt per bruker eller påkrevd per rolle |

## Gode ideer fra andre CMS

Flere moderne CMS-er har løst ting WordPress aldri har fått i kjernen. Disse tas med, men alltid i WordPress-drakt: de legger seg inn i den kjente menyen og er av eller usynlige til de trengs.

| Idé | Hentet fra | Slik gjør vi det | Fase |
| --- | --- | --- | --- |
| Live forhåndsvisning side om side mens man skriver | Payload, Craft | Delt visning i editoren: blokker til venstre, ekte tema til høyre, oppdatert ved hver endring | 2 |
| Utkast og versjoner som egen arbeidskopi | Payload | Et publisert innlegg kan ha et ventende utkast som ikke påvirker den publiserte versjonen før det publiseres | 2 |
| Innholdsmodell og innstillinger i git | Craft (project config), Drupal | `toa config export/import` med YAML, se forrige seksjon | 2 |
| «Globale» innholdssett | Craft, Payload | Redigerbare sett for f.eks. kontaktinfo, bunntekst og sosiale lenker under Utseende, tilgjengelig i alle maler | 1 |
| Tilgangskontroll per felt | Payload, Directus | Felt i en innholdstype kan kreve en egen rettighet for å se eller endre | 3 |
| Fokuspunkt for bilder | Wagtail | Automatisk forslag og manuelt valg i mediebiblioteket; alle beskjæringer respekterer det | 2 |
| Tilgjengelighetssjekk i editoren | Wagtail | Varsler om tomme overskrifter, feil overskriftsrekkefølge, manglende eller dårlig alt-tekst (f.eks. filnavn) før publisering | 2 |
| Redaksjonelle arbeidsflyter med steg | Wagtail, Strapi | Valgfri flyt per innholdstype (f.eks. Utkast → Korrektur → Godkjent → Publisert) med tildeling og varsler | 3 |
| Sidetre | Wagtail | Sider kan vises som tre med dra-og-slipp i tillegg til den vanlige listen | 2 |
| Rapporter | Wagtail | Gamle sider som ikke er oppdatert, sider uten metabeskrivelse, ødelagte lenker, oppgaver i arbeidsflyt | 3 |
| Planlagt avpublisering | Wagtail | «Avpubliser» med dato i sidepanelet, ved siden av publiseringsdato | 1 |
| Utgivelser: samle endringer og publisere samtidig | Sanity, Craft | Flere innlegg, sider og menyendringer samles i en utgivelse som publiseres på ett tidspunkt | 4 |
| Flere forfattere per innlegg | Craft | Forfatterfeltet tar én eller flere brukere | 1 |
| Webhooks | Directus, Strapi, Ghost | Innstillinger → Webhooks: send hendelser (publisert, oppdatert, slettet, ny kommentar) til valgfri URL, med signatur og logg. Passer direkte med n8n | 2 |
| Skjemabygger | Craft, Payload | Første-parts utvidelse for kontaktskjemaer med spamvern, e-postvarsel og innsendinger i admin | 3 |
| Omdirigeringer i admin | Payload, Wagtail, Craft | Verktøy → Omdirigeringer med import fra CSV og 404-logg med «lag omdirigering» | 2 |
| SEO-panel med forhåndsvisning | Payload SEO, kjente WP-utvidelser | Felt for SEO-tittel, beskrivelse og delingsbilde, med forhåndsvisning av søkeresultat og deling | 1 |
| Medlemskap og nyhetsbrev | Ghost | Første-parts utvidelse: medlemmer, betalt innhold, send innlegg som nyhetsbrev | 4 |
| Personvernvennlig statistikk | Ghost | Første-parts utvidelse uten cookies, med enkle tall i kontrollpanelet | 4 |
| GraphQL | Payload, Craft, Directus | Utvidelse ved behov; REST er hovedgrensesnittet | 4 |
| Flerspråklig innhold per felt | Payload, Craft | Språkversjoner av samme innhold, felt kan markeres som oversettbare | 4 |

**Konsekvenser for datamodellen nå**

Noen av disse kommer sent, men må ha plass i datamodellen fra fase 0, ellers blir de dyre å legge til senere:

- `content.locale` og `content.translation_group` for flerspråklig innhold
- `content_author` som koblingstabell i stedet for ett `author_id`
- `content.unpublish_at` ved siden av `published_at`
- `content.workflow_state` for arbeidsflyter
- `media.focal_point` og `media.folder_id`
- `release_id` på utkast for samlede utgivelser

Kilder: [Wagtail funksjonsoversikt](https://wagtail.org/feature-index), [Wagtail om tilgjengelighet](https://wagtail.org/accessibility/), [Craft CMS funksjoner](https://craftcms.com/features), [Craft CMS veikart](https://craftcms.com/roadmap), [Payload CMS-oversikt](https://focusreactive.com/payload-cms-overview/).

## E-handel: toascribe Butikk

E-handel bygges som en første-parts utvidelse, «toascribe Butikk», på samme måte som WooCommerce er en utvidelse til WordPress. Den bruker utvidelsesspesifikasjonen over, legger seg inn i admin-menyen som «Butikk» og «Produkter», og føles som WooCommerce for den som kjenner det. Arbeidet starter først når utvidelsessystemet er på plass (etter port 4). Alt er av til brukeren selv slår det på: Butikk aktiveres under Utvidelser, og først da dukker innstillingene for butikken opp. Kobling til regnskapsprogram er et eget valg under Butikk → Innstillinger → Regnskap, og ingen del av butikken krever at et regnskapsprogram er koblet til.

**Arkitekturvalg**

| Alternativ | Fordeler | Ulemper |
| --- | --- | --- |
| Egen utvidelse i toascribe (anbefalt) | Samme admin, samme brukere, produkter er vanlig innhold med blokker og SEO, én database, WooCommerce-følelse | Mest arbeid; betaling, MVA og frakt må bygges selv |
| Koble på Saleor (Python/Django, GraphQL) | Moden handelsmotor, multikanal og flere lagre fra start | Eget admin-panel og egne brukere, en Python/Django-tjeneste ved siden av Node-API-et, føles ikke som WordPress |
| Koble på Medusa eller Vendure (Node/TypeScript) | Modulære, gode API-er | Enda en runtime å drifte, eget admin, samme problem med følelsen |

Anbefalingen er egen utvidelse, men med ideer lånt fra de andre: Medusas uavhengige moduler (produkter, handlekurv, ordre, lager, priser) og Saleors kanaler og flere lagre som en senere utvidelse av datamodellen.

**Admin-menyen (som WooCommerce)**

| Meny | Undersider |
| --- | --- |
| Butikk | Hjem, Ordrer, Kunder, Rapporter, Innstillinger, Status |
| Produkter | Alle produkter, Legg til nytt, Kategorier, Stikkord, Merker, Egenskaper |
| Markedsføring | Kuponger |

**Funksjoner**

| Område | Som i WooCommerce | Fase |
| --- | --- | --- |
| Produkttyper | Enkelt, variabelt (egenskaper og varianter) og digitalt i B1; eksternt og gruppert i B2 | B1 / B2 |
| Produktdata | Kort og lang beskrivelse (blokker), bildegalleri, SKU, GTIN/EAN, merke, vekt og mål, salgspris med planlagt periode | B1 |
| Lager | Antall per variant, varsel ved lav beholdning, restordre av/på, lager reserveres i kassen i et begrenset tidsrom | B1 |
| Handlekurv og kasse | Kasse bygget av blokker, gjestekjøp, valgfri kontoopprettelse, postnummer fyller ut sted, ekstra felter fra utvidelser | B1 |
| Min konto | Ordrer, nedlastinger, adresser, kontodetaljer, angre kjøp | B1 |
| Ordrer | Statuser (se diagram), ordrenotater (private og til kunde), manuell ordre i admin, full og delvis refusjon | B1 |
| E-post | Ny ordre (til butikk), ordrebekreftelse, sendt/fullført, refundert, notat til kunde, kvittering | B1 |
| MVA | Priser oppgis inkl. MVA, MVA-klasser (25 %, 15 %, 12 %, 0 %), MVA-spesifikasjon på kvittering | B1 |
| Frakt | Fraktsoner, faste priser, gratis frakt over beløp, hent selv, fraktklasser | B1 |
| Fraktfirma | Bring/Posten, PostNord og Helthjem med pris, hentested-valg, etiketter og sporing | B2 |
| Betaling | Vipps MobilePay (ePayment og Express), Stripe (kort, Apple Pay, Google Pay) | B1 |
| Flere betalingsløsninger | Klarna, Nexi/Nets, faktura via Klarna eller Two | B2 |
| Kuponger | Prosent eller fast beløp, gratis frakt, minstebeløp, begrensning per kunde og produkt, utløpsdato | B2 |
| Rapporter | Salg, ordrer, produkter, kategorier, kuponger, lager, MVA per periode | B2 |
| Regnskap | Valgfritt og av som standard. Fiken først, deretter Tripletex; generell CSV-eksport og webhooks for alle andre systemer | B2 |
| Produktfeeds | Google Merchant og Prisjakt | B3 |
| Abonnement | Gjentakende betaling med Vipps MobilePay og Stripe | B3 |
| B2B | Kundegrupper med egne priser, priser eks. MVA, faktura og EHF | B3 |
| Flere lagre, kanaler og valutaer | Som Saleor | B3 |

Lagt til etter gjennomgangen:

- **Import og eksport (B1)**: CSV for produkter, og import av produkter, varianter, kunder og ordrer fra WooCommerce. Dette er den viktigste døren inn for butikker som vil bytte.
- **Vektbasert frakt (B1)**: fraktpris etter vekt og mål, siden Bring-priser følger vekt.
- **Omtaler (B2)** med «verifisert kjøper» og moderering, **mersalg og krysssalg (B2)**, og **filterblokker (B2)** for egenskaper, pris og lager.
- **Gavekort (B3)** med riktig MVA-behandling.
- **WooCommerce REST-kompatibilitet (B3)**: avgrenset adapter for produkter, varianter, lager og ordrer, fordi mange norske lager- og kassesystemer snakker WooCommerce-API-et.
- Nedlastbare filer ligger i privat lager og leveres via tidsbegrensede, signerte lenker.
- Lager trekkes med låsing i samme databasetransaksjon som ordren opprettes, så det ikke blir oversalg.

Flere WooCommerce-funksjoner tatt med etter siste gjennomgang:

- **B1:** butikkens egne sider (butikk, handlekurv, kasse, Min konto og vilkår), valutaformat og salgsland, enheter for vekt og mål, bankoverføring og manuell betaling, «Betal for ordre»-lenke for manuelle ordrer, send ordre-e-post på nytt, e-postmaler med egen redigeringsskjerm, katalogsynlighet, fremhevet produkt, «selges enkeltvis», kjøpsnotat, skjul utsolgte, grenser for nedlastinger (antall og utløp), minihandlekurv og produktsamlingsblokk, kopier produkt og masseredigering, vern mot kortprøving og begrensning av forespørsler i kassen, oppbevaringsregler for inaktive kontoer og kansellerte ordrer, og logg og planlagte jobber under Butikk → Status.
- **B2:** etterkrav via fraktfirma, lagrede betalingsmåter, ordreattribusjon (hvor kunden kom fra) og «Kommer snart»-modus.
- **B3:** API-nøkler (consumer key og secret) for den WooCommerce-kompatible adapteren.

De norske ordene følger den norske WooCommerce-oversettelsen, slik at butikkeiere kjenner seg igjen.

**Ordreflyt**

&#91;embedded content: ordreflyt · sju statuser som i WooCommerce\]

I Norge er det vanlig at beløpet bare reserveres ved kjøp og trekkes når varen sendes; betalingsutvidelser må derfor støtte reservasjon og trekk som to steg. Vipps MobilePay krever i tillegg at ordrelinjer sendes med betalingsforespørselen fra norske butikker ([Vipps MobilePay ePayment-vilkår](https://developer.vippsmobilepay.com/docs/APIs/epayment-api/terms)).

**Norske og europeiske krav**

Dette er ikke juridisk råd, men krav som må være dekket i standardoppsettet slik at en ny butikk er lovlig fra første dag:

- **Angrerett**: 14 dagers angrerett ved netthandel, med standard angreskjema sendt i ordrebekreftelsen og tilgjengelig i Min konto.
- **Angreknapp**: EU-direktiv 2023/2673 krever fra 19. juni 2026 en tydelig angrefunksjon i nettbutikken, i to steg med kvittering på e-post ([Stripe om angreknappen](https://stripe.com/se/resources/more/withdrawal-button-2026-germany)). I Norge er kravet vedtatt som ny § 20 a i angrerettloven ved lov 19. juni 2026 nr. 34, men ikrafttredelsen er ikke fastsatt ennå ([Lovdata](https://lovdata.no/dokument/NL/lov/2014-06-20-27)). Funksjonen er derfor med i B1.
- **Opplysningsplikt**: totalpris inkl. MVA og frakt, leveringstid, kontaktinformasjon og organisasjonsnummer vises før kjøp; Forbrukerrådet har funnet at mange norske nettbutikker bryter disse kravene ([Smarte Penger](https://www.smartepenger.no/94-nyhet/1406-nettbutikker-bryter-loven)).
- **Bestillingsknappen** må tydelig vise at bestillingen innebærer betalingsplikt.
- **Salgsbetingelser**: Forbrukertilsynets standard salgsbetingelser for forbrukerkjøp på nett tilbys som ferdig side ved oppsett ([eksempel fra Nasjonalbiblioteket](https://www.nb.no/nettbutikk/?p=13656)).
- **Reklamasjon**: reklamasjonsfrist på to eller fem år etter vare står i betingelsene og i Min konto.
- **Bokføring**: ordrer, kvitteringer og refusjoner kan ikke slettes, bare krediteres, og eksporteres for regnskapet.
- **Personvern**: ordredata inngår i «Eksporter persondata»; ved «Slett persondata» anonymiseres ordrer i stedet for å slettes, fordi de må oppbevares for regnskapet.

Regnskap og MVA, presisert etter gjennomgangen:

- Kvitteringer og fakturaer har egen fortløpende nummerserie uten hull (ikke ordrenummeret), og refusjon gir kreditnota.
- MVA på frakt fordeles etter varelinjenes satser når en ordre har flere satser.
- Fritatt (0 %) og unntatt holdes adskilt i MVA-klasser og rapporter; levering til Svalbard eller utlandet gir 0 %.
- Prishistorikk lagres i `shop_price_history`, slik at førpris ved salg kan vises og dokumenteres.
- Digitale produkter krever avkrysning for samtykke til levering i angrefristen og bekreftelse på at angreretten da faller bort.
- Kravene til salgsdokumenter og oppbevaring etter bokføringsregelverket kontrolleres av regnskapskyndig før B1.

**Datamodell**

- Produkter er innholdstypen `product` i kjernens `content`-tabell, så de får blokker, SEO, taxonomies, revisjoner og søk. Handelsdata ligger i egne tabeller koblet på `content_id`.
- Ordrer lagres i egne tabeller fra start, ikke som innhold. WooCommerce brukte mange år på å flytte ordrer ut av innleggstabellene (HPOS); det gjør vi riktig første gang.
- Pengebeløp lagres som heltall i minste enhet (øre) med valutakode, aldri som desimaltall.
- Ordrelinjer lagrer produktnavn, pris og MVA slik de var ved kjøpet, så senere endringer i produktet ikke endrer gamle ordrer.
- **Tabeller i B1:** `shop_product` (content\_id, produkttype, sku, gtin, merke, vekt, mål, MVA-klasse, fraktklasse, katalogsynlighet, selges enkeltvis, kjøpsnotat), `shop_variant`, `shop_attribute`, `shop_attribute_value`, `shop_price`, `shop_price_history`, `shop_stock`, `shop_stock_reservation` (variant, handlekurv, antall, utløper), `shop_cart`, `shop_cart_line`, `shop_order`, `shop_order_line`, `shop_order_note`, `shop_payment`, `shop_payment_event`, `shop_payment_token` (lagrede betalingsmåter), `shop_refund`, `shop_document` (kvittering, faktura eller kreditnota med nummer og PDF), `shop_number_series` (låst teller uten hull), `shop_shipping_zone`, `shop_shipping_method`, `shop_shipping_class`, `shop_shipping_rate` (vekt- og målintervaller), `shop_tax_class`, `shop_tax_rate`, `shop_address`, `shop_download`, `shop_download_grant` (ordre, fil, antall, utløp), `shop_withdrawal` (angresak med linjer, mottatt og kvittering sendt).
- **Tabeller i B2 og B3:** `shop_shipment`, `shop_coupon`, `shop_coupon_usage`, `shop_accounting_sync` (adapter, objekt, status, ekstern ID), `shop_product_link` (mersalg og krysssalg), omtaler som `comment.type = review`, `shop_subscription`, `shop_customer_group`, `shop_gift_card`, `shop_warehouse`, `shop_channel`.

Betalingsstatus føres for seg på `shop_payment` (autorisert, delvis trukket, trukket, delvis refundert, refundert, kansellert, utløpt), mens ordrestatus følger WooCommerce så butikkeiere kjenner seg igjen. «Fullført» krever at alt er trukket, og en jobb varsler før reservasjoner utløper. Varsler fra Vipps MobilePay og Stripe lagres rått i `shop_payment_event` med leverandørens unike ID og behandles uten dobbeltkjøring i jobbkøen. Ordrer har et lesbart, fortløpende `order_number` i tillegg til UUID.

**Integrasjonslag**

Alle koblinger til andre systemer går gjennom ett felles lag, så hver ny integrasjon er en liten adapter og ikke en ny løsning:

- **Hendelser og webhooks**: ordre opprettet, betalt, sendt, refundert og lager endret.
- **Eget API** under `/api/v1/shop/` for produkter, varianter, lager, ordrer og kunder.
- **CSV-eksport** av ordrer, refusjoner og MVA per periode, for systemer uten adapter.

| Adapter | Hva den gjør | Fase |
| --- | --- | --- |
| Fiken | Ordrer, refusjoner og MVA som bilag; av som standard | B2 |
| Tripletex | Samme som Fiken; av som standard | B2 |
| WooCommerce-kompatibelt API | Avgrenset til produkter, varianter, lager og ordrer, som er det norske lager-, kasse- og ERP-systemer bruker | B3 |

**Kontrakter for betaling og regnskap**

- **Betalingsgrensesnitt** (`PaymentProvider`): `create(order)` gir videresending eller økt, `authorize`, `capture(beløp)`, `refund(beløp)`, `cancel`, `handle_event(rådata)` som gir en `PaymentEvent`, og `supports` med to-stegs betaling, express og gjentakende betaling. Butikk-kjernen eier idempotensnøkkel per kall, tilstandsmaskinen på `shop_payment` og nye forsøk via jobbkøen.
- **Regnskapsadapter** (`AccountingAdapter`): `export_document(shop_document)`, `export_refund` og `sync_status`. Hver kjøring logges i `shop_accounting_sync`.

**Svakheter i WooCommerce vi unngår**

- To kasser (klassisk og blokkbasert) med ulik støtte i utvidelser: vi har bare én, bygget av blokker.
- Ordrer som innlegg: egne tabeller fra start.
- Betalingsutvidelser som må håndtere alt selv: kjernen i Butikk eier reservasjon, trekk, refusjon og idempotens; en betalingsutvidelse implementerer bare et lite grensesnitt.
- Viktige funksjoner bak betalte tillegg: abonnement, lager og norsk frakt er første-parts.

**Faser for Butikk**

- **B1**: alt som trengs for en lovlig norsk nettbutikk med Vipps MobilePay og Stripe, faste fraktpriser og MVA.
- **B2**: fraktfirma, flere betalingsløsninger, kuponger, rapporter og regnskap.
- **B3**: abonnement, B2B, produktfeeds og flere lagre, kanaler og valutaer.

**Sjekkliste før B1 lanseres**

- [ ] Jurist: angrerett og angreskjema, angreknappen (sjekk om § 20 a er satt i kraft), opplysningsplikt, merking av bestillingsknappen og salgsbetingelsene
- [ ] Regnskapsfører: nummerserie for fakturaer, kreditnota, MVA-klasser og MVA på frakt, oppbevaring etter bokføringsregelverket, og bilagene Fiken-koblingen lager
- [ ] Betaling testet mot testmiljøene til Vipps MobilePay og Stripe, inkludert doble og forsinkede varsler
- [ ] Personvernerklæringen oppdatert med butikkens behandling av kundedata

## Installasjon og drift

Brukeren laster ned `compose.yaml` og `.env.example`, kjører `docker compose up` og fullfører resten i nettleseren på `/setup`. For utvikling klones repoet. Setup låses med et flagg i databasen når den er ferdig, i stedet for å slette filer, slik at den ikke dukker opp igjen etter en oppdatering.

**Setup-wizarden**

1. Ved første oppstart genereres hemmeligheter til volumet `secrets/` og et engangstoken som skrives til containerloggen; `/setup` krever tokenet.
2. Tilkoblingen til databasen i `DATABASE_URL` testes. Standardoppsettet har PostgreSQL med.
3. Migrasjoner kjøres med drizzle-kit som eier-rollen, før API-et starter.
4. Nettstedsnavn, språk, tidssone og admin-sti (`/admin` som standard), med valg om å legge admin på eget domene.
5. E-post: SMTP-vert, port, kryptering, brukernavn og passord (lagres kryptert) og avsenderadresse. «Send test-e-post» må lykkes, eller hoppes over med varsel i kontrollpanelet.
6. Første administrator opprettes, og wizarden viser en gjenopprettingsnøkkel som krypterer sikkerhetskopier og `toa secrets export`. Den må bekreftes lagret før man går videre.
7. Standardinnhold lages som i WordPress («Hei verden!», en eksempelside og et utkast til personvernside), og `installed`-flagget settes. Før det sender middleware alle til `/setup`; etterpå gir `/setup` 404.

En ekstern database settes med `DATABASE_URL` i `.env` før første oppstart; wizarden tester tilkoblingen, men velger den ikke. Innlogging bruker økter i databasen, og signerte tokens brukes bare til forhåndsvisningslenker, tilbakestilling av passord og e-postbekreftelse. Krypteres i databasen: TOTP-hemmeligheter, SMTP-passord, AI-nøkler, webhook-hemmeligheter og nøkler til regnskap og betaling. `toa core install` gjør det samme som wizarden uten nettleser.

**Drift**

- En ekstern Traefik eller nginx trenger bare å sende all trafikk til toascribes egen proxy-container, som ruter videre etter sti.
- Oppdatering = `docker compose pull && docker compose up -d`; migrasjonene (drizzle-kit, som eier-rollen) kjøres automatisk i et eget steg før API-et starter, med lås, så to containere ikke migrerer samtidig.
- Sikkerhetskopi: `pg_dump` + media-volumet, med en ferdig backup-kommando i CLI-en.
- En `toa` CLI for vedlikehold: lage bruker, nullstille passord, tømme cache, kjøre import (se CLI-tabellen under).
- Healthcheck-endepunkt for Docker og Traefik, og vedlikeholdsmodus («Kort utilgjengelig for planlagt vedlikehold») mens migrasjoner kjører.

**`toa`-CLI**

CLI-en kjører i api-containeren: `docker compose exec api toa …`. Alle kommandoer i dokumentet er samlet her.

| Kommando | Tilsvarer i WP-CLI | Fase |
| --- | --- | --- |
| `toa core install --url --title --admin-email --admin-user` | `wp core install` | 0 |
| `toa user`, `toa role`, `toa cap` | samme | 0 |
| `toa dev seed` (tom, blogg, stor, butikk) | finnes ikke | 0 |
| `toa core version`, `toa core check-update` | `wp core version`, `wp core check-update` | 1 |
| `toa post`, `toa term`, `toa menu`, `toa option` | samme | 1 |
| `toa cache flush`, `toa maintenance-mode on/off` | samme | 1 |
| `toa media regenerate` | samme | 1 |
| `toa backup create/list/restore`, `toa secrets export` | finnes ikke | 1 |
| `toa jobs list/run` | `wp cron` | 1 |
| `toa shell` | `wp shell` | 1 |
| `toa db export/import`, `toa search-replace` | samme | 2 |
| `toa import`, `toa export` (WXR og JSON) | samme | 2 |
| `toa config export/import`, `toa site clone` | finnes ikke | 2 |
| `toa comment` | samme | 3 |
| `toa theme …` (inkludert `toa theme build`), `toa plugin …`, `toa block create` | `wp theme`, `wp plugin`, `wp scaffold` | 3 |

Appen oppdaterer aldri seg selv; derfor finnes `toa core check-update`, men ikke `toa core update`.

## Sikkerhetskopi, gjenoppretting og flytting

WordPress har ingen sikkerhetskopi i kjernen, og de fleste bruker en utvidelse for det. I toascribe er det innebygd under Verktøy → Sikkerhetskopi, fordi et nettsted uten fungerende kopi er den største risikoen en selvhoster har. Kommandoene og en daglig kopi til lokalt volum kommer i fase 1; admin-skjermen, S3 og SFTP og verifisering kommer i fase 2. Når API-et starter med en ny versjon som endrer skjemaet, tas det en kopi før migrasjonene kjøres.

- **Innhold i en kopi**: databasedump, mediefiler, installerte temaer og utvidelser (som liste med versjoner), innstillinger og prosjektkonfig. Hemmeligheter tas ikke med.
- **Planlagt kopi**: daglig som standard, med antall kopier som beholdes (f.eks. 7 daglige og 4 ukentlige).
- **Lagring**: lokalt volum, S3-kompatibel lagring eller SFTP; krypteres med en nøkkel brukeren får ved oppsett.
- **Manuell kopi**: «Ta sikkerhetskopi nå» før oppdateringer, og automatisk før hver oppdatering av kjernen.
- **Gjenoppretting**: velg en kopi i admin, eller `toa backup restore` når admin ikke virker. Nettstedet går i vedlikeholdsmodus mens det pågår.
- **Test av kopier**: en ukentlig jobb gjenoppretter siste kopi i en midlertidig database og varsler hvis det feiler; resultatet vises i Nettstedshelse.
- **Flytte nettsted**: en kopi kan gjenopprettes på en ny server; fordi interne lenker er referanser, trengs ikke søk og erstatt ved domenebytte. Flytting krever «toa secrets export» fra den gamle serveren eller gjenopprettingsnøkkelen.
- **Kloning til staging**: `toa site clone` lager en kopi for testing, med e-postutsending og betalinger slått av.

## toascribe.dev

toascribe.dev er prosjektets hjem, slik wordpress.org er for WordPress. Det er ikke en vertstjeneste; nettstedet selv kjører på toascribe.

| Del | Innhold | Når |
| --- | --- | --- |
| Forside og nedlasting | Hva toascribe er, `git clone`-kommandoen, krav, siste versjon og endringslogg | Fase 1 |
| Dokumentasjon for brukere | Kom i gang, admin side for side, skrive og publisere, temaer og utvidelser, sikkerhetskopi | Fase 1 |
| Dokumentasjon for utviklere | Tema-, blokk- og utvidelsesspesifikasjon, hook-oversikt, API-referanse fra OpenAPI, CLI | Fase 2 |
| JSON Schema | `theme.json`, `plugin.json` og `block.json` publisert med versjon, så editorer validerer mens man skriver | Fase 2 |
| Demo | En offentlig demo som nullstilles hver time, med innlogging som redaktør | Fase 2 |
| Katalog | Temaer og utvidelser med søk, skjermbilder, versjoner, kompatibilitet og antall installasjoner | Fase 3 |
| Nyheter | Utgivelser og sikkerhetsvarsler, også vist i kontrollpanelet | Fase 2 |

**Gjennomgang før publisering i katalogen**

1. Utvikleren laster opp via `toa theme package` eller `toa plugin package`, og er logget inn med en verifisert konto.
2. Automatiske sjekker: samme validering som installasjonen, skanning av avhengigheter for kjente sårbarheter, lisens, at tester kjører, størrelse.
3. For utvidelser: manuell gjennomgang før første publisering, med fokus på `permissions`, nettverkskall og datahåndtering. Temaer gjennomgås manuelt bare ved avvik i de automatiske sjekkene, siden de ikke kjører serverkode.
4. Godkjente pakker signeres; appen sjekker signaturen ved installasjon og oppdatering.
5. Oppdateringer går gjennom de automatiske sjekkene; endrede `permissions` utløser ny manuell gjennomgang og må godkjennes av administrator på nettstedet før oppdateringen tas i bruk.
6. Pakker med kjente sårbarheter merkes, og nettsteder som har dem installert får varsel i kontrollpanelet.

**Retningslinjer for katalogen**: ingen reklame eller oppsalg i admin utover én lenke på utvidelsessiden, ingen sporing uten samtykke, varsler må kunne avvises, og lisensen må tillate bruk og endring.

## Faseplan

Fase 1 er det viktigste målet: når den er ferdig, kan systemet drive en vanlig blogg eller firmaside. Hver fase avsluttes med en port som må være oppfylt før neste starter.

&#91;embedded content: faseplan · fem faser, fire porter\]

Varighetene er grove anslag for én utvikler og bør justeres etter fase 0, når tempoet er kjent. Editoren i fase 1 er den mest usikre delen.

| Fase | Innhold | Port etter fasen |
| --- | --- | --- |
| 0 Fundament | Repo og CI, compose med proxy, hele datamodellen, innlogging, økter, roller, tofaktor, jobbkø og e-post, setup og `toa core install`, admin-skall, testdata, prototype av editoren | P1: ren installasjon fra nedlasting til innlogget admin; alle fase 0-funksjoner ferdige; editor-prototypen viser kolonner, bilde og avsnitt med angre og gjenta |
| 1 Blogg-MVP | Innlegg, sider, taxonomies, blokkeditor med grunnblokkene, media, menyer, admin som wp-admin, ett tema valgt i `toascribe.toml`, permalenker, RSS, sitemap, SEO, cache, Nettstedshelse Info, sikkerhetskopi via CLI | P2: alle fase 1-funksjoner ferdige; din egen blogg i drift i 14 dager med daglig sikkerhetskopi |
| 2 Redaksjon | Egne innholdstyper og felter, revisjoner og autosave, live forhåndsvisning, søk, WXR-import med kommentarer og shortcodes, mønstre, sikkerhetskopi i admin, webhooks, prosjektkonfig, omdirigeringer, samtykke, persondata, passkeys og OIDC, `/wp-json/wp/v2` for lesing | P3: WordPress' Theme Unit Test-data og en ekte eksport importert uten tapte innlegg, termer, kommentarer eller media |
| 3 Utvidbarhet | Utvidelser, byggetjeneste og bytte av tema fra admin, katalog, kommentarer, områder, arbeidsflyter, Nettstedshelse Status | P4: første utvidelse laget utenfor kjernen er installert og oppdatert via katalogen |
| 4 Kompatibilitet | Skriving i `/wp-json/wp/v2`, full site editing, flerspråklig innhold, utgivelser, medlemskap | Løpende |
| Butikk B1–B3 | Starter når P4 er nådd, parallelt med fase 4 | B1 lanseres når sjekklisten i butikkdelen er krysset av |

Regel: en funksjon kan ikke ha lavere fase enn noe den avhenger av. Fase 1 har derfor ett tema valgt i konfigurasjonen, og menyer for funksjoner som ikke er bygget, vises ikke.

**Funksjonsregisteret er fasit.** Fanen «Funksjonsregister» har én rad per funksjon med ID, område, fase, tabell, API-område og admin-skjerm. Står en fase et annet sted i dokumentet og den er ulik, gjelder registeret, og endringer gjøres der først.

**Definisjon av ferdig (gjelder hver funksjon)**

1. Har ID i funksjonsregisteret og en fase, og avhenger ikke av noe i en senere fase.
2. Tabeller og felter står i datamodellen og har en generert og gjennomlest Drizzle-migrasjon.
3. Endepunktet står i API-endepunktkartet med rettighet og Zod-skjema i packages/shared; ruten er skrevet med @hono/zod-openapi, så OpenAPI-dokumentet er oppdatert.
4. Admin-skjermen finnes i menytabellen, med norske ord fra WordPress-oversettelsen.
5. Tester: Vitest for tjenestelaget mot ekte PostgreSQL og en rettighetsmatrise (alle roller mot endepunktet), Vitest for komponenter, minst én Playwright-flyt for hovedscenariet, og ingen nye axe-brudd.
6. Sikkerhet: CSRF, begrensning av forespørsler og rensing av input der det er relevant; ingen hemmeligheter i logg.
7. Ytelse innen budsjett: API p95 under 150 ms med testdataene «stor».
8. Brukerdokumentasjon og endringslogg er oppdatert, og funksjonen vises i testdataene «blogg».

**Rekkefølge og milepæler**

- **Fase 0:** M0.1 repo som pnpm-workspace etter TypeScript-standarden, CI og compose med proxy → M0.2 hele datamodellen med migrasjoner og testdata «tom» → M0.3 innlogging, økter, CSRF, begrensning, tofaktor, jobbkø og e-post → M0.4 setup-wizard og `toa core install` → M0.5 admin-skall med meny, roller og profil → M0.6 editor-prototype med beslutningsnotat og estimat for fase 1.
- **Fase 1:** M1.1 innholds-API og listeskjermer → M1.2 taxonomies, media og bildestørrelser → M1.3 editor med grunnblokkene, sidepanel og planlagt publisering → M1.4 tema-SDK, catch-all-rute, standardtema, arkiver og cache → M1.5 menyer, globale sett, innstillingssidene, permalenker og omdirigeringer → M1.6 RSS, sitemap, SEO og oEmbed → M1.7 Nettstedshelse Info, sikkerhetskopi via CLI og oppdateringssiden → M1.8 egen blogg i drift i 14 dager.
- Hver milepæl leverer en kjørbar image med versjonsmerke, kort demo, oppdatert endringslogg og grønn CI.

**Testdata**

- `toa dev seed tom`, `blogg` (50 innlegg, 10 sider, 3 brukere per rolle, menyer og kommentarer), `stor` (50 000 innlegg, 200 000 kommentarer, 20 000 mediefiler, for ytelsesmålene) og `butikk` (200 produkter av alle typer, 1 000 ordrer i alle statuser, alle MVA-satser).
- WXR-filer: WordPress' Theme Unit Test-data, en ekte eksport fra din egen blogg og en WooCommerce-eksport med produkter, varianter og ordrer.
- Betaling testes mot testmiljøene til Vipps MobilePay og Stripe, med lagrede webhook-varsler som kan spilles av på nytt.

## Risiko og åpne beslutninger

Den største risikoen er omfang: WordPress er over 20 år med arbeid fra hundrevis av bidragsytere, så full paritet er ikke målet. Målet er at fase 1–2 dekker det de fleste nettsteder faktisk bruker. Planen er bred med vilje: fasekolonnen i hver tabell er det som holder fase 1 liten, og alt merket fase 3–4 skal bare påvirke fase 1 ved at datamodellen har plass til det (se «Konsekvenser for datamodellen nå»).

**Risiko**

- **Editoren tar lengst tid.** En god blokkeditor er et prosjekt i seg selv. Avbøtes ved å starte med TipTap og et lite sett blokker, og vente med full site editing.
- **Omfanget vokser.** Planen dekker mye med vilje. Avbøtes ved at hver port må være nådd før neste fase starter, og at nye ideer får en fase før de får kode.
- **Én utvikler.** Alt stopper hvis du blir borte. Avbøtes ved at dokumentasjon og tester er en del av hver fase, ikke noe som kommer til slutt.
- **Lisens.** WordPress er GPLv2+. Funksjoner bygges ut fra oppførsel og dokumentasjon, ikke ved å oversette PHP-kode, slik at kjernen kan lisensieres under MIT.
- **Varemerke.** Navnet «WordPress» kan ikke brukes i produktnavnet; «WordPress-kompatibel import» er greit.
- **Utvidelser kan gjøre mer enn SDK-et tillater.** De er TypeScript i samme prosess som kjernen, så rettighetene i manifestet kan ikke håndheves fullt ut. Avbøtes med katalog-gjennomgang, signerte pakker, installasjon via pakkehåndterer og feilisolering.
- **To prosesser å drifte.** Nuxt-appene, API-et og workeren i hver sin container øker kompleksiteten for selvhostere, selv om alt er samme språk og API og worker deler image. Avbøtes med én `docker compose`-fil og ferdige profiler.
- **Lovkrav i butikken.** Feil i angrerett, opplysningsplikt eller bokføring rammer butikkeieren. Avbøtes med juridisk gjennomgang før B1 og ved å følge med på endringer som angreknappen.
- **Betalingsfeil.** Doble trekk eller tapte betalinger er det verste som kan skje i en butikk. Avbøtes med idempotente betalingskall og tester mot testmiljøene til Vipps MobilePay og Stripe.

**Åpne beslutninger**

Ingen åpne beslutninger står igjen. Nye spørsmål legges her før de får kode.

**Besluttet så langt**

- Stacken er TypeScript hele veien: Nuxt 4, Hono på Node, Zod, Drizzle og pg-boss, etter toa-rules TYPESCRIPT\_STANDARD\_2026. Den erstatter FastAPI-planen, slik at kjerne og utvidelser deler språk, typer og runtime
- Navnet er toascribe, med hjem på toascribe.dev. Det gamle Git-baserte toa-scribe for Hugo/Astro legges ned, og toascribe tar over navnet
- Kjernen lisensieres under MIT, med en egen varemerkepolicy for navnet «toascribe»; temaer og utvidelser velger egen lisens som tillater bruk og endring
- Jobbkøen ligger i PostgreSQL med pg-boss; jobber legges i samme transaksjon som endringen som utløser dem
- Valkey er valgfri og brukes bare som delt cache når flere instanser kjører; standardoppsettet er PostgreSQL pluss appens egne containere
- Admin, innlogging, roller og ord følger WordPress tett
- Innhold lagres som JSON-blokker med versjoner og migreringer
- Temaer og utvidelser regnes som betrodd kode; admin kjører som egen app på /admin med CSRF-token og streng CSP, og eget domene er et valgfritt herdingsvalg
- Utvidelser installeres bare fra katalogen eller med pakkehåndterer; temaer kan lastes opp som zip bare av administrator. Utvidelser kjører i samme prosess som kjernen, som i WordPress; det som skal kjøre isolert, bygges som eksternt program mot API-et og webhooks med et applikasjonspassord, og det lages ikke et eget sandkasse-system
- Bytte av tema skjer via byggetjenesten; tema-innstillinger krever ikke bygg
- Planlagt publisering styres av databasen
- Eget API under `/api/v1/`; `/wp-json/wp/v2` leveres som første-parts utvidelse
- Blokker fra utvidelser kommer når utvidelsessystemet er ferdig i fase 3
- E-handel blir første-parts utvidelsen «toascribe Butikk», ikke en kobling til Saleor, Medusa eller Vendure. Butikken og regnskapskoblingen er av til brukeren slår dem på; Fiken er første regnskapsintegrasjon, deretter Tripletex. Alle koblinger går gjennom ett integrasjonslag, og et avgrenset WooCommerce-kompatibelt API kommer som adapter i B3. Juridisk og regnskapsmessig gjennomgang er en del av sjekklisten før B1
