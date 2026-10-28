# Sikkerhetskopi

En sikkerhetskopi er én fil, `toascribe-<dato>-<tid>Z-<versjon>.tar.zst`, med databasen, de opplastede filene og et manifest med
en kontrollsum for hver del. Filene ligger i volumet `backups` med modus 0600. **Kopier dem ut av serveren:** en kopi på samme disk
hjelper ikke når disken forsvinner.

«Verktøy → Nettstedshelse» viser når den siste kopien ble tatt, og kontrollpanelet sier fra når den feilet eller er mer enn to
døgn gammel.

## Ta en kopi

```sh
docker compose exec api toa backup create     # en ny kopi nå
docker compose exec api toa backup list       # kopiene som finnes
docker compose exec api toa backup verify <fil>
docker compose exec api toa backup prune --keep 7
```

## Daglig kopi

Sett `TOASCRIBE_CONFIG_DIR` i `.env` til en mappe med `toascribe.toml`:

```toml
[backup]
schedule = true      # én kopi i døgnet, kl. 03.30 UTC
keep = 7             # de sju nyeste beholdes
encrypt = true       # krypter hver kopi med age
recipient = "age1…"  # den offentlige age-nøkkelen
```

Hemmeligheter (krypterings- og signeringsnøkkelen) er ikke med i en kopi, med mindre du ber om det med `--include-secrets`. Det
krever `recipient`, så de aldri lagres ukryptert.

## Ta vare på nøklene

Det databasen lagrer kryptert (SMTP-passordet, hemmelighetene for tofaktor), kan bare leses med nøklene i `.env`. Lag en nøkkelfil
én gang etter installasjonen, og igjen etter `toa secrets rotate`:

```sh
read -rs NOKKEL && printf '%s\n' "$NOKKEL" | docker compose exec -T api toa secrets export --recovery-key-stdin; unset NOKKEL
```

Lim inn gjenopprettingsnøkkelen fra veiviseren når terminalen venter. Filen er kryptert med den nøkkelen. Ta vare på tre ting
utenfor serveren: sikkerhetskopiene, nøkkelfilen og gjenopprettingsnøkkelen.

## Gjenopprett

```sh
docker compose stop api worker
docker compose run --rm migrate toa backup restore <fil> --dry-run   # kontrollerer, endrer ingenting
docker compose run --rm migrate toa backup restore <fil>
docker compose up -d
```

Før du bekrefter, viser gjenopprettingen når og av hvilken versjon kopien ble laget. Den advarer hvis kopien ikke er laget av denne
installasjonen. Gjenopprett da bare hvis du vet hvor filen kommer fra. Nettstedet er i vedlikeholdsmodus mens det pågår.

Flytting til en ny server og feilmeldingene er beskrevet steg for steg i [docs/RESTORE.md](../RESTORE.md).
