# Brukere

«Brukere» viser alle kontoene. Administratoren kan legge til, endre rolle for og slette brukere. Alle kan endre sin egen profil.

## Roller

| Rolle         | Kan                                                                          |
| ------------- | ---------------------------------------------------------------------------- |
| Administrator | Alt: innstillinger, utseende, brukere og alt innhold.                        |
| Redaktør      | Alt innhold, også andres, og alle sider.                                     |
| Forfatter     | Skrive og publisere egne innlegg, og laste opp filer.                        |
| Bidragsyter   | Skrive egne innlegg og sende dem til gjennomgang.                            |
| Abonnent      | Lese og endre egen profil.                                                   |

## Legge til en bruker

«Brukere → Legg til ny»: brukernavn (kan ikke endres senere), e-postadresse og rolle. Velg om brukeren skal få en invitasjon på
e-post, med en lenke for å velge sitt eget passord (lenken gjelder i 24 timer), eller om du setter et passord og gir det videre på
en trygg måte.

## Tilbakestille passord

Velg brukere i listen og «Send tilbakestilling av passord». Hver av dem får en lenke på e-post.

## Slette en bruker

«Slett» ved brukeren. Har brukeren innhold, velger du om det skal slettes eller gis til en annen bruker. Den siste administratoren
kan ikke slettes.

## Profil

«Profil» (også under navnet ditt øverst til høyre):

- **Navn og kontaktinfo:** hvilket navn som vises offentlig. Bytter du e-postadresse, endres den først når du har åpnet lenken som
  sendes til den nye.
- **Profilbilde:** et offentlig bilde fra mediebiblioteket. Uten bilde vises forbokstavene dine.
- **Nytt passord:** de andre øktene dine logges ut.
- **Tofaktorautentisering:** en kode fra en app på telefonen i tillegg til passordet.
- **Økter:** hvor du er logget inn. Logg ut der du ikke kjenner igjen enheten.

## Applikasjonspassord

Et applikasjonspassord lar et program eller et skript bruke API-et som deg, uten ditt vanlige passord. Lag et under «Profil →
Applikasjonspassord» og gi det et navn. Passordet vises **bare én gang**. Det virker bare over HTTPS, gir aldri innlogging i
administrasjonen, og kan ikke endre brukere, roller eller passord. Trekk det tilbake når programmet ikke trenger det lenger.

Hvordan API-et brukes, står i [docs/API.md](../API.md).
