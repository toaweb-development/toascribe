# Installasjon

toascribe kjører i Docker. Serveren trenger bare to filer: `compose.yaml` og `.env`. Resten hentes som ferdige bilder fra
`ghcr.io/toaweb-development`.

## Det du trenger

- En Linux-server med Docker og Compose v2.
- Et domenenavn og en omvendt proxy med TLS (Traefik, nginx eller Caddy) hvis nettstedet skal være på internett.
- En SMTP-server for e-post (glemt passord, invitasjoner, varsler). Den kan settes opp i veiviseren.

## Installer

Velg versjonen du vil installere fra [listen over versjoner](https://github.com/toaweb-development/toascribe/tags), og kjør:

```sh
mkdir toascribe && cd toascribe
version=X.Y.Z
curl -fsSLO "https://raw.githubusercontent.com/toaweb-development/toascribe/v${version}/docker/compose.yaml"
docker compose pull
docker compose run --rm --no-deps -T api toa core gen-env >> .env
echo 'PUBLIC_ORIGIN=https://eksempel.no' >> .env
docker compose up -d
docker compose logs api | grep -o 'https\?://[^ ]*/admin/setup#token=[A-Za-z0-9_-]*'
```

- `docker compose pull` henter bildene først. Uten dem prøver Compose å bygge fra kildekode, og det går ikke uten repoet.
- `toa core gen-env` lager de tre databasepassordene og de to nøklene. **Kjør den bare én gang.** Ta vare på `.env`: uten
  `TOASCRIBE_ENCRYPTION_KEY` kan ikke det som er lagret kryptert, leses igjen.
- `PUBLIC_ORIGIN` er adressen de besøkende bruker. Uten den er adressen `http://localhost:8080`.
- Den siste kommandoen skriver ut adressen til veiviseren, med et engangsnøkkelord etter `#token=`. Et nytt lages ved neste
  omstart av API-et, eller med `docker compose exec api toa core setup-token`.

Andre innstillinger (port, e-post, proxy) står i `.env.example` i samme versjon som `compose.yaml`. Kopier bare linjene du trenger.

## Veiviseren

Åpne adressen fra loggen. Veiviseren har disse stegene:

1. **Oppsettskode:** fylles inn fra adressen. Den gjelder bare dette ene oppsettet.
2. **Systemsjekk:** at databasen og tjenestene rundt er i orden. Det som står som «Må rettes», må rettes før du kan gå videre.
3. **Nettstedet:** tittel, språk og tidssone.
4. **E-post:** SMTP-serveren og avsenderen, med en testmelding. Du kan hoppe over steget og sette det opp senere.
5. **Administrator:** brukernavn, e-postadresse og passord for den første administratoren.
6. **Innhold:** om nettstedet skal få et første innlegg og en første side, slik WordPress gjør.
7. **Fullfør:** installerer og viser **gjenopprettingsnøkkelen**, åtte grupper med fire tegn. Skriv den ned og legg den et trygt
   sted. Den vises bare én gang, og du trenger den for å flytte nettstedet til en ny server.

Etterpå er du logget inn i administrasjonen på `/admin`.

Uten nettleser: `docker compose exec api toa core install` gjør det samme fra kommandolinjen (`toa core install --help`).

## Bak en omvendt proxy

Porten er bundet til `127.0.0.1` som standard. Proxyen sender trafikken dit, og `TOASCRIBE_TRUSTED_PROXY` i `.env` sier hvilken
adresse proxyen har, så nettstedet ser den besøkendes egen adresse. Se «Behind a reverse proxy» i
[README](../../README.md#behind-a-reverse-proxy) for oppsett med nginx og Traefik.

## Etter installasjonen

- Ta vare på nøklene med `toa secrets export`. Se [Sikkerhetskopi](sikkerhetskopi.md).
- Slå på daglig sikkerhetskopi i `toascribe.toml`.
- Se «Verktøy → Nettstedshelse» og «Kontrollpanel»: det som bør rettes, står der.
