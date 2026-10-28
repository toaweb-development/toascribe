# Gjenoppretting

Slik får du toascribe tilbake fra en sikkerhetskopi, på samme server eller på en ny. Kommandoene kjøres i mappen med
`compose.yaml` (i et klonet repo: `docker compose -f docker/compose.yaml …`).

## Det du trenger

- **Sikkerhetskopien**, en fil `toascribe-<dato>-<versjon>.tar.zst` (eller `.tar.zst.age` hvis den er kryptert). Den inneholder
  databasen, opplastede filer og et manifest med kontrollsum for hver del. Kopiene ligger i volumet `backups`; kopier dem ut av
  serveren jevnlig.
- **Gjenopprettingsnøkkelen** som veiviseren viste da nettstedet ble installert (åtte grupper med fire tegn). Den lagres aldri på
  serveren, bare et kontrolltall for den.
- **Nøkkelfilen** fra `toa secrets export`, hvis du flytter til en ny server. Uten den kan ikke den nye serveren lese det som er lagret
  kryptert (SMTP-passordet og hemmelighetene for tofaktor).
- **age-nøkkelen** (`AGE-SECRET-KEY-1…`) hvis kopien er kryptert (`encrypt = true` eller `--include-secrets` i `toascribe.toml`).

## Før noe går galt: ta vare på nøklene

Kjør dette én gang etter installasjonen, og igjen når du har rotert nøklene (`toa secrets rotate`):

```sh
read -rs NOKKEL && printf '%s\n' "$NOKKEL" | docker compose exec -T api toa secrets export --recovery-key-stdin; unset NOKKEL
```

Lim inn gjenopprettingsnøkkelen når terminalen venter (den vises ikke), og trykk Enter. Slik havner nøkkelen aldri i en fil eller i
historikken. Kommandoen skriver en fil `toascribe-secrets-<tid>.json` med modus 0600 i volumet `backups`. Den er kryptert med
gjenopprettingsnøkkelen og avviser en nøkkel som ikke hører til denne installasjonen. Ingen verdi skrives til skjermen. Kopier filen
ut av serveren sammen med sikkerhetskopiene (`toa backup list` viser den ikke, og `prune` sletter den ikke).

## Gjenopprette på samme server

Bruk dette når databasen eller filene er ødelagt, men `.env` er i behold.

1. Se hvilke kopier som finnes: `docker compose exec api toa backup list`.
2. Stopp API-et og arbeideren, slik at ingen skriver mens du gjenoppretter:
   `docker compose stop api worker`.
3. Prøv kopien først: `docker compose run --rm migrate toa backup restore <fil> --dry-run`.
   Den kontrollerer hele filen mot manifestet og endrer ingenting. Den viser også hvor kopien kommer fra: når og av hvilken versjon
   den ble laget, og vertsnavnet til containeren som laget den (et tilfeldig navn som skifter når containeren lages på nytt). Står
   det en advarsel om at kopien ikke er laget av denne installasjonen, gjenoppretter du den bare hvis du vet hvor den kommer fra.
   Ingen advarsel er ikke et bevis: lista over kopier ligger i databasen som appen selv skriver til, og kontrollsummene viser at
   filen er hel, ikke hvem som laget den. Signerte kopier kommer i fase 2. Etter en gjenoppretting gjelder lista slik den var da
   kopien ble tatt, så kopier som er laget senere, kan gi advarselen selv om de ble laget her.
4. Gjenopprett: `docker compose run --rm migrate toa backup restore <fil>` (skriv «gjenopprett» når du blir spurt), eller legg til
   `--yes` i et skript. En kryptert kopi trenger `--identity <fil med age-nøkkelen>`, montert inn i containeren.
5. Start igjen: `docker compose up -d`.

Under gjenopprettingen er nettstedet i vedlikeholdsmodus. Den slås av igjen når gjenopprettingen er ferdig, også hvis den feiler.
En kopi fra en eldre versjon migreres opp. En kopi fra en nyere versjon avvises: oppdater toascribe først.

## Flytte til en ny server

1. Installer Docker på den nye serveren og hent `compose.yaml` for samme versjon som kopien (eller nyere). Se README, «Installer uten
   å klone repoet».
2. Lag nye databasepassord, uten nøkler (de kommer fra nøkkelfilen i neste steg):
   `docker compose run --rm --no-deps -T api toa core gen-env --passwords-only >> .env`.
3. Legg nøklene fra den gamle serveren inn i `.env`. Nøkkelfilen ligger på verten; den sendes inn på standard input etter
   gjenopprettingsnøkkelen, så den aldri må kopieres inn i en container:

   ```sh
   read -rs NOKKEL && { printf '%s\n' "$NOKKEL"; cat toascribe-secrets-<tid>.json; } | docker compose run --rm --no-deps -T api toa secrets import - --recovery-key-stdin >> .env; unset NOKKEL
   ```

   Kommandoen skriver nøklene som `.env`-linjer. **Avslutt alltid med `>> .env`.** Kommandoen nekter å skrive til en terminal, men
   gjennom `docker compose … -T` ser den bare containerens egen utdata. Glemmer du `>> .env`, havner nøklene på skjermen og i
   historikken til terminalen. En feil nøkkel eller en endret fil avvises, og da skrives ingenting.
4. Legg sikkerhetskopien i volumet `backups`. Send den inn på standard input, så filen eies av appens bruker og kan leses:
   `docker compose run --rm --no-deps -T migrate sh -c 'cat > /var/lib/toascribe/backups/<fil>' < <fil>`.
5. Start databasen og gjenopprett: `docker compose up -d postgres`, så `docker compose run --rm migrate toa backup restore <fil>`.
   Her viser gjenopprettingen alltid advarselen om at kopien ikke er laget av denne installasjonen. Det er ventet: den nye serveren
   har ikke laget noen kopier ennå.
6. Start alt: `docker compose up -d`. Sett `PUBLIC_ORIGIN` i `.env` hvis adressen er ny. Interne lenker følger med, så det trengs
   ikke noe søk-og-erstatt.

## Når noe ikke stemmer

- **«The backup is from toascribe X, newer than this one»:** oppdater toascribe på serveren først.
- **«does not match its sha256»:** filen er skadet. Bruk en annen kopi.
- **«The recovery key does not open this file»:** feil gjenopprettingsnøkkel, eller filen er endret.
- **Etter flytting kan ingen logge inn med tofaktor, eller e-post sendes ikke:** nøklene i `.env` er ikke de gamle. Kjør
  `toa secrets import` på nytt, og start API-et og arbeideren.
