# Funksjonsregister

Registeret er fasit for fase, tabell og API-område for hver funksjon i toascribe. Står det noe annet i hoveddokumentet, gjelder registeret, og endringer gjøres her først. Hver funksjon må oppfylle definisjonen av ferdig i faseplanen før den regnes som levert. «–» i Tabell betyr at funksjonen ikke lagrer egne data; «Tverrgående» betyr at den gjelder alle endepunkter.

## Kjerne: kontoer, admin, innhold, media, menyer og temaer

| ID | Område | Funksjon | Fase | Tabell | API-område | Seksjon |
| --- | --- | --- | --- | --- | --- | --- |
| K-001 | Innlogging/kontoer | Innlogging /login med brukernavn eller e-post og passord | 0 | session,account | Innlogging, Meg, Brukere og roller | Innlogging |
| K-002 | Innlogging/kontoer | Husk meg (14 d / 2 d) med httpOnly-cookie | 0 | session | Innlogging, Meg, Brukere og roller | Innlogging |
| K-003 | Innlogging/kontoer | Mistet passord: engangslenke 24 t + nytt passord med styrkemåler | 0 | – | Innlogging, Meg, Brukere og roller | Innlogging |
| K-004 | Innlogging/kontoer | Mistet passord svarer likt uansett om konto finnes | 0 | – | Innlogging, Meg, Brukere og roller | Gjennomgang |
| K-005 | Innlogging/kontoer | Registrering /register med standardrolle | 0 | account,account\_role | Innlogging, Meg, Brukere og roller | Innlogging |
| K-006 | Innlogging/kontoer | Spamvern ved registrering (honningkrukke/captcha) | 1 | – | Innlogging, Meg, Brukere og roller | Gjennomgang |
| K-007 | Innlogging/kontoer | Utlogging /logout med CSRF og bekreftelse | 0 | session | Innlogging, Meg, Brukere og roller | Innlogging |
| K-008 | Innlogging/kontoer | redirect\_to kun til egne adresser | 0 | – | Innlogging, Meg, Brukere og roller | Innlogging |
| K-009 | Innlogging/kontoer | Videresending av /wp-admin og /wp-login.php | 0 | – | Innlogging, Meg, Brukere og roller | Innlogging |
| K-010 | Innlogging/kontoer | Innloggings-modal når økten utløper i editoren | 1 | – | Innlogging, Meg, Brukere og roller | Innlogging |
| K-011 | Innlogging/kontoer | Profil: navn/kallenavn/vis navn/e-post/nettsted/bio | 0 | account.profile | Innlogging, Meg, Brukere og roller | Innlogging |
| K-012 | Innlogging/kontoer | E-postbytte krever bekreftelse | 0 | account.profile (ventende e-post) | Innlogging, Meg, Brukere og roller | Innlogging |
| K-013 | Innlogging/kontoer | Generer passord + logg ut overalt + liste over aktive økter | 0 | session | Innlogging, Meg, Brukere og roller | Innlogging |
| K-014 | Innlogging/kontoer | Vis passord på innlogging | 0 | – | Innlogging, Meg, Brukere og roller | Gjennomgang |
| K-015 | Innlogging/kontoer | Gravatar + eget opplastet profilbilde | 1 | account.profile | Innlogging, Meg, Brukere og roller | Innlogging |
| K-016 | Innlogging/kontoer | Applikasjonspassord (navn/opprettet/sist brukt) | 1 | app\_password | Innlogging, Meg, Brukere og roller | Innlogging |
| K-017 | Innlogging/kontoer | Varsel til admin ved ny bruker og passordbytte | 0 | setting | Innlogging, Meg, Brukere og roller | Innlogging |
| K-018 | Innlogging/kontoer | Fem standardroller og capabilities med WP-navn | 0 | role,account\_role | Innlogging, Meg, Brukere og roller | Innlogging |
| K-019 | Innlogging/kontoer | Administrator kan lage nye roller | 1 | role | Brukere og roller | Innlogging |
| K-020 | Innlogging/kontoer | Brukerliste og Legg til bruker | 1 | account | Brukere og roller | Admin |
| K-021 | Innlogging/kontoer | Slett bruker med overføring eller sletting av innhold | 1 | content\_author | Brukere og roller | Gjennomgang |
| K-022 | Innlogging/kontoer | Massehandling endre rolle + send tilbakestilling av passord | 1 | account\_role | Brukere og roller | Gjennomgang |
| K-023 | Innlogging/kontoer | Tofaktor TOTP med gjenopprettingskoder | 0 | mfa\_credential,recovery\_code | Innlogging, Meg, Brukere og roller | Innlogging |
| K-024 | Innlogging/kontoer | Passkeys | 2 | mfa\_credential | Innlogging, Meg, Brukere og roller | Innlogging |
| K-025 | Innlogging/kontoer | OIDC-pålogging (Authentik/Google/Microsoft) | 2 | mfa\_credential (ekstern identitet) | Innlogging, Meg, Brukere og roller | Innlogging |
| K-026 | Innlogging/kontoer | Begrensning av feilede innlogginger per IP og konto | 0 | login\_attempt | Innlogging, Meg, Brukere og roller | Innlogging |
| K-030 | Admin | Hovedmeny som wp-admin (sammenleggbar/ikoner/rettighetsstyrt) | 1 | – | Meg | Admin |
| K-031 | Admin | Innholdstyper og utvidelser legger seg i menyen | 2 | extension\_state | Temaer og utvidelser | Admin |
| K-032 | Admin | Verktøylinje (admin bar) på admin og nettsted | 1 | account.preferences | Meg | Admin |
| K-033 | Admin | Kontrollpanel-widgets (Velkommen/Et øyeblikk/Aktivitet/Hurtigutkast/Helse) | 1 | account.preferences | Meg | Admin |
| K-034 | Admin | Listeskjermer: statusfiltre/søk/filter/sortering/paginering | 1 | content | Innhold | Admin |
| K-035 | Admin | Massehandlinger | 1 | content | Innhold | Admin |
| K-036 | Admin | Hurtigredigering i listen | 1 | content | Innhold | Admin |
| K-037 | Admin | Skjermalternativer lagret per bruker | 1 | account.preferences | Meg | Admin |
| K-038 | Admin | Hjelp lenker til dokumentasjon | 1 | – | Meg | Gjennomgang |
| K-039 | Admin | Admin-varsler som kan avvises (også fra utvidelser) | 1 | account.preferences | Meg | Admin |
| K-040 | Admin | Fargeskjema per bruker | 1 | account.preferences | Meg | Admin |
| K-041 | Admin | Kommandopalett Ctrl+K | 1 | – | Meg | Admin |
| K-042 | Admin | Oppdateringsteller i menyen | 2 | – | Meg | Gjennomgang |
| K-043 | Admin | Nyheter fra toascribe.dev i kontrollpanelet | 2 | – | Meg | toascribe.dev |
| K-044 | Admin | Sidetre med dra-og-slipp | 2 | content.parent\_id,menu\_order | Innhold | Andre CMS |
| K-045 | Admin | Rapporter (utdaterte sider/mangler meta/ødelagte lenker/oppgaver) | 3 | content\_ref | System | Andre CMS |
| K-046 | Admin | Låsing av innlegg med overtakelse | 2 | content\_lock | Innhold | Admin |
| K-047 | Admin | Heartbeat erstattet av WebSocket/SSE | 2 | – | – | Gjennomgang |
| K-060 | Innhold/editor/blokker | Innlegg og sider i content med type | 1 | content | Innhold | Funksjonskart |
| K-061 | Innhold/editor/blokker | Statuser draft/pending/future/publish/private/trash | 1 | content.status | Innhold | Datamodell |
| K-062 | Innhold/editor/blokker | Papirkurv med tømming etter 30 dager | 1 | content.status\_before\_trash | Innhold | Gjennomgang |
| K-063 | Innhold/editor/blokker | Planlagt publisering (minuttjobb uten dobbeltkjøring) | 1 | content.published\_at | Innhold | Funksjonskart |
| K-064 | Innhold/editor/blokker | Planlagt avpublisering | 1 | content.unpublish\_at | Innhold | Andre CMS |
| K-065 | Innhold/editor/blokker | Korte lenker /?p= og Kopier lenke | 1 | content.short\_id | Innhold | Gjennomgang |
| K-066 | Innhold/editor/blokker | Flere forfattere per innlegg | 1 | content\_author | Innhold | Andre CMS |
| K-067 | Innhold/editor/blokker | Synlighet: offentlig/privat/passord (cookie 10 d) | 1 | content.password | Innhold | Admin |
| K-068 | Innhold/editor/blokker | Sideattributter: forelder/mal/rekkefølge | 1 | content.parent\_id,template,menu\_order | Innhold | Admin |
| K-069 | Innhold/editor/blokker | Fest øverst på forsiden | 1 | content.sticky | Innhold | Admin |
| K-070 | Innhold/editor/blokker | Send til gjennomgang for bidragsytere | 1 | content.status | Innhold | Gjennomgang |
| K-071 | Innhold/editor/blokker | Forhåndsvisning av utkast via tidsbegrenset lenke | 1 | – | Innhold | Nettstedet |
| K-072 | Innhold/editor/blokker | Revisjoner med diff og gjenoppretting (maks 25) | 2 | content\_revision | Innhold | Funksjonskart |
| K-073 | Innhold/editor/blokker | Autosave hvert 30. s + nyere autolagret utkast | 2 | content\_autosave | Innhold | Funksjonskart |
| K-074 | Innhold/editor/blokker | Ventende utkast til publisert innhold (arbeidskopi) | 2 | content\_draft | Innhold | Datamodell |
| K-075 | Innhold/editor/blokker | Blokkeditor (blokktre + TipTap per tekstblokk + angre/gjenta) | 1 | content.blocks | Innhold | Blokkspes |
| K-076 | Innhold/editor/blokker | Blokkformat JSON + block.json-spesifikasjon | 1 | content.blocks | Innhold | Blokkspes |
| K-077 | Innhold/editor/blokker | Validering av blokkattributter i editor og backend | 1 | – | Innhold | Blokkspes |
| K-078 | Innhold/editor/blokker | Grunnblokker (tekst/media/oppsett/innbygging/nettsted/innhold) | 1 | content.blocks | Innhold | Blokkspes |
| K-079 | Innhold/editor/blokker | Ekstra kjerneblokker (HTML/klassisk/Les mer/sideskift/pre/fotnoter) | 1 / 2 (klassisk, fotnoter) | content.blocks | Innhold | Blokkspes |
| K-080 | Innhold/editor/blokker | Nye blokker fra 7.0 (brødsmuler/ikoner/lysboks) | 2 | content.blocks | Innhold | WP 6.3–7.0 |
| K-081 | Innhold/editor/blokker | Blokkinnsetter med søk og skråstrek-kommandoer | 1 | – | Innhold | Admin |
| K-082 | Innhold/editor/blokker | Mønstre fra kjerne/tema/utvidelser | 2 | pattern | Mønstre | Blokkspes |
| K-083 | Innhold/editor/blokker | Synkroniserte mønstre med lokale overstyringer | 2 | pattern | Mønstre | Blokkspes |
| K-084 | Innhold/editor/blokker | Startmønstre for nye sider | 2 | pattern | Mønstre | Blokkspes |
| K-085 | Innhold/editor/blokker | Query Loop | 1 | – | Innhold | Blokkspes |
| K-086 | Innhold/editor/blokker | Blokkbindinger til felter | 3 | content.fields | Innhold | Blokkspes |
| K-087 | Innhold/editor/blokker | Blokkversjonering med migrate.py og feilboks | 2 | content.blocks | Innhold | Blokkspes |
| K-088 | Innhold/editor/blokker | HTML-rensing (kses) og unfiltered\_html | 1 | – | Innhold | Blokkspes |
| K-089 | Innhold/editor/blokker | Serverrendret View.vue og interaktivitet etterpå | 1 | – | Innhold | Blokkspes |
| K-090 | Innhold/editor/blokker | Utvidelsesblokker vises som plassholder når deaktivert | 3 | – | Innhold | Blokkspes |
| K-091 | Innhold/editor/blokker | Blokk-lekeplass i admin | 2 | – | Innhold | Blokkspes |
| K-092 | Innhold/editor/blokker | Innliming fra Word og Google Docs | 2 | – | Innhold | Blokkspes |
| K-093 | Innhold/editor/blokker | Egendefinerte felter (ACF-ekvivalent) | 2 | content.fields | Innholdstyper og felter | Blokkspes |
| K-094 | Innhold/editor/blokker | Egne innholdstyper (kode + admin) | 2 | content\_type, field\_group | Innholdstyper og felter | Funksjonskart |
| K-095 | Innhold/editor/blokker | Live forhåndsvisning side om side | 2 | – | Innhold | Andre CMS |
| K-096 | Innhold/editor/blokker | Tilgjengelighetssjekk i editoren | 2 | – | Innhold | Andre CMS |
| K-097 | Innhold/editor/blokker | Redaksjonelle arbeidsflyter med steg og tildeling | 3 | workflow,content.workflow\_state | Innhold | Andre CMS |
| K-098 | Innhold/editor/blokker | Notater på blokker | 3 | block\_note | Innhold | WP 6.3–7.0 |
| K-099 | Innhold/editor/blokker | Visuelle revisjoner side om side | 3 | content\_revision | Innhold | WP 6.3–7.0 |
| K-100 | Innhold/editor/blokker | Sanntidssamarbeid (Yjs) | 4 | – | Innhold | WP 6.3–7.0 |
| K-101 | Innhold/editor/blokker | Utgivelser (samlet publisering) | 4 | release,content\_draft.release\_id | Innhold | Andre CMS |
| K-102 | Innhold/editor/blokker | Tilgangskontroll per felt | 3 | – | Innhold | Andre CMS |
| K-103 | Innhold/editor/blokker | Full site editing (maler av blokker) | 4 | template | Maler | Funksjonskart |
| K-104 | Innhold/editor/blokker | Shortcodes som plassholder/parser ved import | 2 | – | Innhold | Funksjonskart |
| K-105 | Innhold/editor/blokker | SEO-panel (tittel/beskrivelse/delingsbilde + forhåndsvisning) | 1 | content.seo | Innhold | Andre CMS |
| K-106 | Innhold/editor/blokker | Globale innholdssett | 1 | global\_set | Globale sett | Andre CMS |
| K-107 | Innhold/editor/blokker | Utdrag og Les mer | 1 | content.excerpt | Innhold | Nettstedet |
| K-110 | Media | Mediebibliotek med opplasting lokalt eller S3 | 1 | media | Media | Funksjonskart |
| K-111 | Media | Bildestørrelser + WebP/AVIF (pyvips) | 1 | media.variants | Media | Funksjonskart |
| K-112 | Media | Rutenett/liste og dra-og-slipp | 1 | media | Media | Admin |
| K-113 | Media | Detaljvindu: alt/bildetekst/beskrivelse/Kopier URL | 1 | media | Media | Admin |
| K-114 | Media | Enkel bilderedigering (beskjær/roter/speil/skaler) | 1 | media.variants | Media | Admin |
| K-115 | Media | Erstatte mediefil | 1 | media.storage\_key | Media | Gjennomgang |
| K-116 | Media | Lage bildestørrelser på nytt (jobb + CLI) | 1 | media.variants | Media | Gjennomgang |
| K-117 | Media | Største filstørrelse vises i dialogen | 1 | – | Media | Gjennomgang |
| K-118 | Media | Fokuspunkt | 2 | media.focal\_point | Media | Andre CMS |
| K-119 | Media | Mediemapper | 1 | media\_folder | Media | Svakheter |
| K-120 | Media | Stikkord for media | 2 | media\_term | Media | Svakheter |
| K-121 | Media | Duplikatdeteksjon ved opplasting | 2 | media.sha256 | Media | Svakheter |
| K-122 | Media | Brukes på + advarsel før sletting | 1 | content\_ref | Media | Nettstedet |
| K-123 | Media | Vedleggssider av/på | 2 | – | Media | Gjennomgang |
| K-124 | Media | Privat media (visibility) | 1 | media.visibility | Media | Datamodell |
| K-125 | Media | Opplastingsvern (filtyper per rolle/SVG-rens/pikselgrense) | 1 | – | Media | Nettstedet |
| K-126 | Media | Responsive bilder srcset og lat lasting | 1 | media.variants | Media | Nettstedet |
| K-130 | Taxonomies/menyer | Kategorier/stikkord/hierarkiske termer | 1 | taxonomy,term,content\_term | Taxonomies; Menyer | Funksjonskart |
| K-131 | Taxonomies/menyer | Egne taxonomies fra kode og utvidelser | 2 | taxonomy | Taxonomies | Utvidelsesspes |
| K-132 | Taxonomies/menyer | Menyer som JSON-tre + menyplasseringer | 1 | menu | Menyer | Funksjonskart |
| K-133 | Taxonomies/menyer | Widget-områder fylt med blokker | 3 | area | Områder | Funksjonskart |
| K-134 | Taxonomies/menyer | Kobling av menyer og områder ved temabytte | 3 | menu,area | Menyer; Områder | Temaspes |
| K-140 | Temaer | Tema som Nuxt layer + template-hierarki i catch-all-rute | 1 | – | Temaer og utvidelser; Offentlig lesing | Utvidelsessystem |
| K-141 | Temaer | Tema valgt i toascribe.toml | 1 | – | Temaer og utvidelser; Offentlig lesing | Kjøremodell |
| K-142 | Temaer | theme.json-manifest og JSON Schema | 1 (schema publiseres i 2) | – | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-143 | Temaer | Tema-SDK (useContent osv.) + ScribeHead/ScribeFooter/ScribeBlocks | 1 | – | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-144 | Temaer | Temavalidering (themeApi) | 3 | – | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-145 | Temaer | Installasjon fra katalog/zip/git | 3 | extension\_state | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-146 | Temaer | Forhåndsvis tema i isolert bygg | 3 | – | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-147 | Temaer | Aktiver tema med atomisk bytte og tilbakerulling | 3 | extension\_state | Temaer og utvidelser; Offentlig lesing | Kjøremodell |
| K-148 | Temaer | Barnetemaer | 1 | – | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-149 | Temaer | Oppdatering og sletting av temaer | 3 | extension\_state | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-150 | Temaer | Tema-innstillinger lagret per tema | 1 | extension\_state | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-151 | Temaer | Tilpass (identitet/farger/fonter/Ekstra CSS/forside) | 1 | setting | Innstillinger; Offentlig lesing | Innstillinger |
| K-152 | Temaer | Fontbibliotek | 2 | media, setting | Media; Innstillinger | WP 6.3–7.0 |
| K-153 | Temaer | toa theme create/dev/validate/package/build | 3 | – | Temaer og utvidelser; Offentlig lesing | Temaspes |
| K-154 | Temaer | Standardtema minimalt og WCAG 2.2 AA | 1 | – | Temaer og utvidelser; Offentlig lesing | Utvidelsessystem |
| K-155 | Temaer | Sidemaler valgbare per side | 1 | content.template | Innhold | Temaspes |

## Kjerne: utvidelser, innstillinger, nettsted, API, CLI, drift og sikkerhet

| ID | Område | Funksjon | Fase | Tabell | API-område | Seksjon |
| --- | --- | --- | --- | --- | --- | --- |
| K-160 | Utvidelser | Hook-registry med typede actions/filters og prioritet | 3 | – | Temaer og utvidelser | Utvidelsessystem |
| K-161 | Utvidelser | Plugin-pakke med entry point og plugin.json | 3 | extension\_state | Temaer og utvidelser | Utvidelsesspes |
| K-162 | Utvidelser | Livssyklus installer/aktiver/deaktiver/slett/oppdater | 3 | extension\_state | Temaer og utvidelser | Utvidelsesspes |
| K-163 | Utvidelser | Egne tabeller og migrasjoner med prefiks | 3 | plugin\_\<slug>\_\* | Temaer og utvidelser | Utvidelsesspes |
| K-164 | Utvidelser | API-ruter under /api/plugins/\<slug>/ | 3 | – | Temaer og utvidelser | Utvidelsesspes |
| K-165 | Utvidelser | Permissions-erklæring vist før aktivering | 3 | extension\_state | Temaer og utvidelser | Utvidelsesspes |
| K-166 | Utvidelser | Innstillingsside generert fra skjema | 3 | extension\_state | Temaer og utvidelser | Utvidelsesspes |
| K-167 | Utvidelser | Feilisolering og gjenopprettingsmodus | 3 | extension\_state | Temaer og utvidelser | Utvidelsesspes |
| K-168 | Utvidelser | mu-plugins | 3 | – | Temaer og utvidelser | Utvidelsesspes |
| K-169 | Utvidelser | Eget pnpm-workspace med låsefil og ny installasjon ved oppdatering | 3 | – | Temaer og utvidelser | Kjøremodell |
| K-170 | Utvidelser | Byggetjeneste (builder) | 3 | – | Temaer og utvidelser | Kjøremodell |
| K-171 | Utvidelser | Automatiske oppdateringer av utvidelser | 3 | extension\_state | Temaer og utvidelser | Innstillinger |
| K-172 | Utvidelser | Katalog med gjennomgang/signering/sårbarhetsvarsler | 3 | extension\_state | Temaer og utvidelser | toascribe.dev |
| K-173 | Utvidelser | Plugin-utviklerverktøy + pytest-hjelpere + hook-oversikt | 3 | – | Temaer og utvidelser | Utvidelsesspes |
| K-174 | Utvidelser | Endrede permissions krever ny godkjenning | 3 | extension\_state | Temaer og utvidelser | toascribe.dev |
| K-175 | Utvidelser | Cache-API i SDK (transients) | 1 | – | – | Gjennomgang |
| K-176 | Utvidelser | Egne adresser via manifest (Rewrite API) | 3 | – | Temaer og utvidelser | Gjennomgang |
| K-177 | Utvidelser | Webhooks med signatur og logg | 2 | webhook,webhook\_delivery | Verktøy (webhooks) | Andre CMS |
| K-178 | Utvidelser | Skjemabygger (første-parts) | 3 | plugin-tabeller | Temaer og utvidelser | Andre CMS |
| K-179 | Utvidelser | Medlemskap og nyhetsbrev | 4 | plugin-tabeller | Temaer og utvidelser | Andre CMS |
| K-180 | Utvidelser | Statistikk uten cookies | 4 | plugin-tabeller | Temaer og utvidelser | Andre CMS |
| K-181 | Utvidelser | GraphQL | 4 | – | Temaer og utvidelser | Andre CMS |
| K-182 | Utvidelser | Meilisearch via utvidelse | 3 | – | Temaer og utvidelser | Funksjonskart |
| K-183 | Utvidelser | AI-innstillinger (leverandør og nøkler) | 3 | setting | Innstillinger (ai) | WP 6.3–7.0 |
| K-184 | Utvidelser | Abilities API + innebygd MCP-server | 4 | – | Temaer og utvidelser | WP 6.3–7.0 |
| K-190 | Innstillinger/verktøy | setting-tabell med typede nøkler og autoload | 1 | setting | Innstillinger | Funksjonskart |
| K-191 | Innstillinger/verktøy | Innstillinger → Generelt | 1 | setting | Innstillinger | Innstillinger |
| K-192 | Innstillinger/verktøy | Administrator-e-post endres med bekreftelse | 1 | setting | Innstillinger | Innstillinger |
| K-193 | Innstillinger/verktøy | Innstillinger → Skriving | 1 | setting | Innstillinger | Innstillinger |
| K-194 | Innstillinger/verktøy | Innstillinger → Lesing (forside/RSS/noindex) | 1 | setting | Innstillinger | Innstillinger |
| K-195 | Innstillinger/verktøy | Innstillinger → Diskusjon | 3 | setting | Innstillinger | Innstillinger |
| K-196 | Innstillinger/verktøy | Innstillinger → Media (størrelser/mapper) | 1 | setting | Innstillinger | Innstillinger |
| K-197 | Innstillinger/verktøy | Innstillinger → Permalenker | 1 | setting | Innstillinger | Innstillinger |
| K-198 | Innstillinger/verktøy | Innstillinger → Personvern | 1 | setting | Innstillinger | Innstillinger |
| K-199 | Innstillinger/verktøy | Personvernside lenkes i bunntekst og registrering | 1 | setting | Innstillinger | Gjennomgang |
| K-200 | Innstillinger/verktøy | WXR-import (media/forfattere/lenker/hasher/kommentarer) | 2 | content.legacy\_wp\_id | Verktøy | Funksjonskart |
| K-201 | Innstillinger/verktøy | RSS-import | 2 | – | Verktøy | Innstillinger |
| K-202 | Innstillinger/verktøy | Eksport WXR og JSON med filtre | 2 | – | Verktøy | Innstillinger |
| K-203 | Innstillinger/verktøy | Nettstedshelse (Info og Status) | 1 (Info) / 3 (Status) | – | System | Funksjonskart |
| K-204 | Innstillinger/verktøy | Send test-e-post | 0 | – | System | Nettstedet |
| K-205 | Innstillinger/verktøy | Eksporter og slett persondata (GDPR) | 2 | privacy\_request | Verktøy | Admin |
| K-206 | Innstillinger/verktøy | Omdirigeringer i admin + CSV + 404-logg | 2 | redirect,not\_found\_log | Verktøy | Andre CMS |
| K-207 | Innstillinger/verktøy | Automatisk omdirigering ved slug-endring | 1 | redirect | Innstillinger | Gjennomgang |
| K-208 | Innstillinger/verktøy | Prosjektkonfig toa config export/import (YAML) | 2 | content\_type, field\_group, setting | Innholdstyper og felter | Svakheter |
| K-209 | Innstillinger/verktøy | Samtykke-API + banner + innbygginger etter klikk | 2 | consent | Offentlig lesing | Nettstedet |
| K-220 | Nettsted/SEO/feeds | Arkiver (kategori/stikkord/forfatter/dato) + søk + 404 | 1 | – | Offentlig lesing | Nettstedet |
| K-221 | Nettsted/SEO/feeds | Permalenkemønstre | 1 | setting | Offentlig lesing | Funksjonskart |
| K-222 | Nettsted/SEO/feeds | RSS (nettsted/kategori/stikkord; kommentarer fra fase 3) | 1 | – | Offentlig lesing | Funksjonskart |
| K-223 | Nettsted/SEO/feeds | sitemap.xml og robots.txt | 1 | – | Offentlig lesing | Funksjonskart |
| K-224 | Nettsted/SEO/feeds | Kanoniske lenker/meta-beskrivelse/Open Graph | 1 | – | Offentlig lesing | Nettstedet |
| K-225 | Nettsted/SEO/feeds | oEmbed-innbygging | 1 | oembed\_cache | Offentlig lesing | Nettstedet |
| K-226 | Nettsted/SEO/feeds | Statisk forside og innleggsside | 1 | setting | Offentlig lesing | Innstillinger |
| K-227 | Nettsted/SEO/feeds | Innlegg delt over flere sider | 1 | content.blocks | Offentlig lesing | Nettstedet |
| K-228 | Nettsted/SEO/feeds | Standardinnhold ved oppsett (Hei verden/eksempelside/personvern) | 0 | content | Offentlig lesing | Installasjon |
| K-230 | Kommentarer | Trådede kommentarer med moderering | 3 | comment | Kommentarer | Funksjonskart |
| K-231 | Kommentarer | Kommentaradmin: svar/rediger/Spam-fane/IP | 3 | comment | Kommentarer | Gjennomgang |
| K-232 | Kommentarer | Spamfilter-hook | 3 | – | Kommentarer | Funksjonskart |
| K-233 | Kommentarer | Kommentarskjema som kjernekomponent | 3 | comment | Offentlig lesing | Temaspes |
| K-234 | Kommentarer | Kommentar-cookie med samtykke | 3 | consent | Kommentarer | Gjennomgang |
| K-235 | Kommentarer | E-postvarsler og moderering på lenker og ord | 3 | setting | Kommentarer | Innstillinger |
| K-236 | Kommentarer | Avatarer med standard-avatar | 1 | – | Kommentarer | Gjennomgang |
| K-240 | Søk | Fulltekstsøk tsvector med vekting og norsk ordstamme | 2 | content.search | Offentlig lesing | Funksjonskart |
| K-241 | Søk | Søkeside og søkeblokk på nettstedet | 1 | – | Offentlig lesing | Nettstedet |
| K-242 | Søk | Søk i adminlister | 1 | – | Innhold | Admin |
| K-250 | API | Eget REST-API under /api/v1 med OpenAPI | 1 | – | Alle | Arkitektur |
| K-251 | API | Inkludering av relasjoner + paginering i headere | 1 | – | – | Gjennomgang |
| K-252 | API | Versjonering med Deprecation-header | 1 | – | – | Arkitektur |
| K-253 | API | CORS per opprinnelse | 2 | setting | Innstillinger (advanced) | Arkitektur |
| K-254 | API | OAuth | Senere | – | – | Arkitektur |
| K-255 | API | /wp-json/wp/v2 lesing | 2 | – | wp/v2-modul | Arkitektur |
| K-256 | API | /wp-json/wp/v2 skriving | 4 | – | wp/v2-modul | Arkitektur |
| K-257 | API | TypeScript-typer generert fra OpenAPI | 0 | – | – | Arkitektur |
| K-258 | API | CSRF-token i header på alle endrende kall | 0 | – | – | Kjøremodell |
| K-260 | CLI | toa core install | 0 | – | CLI | CLI |
| K-261 | CLI | toa core version / toa core check-update | 1 | – | CLI | CLI |
| K-262 | CLI | toa user / toa role / toa cap | 0 | account,role | CLI | CLI |
| K-263 | CLI | toa post / toa term / toa menu | 1 | content,term,menu | CLI | CLI |
| K-264 | CLI | toa option | 1 | setting | CLI | CLI |
| K-265 | CLI | toa cache flush | 1 | – | CLI | CLI |
| K-266 | CLI | toa maintenance-mode | 1 | – | CLI | CLI |
| K-267 | CLI | toa media regenerate | 1 | media | CLI | CLI |
| K-268 | CLI | toa db export/import + toa search-replace | 2 | – | CLI | CLI |
| K-269 | CLI | toa import / toa export | 2 | – | CLI | CLI |
| K-270 | CLI | toa jobs list/run | 1 | – | CLI | CLI |
| K-271 | CLI | toa secrets export | 1 | – | CLI | CLI |
| K-272 | CLI | toa shell | 1 | – | CLI | CLI |
| K-273 | CLI | toa plugin deactivate (fungerer uten admin) | 3 | extension\_state | CLI | Utvidelsesspes |
| K-274 | CLI | toa block create | 3 | – | CLI | Blokkspes |
| K-275 | CLI | toa comment | 3 | comment | CLI | CLI |
| K-276 | CLI | toa dev seed (tom/blogg/stor/butikk) | 0 | – | CLI | Faseplan |
| K-280 | Drift/oppdatering/backup | docker compose med proxy-container | 0 | – | System | Installasjon |
| K-281 | Drift/oppdatering/backup | Setup-wizard med engangstoken og installed-flagg | 0 | setting | System | Installasjon |
| K-282 | Drift/oppdatering/backup | Genererte hemmeligheter på volumet secrets/ + gjenopprettingsnøkkel | 0 | – | System | Installasjon |
| K-283 | Drift/oppdatering/backup | Admin på eget domene (herdingsvalg) | 0 | setting | Innstillinger | Kjøremodell |
| K-284 | Drift/oppdatering/backup | E-posttjeneste med SMTP via jobbkø | 0 | setting | System | Nettstedet |
| K-285 | Drift/oppdatering/backup | E-postmaler overstyrbare og oversettbare | 1 | – | System | Nettstedet |
| K-286 | Drift/oppdatering/backup | Jobbkø pg-boss + faste tidsplaner | 0 | skjemaet pgboss | System | Funksjonskart |
| K-287 | Drift/oppdatering/backup | Automatiske migrasjoner ved oppstart med lås | 1 | – | System | Installasjon |
| K-288 | Drift/oppdatering/backup | Vedlikeholdsmodus | 1 | – | System | Installasjon |
| K-289 | Drift/oppdatering/backup | Healthcheck-endepunkt | 0 | – | System | Installasjon |
| K-290 | Drift/oppdatering/backup | Kontrollpanel → Oppdateringer | 1 | – | System | Funksjonskart |
| K-291 | Drift/oppdatering/backup | Automatiske patch-oppdateringer via oppdateringscontainer | 2 | – | System | Gjennomgang |
| K-292 | Drift/oppdatering/backup | Sikkerhetskopi (planlagt/S3/SFTP/kryptert) | 1 (CLI) / 2 (admin, S3, SFTP) | backup | System | Sikkerhetskopi |
| K-293 | Drift/oppdatering/backup | Automatisk kopi før migrasjoner ved ny versjon | 1 | backup | System | Sikkerhetskopi |
| K-294 | Drift/oppdatering/backup | Ukentlig test av gjenoppretting | 2 | – | System | Sikkerhetskopi |
| K-295 | Drift/oppdatering/backup | Flytte nettsted | 2 | – | System | Sikkerhetskopi |
| K-296 | Drift/oppdatering/backup | toa site clone (staging) | 2 | – | System | Sikkerhetskopi |
| K-297 | Drift/oppdatering/backup | TOASCRIBE\_DEBUG og strukturert logg | 1 | – | System | Gjennomgang |
| K-298 | Drift/oppdatering/backup | OpenTelemetry og valgfri Sentry | 1 | – | System | Nettstedet |
| K-299 | Drift/oppdatering/backup | Flere instanser (S3 + Valkey) | 2 | – | System | Nettstedet |
| K-300 | Drift/oppdatering/backup | toascribe.dev forside og brukerdokumentasjon | 1 | – | System | toascribe.dev |
| K-301 | Drift/oppdatering/backup | Utviklerdokumentasjon + publiserte JSON Schema | 2 | – | System | toascribe.dev |
| K-302 | Drift/oppdatering/backup | Offentlig demo som nullstilles hver time | 2 | – | System | toascribe.dev |
| K-310 | Sikkerhet | Argon2 + import av phpass/bcrypt med oppgradering | 0 | account | Innlogging | Nettstedet |
| K-311 | Sikkerhet | CSRF på alle skjemaer | 0 | – | Tverrgående | Nettstedet |
| K-312 | Sikkerhet | Rettighetssjekk mot capabilities på hvert endepunkt | 0 | role | Tverrgående | Nettstedet |
| K-313 | Sikkerhet | Rate limiting på innlogging/registrering/kommentarer | 0 | login\_attempt | Tverrgående | Nettstedet |
| K-314 | Sikkerhet | Sikkerhetsheadere CSP/HSTS + streng CSP i admin | 0 | – | Tverrgående | Nettstedet |
| K-315 | Sikkerhet | Revisjonslogg (IP i 90 dager) | 1 | audit\_log | System | Nettstedet |
| K-316 | Sikkerhet | SSRF-vern for all utgående HTTP | 0 | – | Tverrgående | Nettstedet |
| K-317 | Sikkerhet | defusedxml/sti-kontroll/pikselgrense | 1 | – | Tverrgående | Nettstedet |
| K-318 | Sikkerhet | Kryptering av hemmelige felt i databasen | 0 | krypterte felt i setting, mfa\_credential, webhook | Tverrgående | Installasjon |
| K-319 | Sikkerhet | SECURITY.md + security.txt + rutine for sikkerhetsutgivelser | 1 | – | Tverrgående | Nettstedet |
| K-320 | Ytelse/cache | SSR-cache med cache-tagger og invalidering | 1 | content\_ref | Tverrgående | Nettstedet |
| K-321 | Ytelse/cache | Valkey som delt cache | 2 | – | Tverrgående | Nettstedet |
| K-322 | Ytelse/cache | Ingen cache med innloggings- eller passordcookie | 1 | – | Tverrgående | Nettstedet |
| K-323 | Ytelse/cache | Ytelsesmål (100 ms cache / API p95 150 ms) | Løpende | – | Tverrgående | Nettstedet |
| K-324 | Ytelse/cache | GIN-indekser på fields og blocks | 0 | content | Tverrgående | Datamodell |
| K-330 | i18n/a11y | Admin på bokmål/nynorsk/engelsk | 1 | – | Tverrgående | Admin |
| K-331 | i18n/a11y | Oversettelse av temaer og utvidelser med t() | 1 (temaer) / 3 (utvidelser) | – | Tverrgående | Temaspes |
| K-332 | i18n/a11y | Flerspråklig innhold | 4 | content.locale,translation\_group | Tverrgående | Funksjonskart |
| K-333 | i18n/a11y | WCAG 2.2 AA i admin/editor/tema/kasse | Løpende fra 0 | – | Tverrgående | Nettstedet |
| K-334 | i18n/a11y | Tilgjengelighetserklæring fra kjernen | 2 | – | Tverrgående | Nettstedet |

## Butikk

| ID | Område | Funksjon | Fase | Tabell | API-område | Seksjon |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | Butikk | Aktivering under Utvidelser + menyene Butikk/Produkter/Markedsføring | B1 | extension\_state | Butikk | Butikk |
| B-02 | Butikk | Produkt som innholdstype product | B1 | content | Butikk | Butikk |
| B-03 | Butikk | Enkle produkter | B1 | shop\_product | Butikk | Butikk |
| B-04 | Butikk | Variable produkter med egenskaper og varianter | B1 | shop\_variant,shop\_attribute | Butikk | Butikk |
| B-05 | Butikk | Digitale og nedlastbare produkter | B1 | shop\_download | Butikk | Butikk |
| B-06 | Butikk | Eksterne og grupperte produkter | B2 | shop\_product | Butikk | Butikk |
| B-07 | Butikk | Produktdata: SKU/GTIN/merke/vekt og mål | B1 | shop\_product | Butikk | Butikk |
| B-08 | Butikk | Salgspris med planlagt periode | B1 | shop\_price | Butikk | Butikk |
| B-09 | Butikk | Prishistorikk og førpris | B1 | shop\_price\_history | Butikk | Butikk |
| B-10 | Butikk | Merker | B1 | taxonomy | Butikk | Butikk |
| B-11 | Butikk | Lager per variant/lav beholdning/restordre | B1 | shop\_stock | Butikk | Butikk |
| B-12 | Butikk | Lagerreservasjon i kassen + låsing mot oversalg | B1 | shop\_stock\_reservation | Butikk | Butikk |
| B-13 | Butikk | Handlekurv | B1 | shop\_cart, shop\_cart\_line | Butikk | Butikk |
| B-14 | Butikk | Kasse av blokker/gjestekjøp/kontoopprettelse/postnummer | B1 | shop\_address | Butikk | Butikk |
| B-15 | Butikk | Ekstra kassefelter fra utvidelser | B1 | shop\_order (fields) | Butikk | Butikk |
| B-16 | Butikk | Min konto (ordrer/nedlastinger/adresser/angre) | B1 | shop\_order,shop\_address | Butikk | Butikk |
| B-17 | Butikk | Sju ordrestatuser | B1 | shop\_order | Butikk | Butikk |
| B-18 | Butikk | Ordrenotater (private og til kunde) | B1 | shop\_order\_note | Butikk | Butikk |
| B-19 | Butikk | Manuell ordre i admin + Betal for ordre-lenke | B1 | shop\_order | Butikk | Butikk |
| B-20 | Butikk | Full og delvis refusjon + kreditnota | B1 | shop\_refund | Butikk | Butikk |
| B-21 | Butikk | Fortløpende order\_number | B1 | shop\_order | Butikk | Butikk |
| B-22 | Butikk | Nummerserie for kvittering/faktura uten hull | B1 | shop\_document, shop\_number\_series | Butikk | Butikk |
| B-23 | Butikk | Ordrelinjer med snapshot av navn/pris/MVA | B1 | shop\_order\_line | Butikk | Butikk |
| B-24 | Butikk | Butikk-e-poster og e-postmaler | B1 | – | Butikk | Butikk |
| B-25 | Butikk | MVA-klasser og MVA-spesifikasjon | B1 | shop\_tax\_class | Butikk | Butikk |
| B-26 | Butikk | MVA på frakt fordelt etter varelinjene | B1 | – | Butikk | Butikk |
| B-27 | Butikk | Fritatt/unntatt + 0 % til Svalbard og utland | B1 | shop\_tax\_class | Butikk | Butikk |
| B-28 | Butikk | Fraktsoner/faste priser/gratis frakt/hent selv/fraktklasser | B1 | shop\_shipping\_zone, shop\_shipping\_method, shop\_shipping\_class, shop\_shipping\_rate | Butikk | Butikk |
| B-29 | Butikk | Vektbasert frakt | B1 | shop\_shipping\_rate | Butikk | Butikk |
| B-30 | Butikk | Fraktfirma Bring/PostNord/Helthjem | B2 | shop\_shipment | Butikk | Butikk |
| B-31 | Butikk | Vipps MobilePay ePayment og Express | B1 | shop\_payment | Butikk | Butikk |
| B-32 | Butikk | Stripe (kort/Apple Pay/Google Pay) | B1 | shop\_payment | Butikk | Butikk |
| B-33 | Butikk | Reservasjon og trekk i to steg + varsel før utløp | B1 | shop\_payment | Butikk | Butikk |
| B-34 | Butikk | Idempotent behandling av betalingsvarsler | B1 | shop\_payment\_event | Butikk | Butikk |
| B-35 | Butikk | Grensesnitt for betalingsutvidelser (PaymentProvider) | B1 | – | Butikk | Butikk |
| B-36 | Butikk | Klarna/Nexi/Two | B2 | shop\_payment | Butikk | Butikk |
| B-37 | Butikk | Kuponger | B2 | shop\_coupon | Butikk | Butikk |
| B-38 | Butikk | Rapporter | B2 | – | Butikk | Butikk |
| B-39 | Butikk | Regnskapskobling Fiken | B2 | shop\_accounting\_sync | Butikk | Butikk |
| B-40 | Butikk | Regnskapskobling Tripletex | B2 | shop\_accounting\_sync | Butikk | Butikk |
| B-41 | Butikk | CSV-eksport av ordrer/refusjoner/MVA | B1 | – | Butikk | Butikk |
| B-42 | Butikk | Butikkhendelser som webhooks | B1 | webhook | Butikk | Butikk |
| B-43 | Butikk | Butikk-API /api/v1/shop/ | B1 | – | Butikk | Butikk |
| B-44 | Butikk | CSV-import/eksport + import fra WooCommerce | B1 | – | Butikk | Butikk |
| B-45 | Butikk | Omtaler med verifisert kjøper | B2 | comment (type review) | Butikk | Butikk |
| B-46 | Butikk | Mersalg og krysssalg | B2 | shop\_product\_link | Butikk | Butikk |
| B-47 | Butikk | Filterblokker | B2 | – | Butikk | Butikk |
| B-48 | Butikk | Produktfeeds Google Merchant og Prisjakt | B3 | – | Butikk | Butikk |
| B-49 | Butikk | Abonnement | B3 | shop\_subscription | Butikk | Butikk |
| B-50 | Butikk | B2B: kundegrupper/eks. MVA/EHF | B3 | shop\_customer\_group | Butikk | Butikk |
| B-51 | Butikk | Flere lagre/kanaler/valutaer | B3 | shop\_warehouse, shop\_channel | Butikk | Butikk |
| B-52 | Butikk | Gavekort med riktig MVA | B3 | shop\_gift\_card | Butikk | Butikk |
| B-53 | Butikk | WooCommerce REST-adapter | B3 | – | Butikk | Butikk |
| B-54 | Butikk | Nedlastinger via signerte lenker fra privat lager | B1 | shop\_download, shop\_download\_grant, media.visibility | Butikk | Butikk |
| B-55 | Butikk | Angrerett 14 dager + angreskjema | B1 | shop\_withdrawal | Butikk | Butikk |
| B-56 | Butikk | Angreknapp i to steg med kvittering | B1 | shop\_withdrawal | Butikk | Butikk |
| B-57 | Butikk | Opplysningsplikt + tydelig bestillingsknapp | B1 | setting | Butikk | Butikk |
| B-58 | Butikk | Standard salgsbetingelser som ferdig side | B1 | content | Butikk | Butikk |
| B-59 | Butikk | Reklamasjonsfrist i betingelser og Min konto | B1 | setting | Butikk | Butikk |
| B-60 | Butikk | Bokføring: ingen sletting; bare kreditering | B1 | – | Butikk | Butikk |
| B-61 | Butikk | Ordredata i persondataeksport + anonymisering | B1 | privacy\_request | Butikk | Butikk |
| B-62 | Butikk | Digitale produkter: samtykke til at angreretten faller bort | B1 | shop\_order\_line | Butikk | Butikk |
| B-63 | Butikk | Butikk → Hjem/Kunder/Status (logg og planlagte jobber) | B1 | – | Butikk | Butikk |
| B-64 | Butikk | Ingen cache for kurv/kasse/Min konto | B1 | – | Butikk | Nettstedet |
| B-65 | Butikk | Sjekkliste: jurist og regnskapsfører før B1 | B1 | – | Butikk | Butikk |
| B-66 | Butikk | Butikksider/valutaformat/salgsland/enheter (Kommer snart-modus i B2) | B1 | setting | Butikk | Butikk |
| B-67 | Butikk | Lagrede betalingsmåter | B2 | shop\_payment\_token | Butikk | Butikk |
| B-68 | Butikk | Ordreattribusjon | B2 | shop\_order | Butikk | Butikk |
| B-69 | Butikk | Vern mot kortprøving og begrensning i kassen | B1 | – | Butikk | Butikk |
