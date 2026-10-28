# Innstillinger

«Innstillinger» gjelder hele nettstedet, og bare administratorer ser dem. Hver skjerm lagres med «Lagre endringer».

## Generelt

Nettstedstittel, slagord, administrator-e-postadressen, om hvem som helst kan registrere seg og hvilken rolle nye brukere får,
nettstedsspråk, tidssone og formatene for dato og tid. Adressen til nettstedet settes med `PUBLIC_ORIGIN` på serveren. En ny
administratoradresse tas i bruk først når lenken som sendes dit, er åpnet.

Registreringsskjemaet har vern mot spam: det godtar ikke skjemaer som sendes inn i løpet av de første sekundene, eller der et
skjult felt er fylt ut.

## Skriving

Standardkategorien og standardformatet for nye innlegg.

## Lesing

- Hva forsiden viser: de siste innleggene eller en statisk side, og hvilken side som er innleggssiden.
- Antall innlegg per side og i RSS-strømmen, og om strømmen har hele teksten eller et utdrag.
- **Søkemotorsynlighet:** be søkemotorer om ikke å indeksere nettstedet.
- **Deling og søkemotorer:** standard delingsbilde, og om nettstedet representerer en organisasjon eller en person.

## Media

Målene på bildestørrelsene (og «Lag bildestørrelser på nytt» for bilder som alt er lastet opp), største filstørrelse og antall piksler, og hvilke filtyper hver rolle kan laste opp.

## Permalenker

Hvordan adressene til innleggene ser ut, og prefiksene for kategori- og stikkordadressene. Gamle adresser sendes videre til de
nye, så lenker som er delt, virker fortsatt.

## Personvern

- **Personvernside:** lenkes i bunnteksten og på registreringsskjemaet.
- **Innbygginger:** last inn innhold fra YouTube, Vimeo og andre tjenester først når leseren klikker, og hvilke Mastodon-instanser
  innlegg kan bygges inn fra.
- **Sikkerhet:** kontakt for sikkerhetsfeil og en side med sikkerhetsregler. Nettstedet viser dem på `/.well-known/security.txt`.
- **Gravatar:** vis bilder fra Gravatar for brukere uten eget profilbilde. Det er av som standard, fordi nettleseren da henter
  bilder fra en tjeneste utenfor nettstedet.

## På serveren

Noe settes i `.env` og ikke i administrasjonen: adressen (`PUBLIC_ORIGIN`), e-post (`SMTP_*`; det som ble lagret i veiviseren, går foran),
proxy, nøkler og grenser. `.env.example` i samme versjon som `compose.yaml` lister alle.
