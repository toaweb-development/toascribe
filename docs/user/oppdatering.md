# Oppdatering

«Kontrollpanel → Oppdateringer» viser hvilken versjon som kjører, og om en nyere finnes. Arbeideren spør ghcr.io én gang i døgnet
etter publiserte versjoner og sender ingenting om nettstedet. Sjekken kan slås av på skjermen, eller for hele serveren med
`TOASCRIBE_UPDATE_CHECK=off` i `.env`.

Administrasjonen kan ikke oppdatere seg selv: bildene byttes på serveren.

## Oppdater

1. Les endringene for den nye versjonen i `CHANGELOG.md` (lenken står på «Oppdateringer»).
2. Ta en sikkerhetskopi: `docker compose exec api toa backup create`.
3. Hent den nye versjonen. Har du hentet `compose.yaml` fra en versjon, henter du den nye på samme måte:

   ```sh
   version=X.Y.Z
   curl -fsSLO "https://raw.githubusercontent.com/toaweb-development/toascribe/v${version}/docker/compose.yaml"
   ```

   Eller sett `TOASCRIBE_VERSION=X.Y.Z` i `.env`.
4. Start den nye versjonen:

   ```sh
   docker compose pull
   docker compose up -d
   ```

Tjenesten `migrate` kjører databaseendringene før API-et og arbeideren starter. Har nettstedet innhold og en endring venter, tar
den en sikkerhetskopi først og stopper hvis kopien feiler. `toa core update --no-backup` hopper over kopien, med en advarsel.

## Hvis noe går galt

- `docker compose logs migrate` viser hvorfor migreringen stoppet. Nettstedet starter ikke før den er ferdig.
- En sikkerhetskopi fra en nyere versjon kan ikke gjenopprettes i en eldre. Gå derfor ikke tilbake til en eldre versjon etter
  at migreringen har kjørt. Rett feilen og prøv igjen, eller vent på en ny versjon.
- Versjonen i et bilde endres aldri: en rettelse kommer alltid som en ny versjon.
