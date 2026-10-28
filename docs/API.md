# API-et

toascribe har ett eget REST-API under `/api/v1/`. Det beskrives fullt ut av OpenAPI-dokumentet på `/api/v1/openapi.json`, som lages
fra de samme Zod-skjemaene som API-et validerer med. Denne siden har reglene som ikke står i dokumentet.

## Tilgang

- **Fra administrasjonen:** øktcookien, med `X-CSRF-Token` på alle kall som endrer noe. Kallet må komme fra nettstedets egen
  opprinnelse.
- **Fra et program eller et skript:** et applikasjonspassord (Profil → Applikasjonspassord) med `Authorization: Basic`, og bare over
  HTTPS. Det virker på alle ruter unntatt `/api/v1/auth`, `/api/v1/me`, `/api/v1/setup` og `/api/v1/admin`. Det kan ikke legge til,
  slette eller endre rollen til brukere, og det gir aldri innlogging i administrasjonen.

## Lister

Lister tar `page` og `per_page`, og svarer med `X-Total-Count` og `X-Total-Pages`. Innholdslisten tar også `include` (se
OpenAPI-dokumentet), som legger forfattere, termer og fremhevet bilde ved hvert element, så klienten slipper ett kall per element.

## Feil

Alle feil har samme form: `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`. `code` er stabil og er det en klient
skal sjekke. `message` kan endres. `requestId` finnes også i loggene, så en feil kan spores fra nettstedet via API-et til jobbene.

## Versjonering

- `v1` endres bare på måter som ikke bryter eksisterende klienter: nye ruter, nye valgfrie felt i forespørsler og nye felt i svar.
  En klient må tåle felt den ikke kjenner.
- Det som bryter, kommer i en ny hovedversjon (`/api/v2/`). Den forrige versjonen lever videre i minst én minor-versjon etter
  det.

## Avvikling

En rute som skal bort, merkes først og fjernes senere:

1. Ruten får `retiring` i koden (`defineRoute`): datoen den ble avviklet, datoen den forsvinner, og ruten som erstatter den.
2. Fra da av har hvert svar fra ruten, også feilsvar, disse headerne:
   - `Deprecation: @<sekunder>` (RFC 9745): når ruten ble avviklet.
   - `Sunset: <HTTP-dato>` (RFC 8594): når den forsvinner.
   - `Link`: til denne regelen (`rel="deprecation"`) og til ruten som erstatter den (`rel="successor-version"`).
3. OpenAPI-dokumentet merker ruten `deprecated` med `x-sunset`.
4. CHANGELOG sier det under «Deprecated» i versjonen som avvikler ruten, og under «Removed» i versjonen som fjerner den.
5. Ruten fjernes tidligst etter minst én minor-versjon og minst seks måneder, og aldri før datoen i `Sunset`.
