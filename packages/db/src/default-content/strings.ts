// WordPress' default content (`wp_install_defaults()` in wp-admin/includes/upgrade.php and
// `WP_Privacy_Policy_Content::get_default_content()`, WordPress 7.1.3) as data, one entry per locale. The English strings
// are WordPress' msgids; the bokmål strings are the msgstr values of WordPress' nb_NO translation (translate.wordpress.org,
// projects wp/dev and wp/dev/admin, locale nb, PO-Revision-Date 2026-10-08, read 2026-10-23), copied verbatim (Tor: «samme
// tekst som den norske oversettelsen»), typos included, with one exception:
//
// - The privacy policy's «&lauot;Husk meg&raquot;» is «Husk meg» between real guillemets. `&lauot;` is no HTML entity
//   and shows as typed, and `&raquot;` shows as «»t;» (browsers read the legacy `&raquo` without its semicolon), so the
//   upstream text renders as garbage. The rest of the translation writes « » as characters («hash»), so this does too.
//
// Kept as upstream: «forskjellig fra ert innlegg», «har vært levert kvalitetsduppeditter», «Pi&#241;a colada», and the
// missing full stop after the site address in «Vår nettstedsadresse er: %s».
//
// `%s` marks the one value WordPress fills in with sprintf(); markup.ts fills it. The slugs are what WordPress stores:
// the category and post slugs go through sanitize_title(), the page slugs are the raw translation (so «æ» stays).
// The markup is built from these strings in markup.ts exactly as WordPress concatenates it.

/** One heading of the suggested privacy policy and its paragraphs. */
export interface PrivacyPolicySection {
  readonly heading: string
  readonly paragraphs: readonly string[]
}

export interface DefaultContentStrings {
  readonly categoryName: string
  readonly categorySlug: string
  readonly postTitle: string
  readonly postSlug: string
  /** The first post's only paragraph. */
  readonly postText: string
  readonly commentAuthor: string
  /** The comment author's website (WordPress' localised home page). */
  readonly commentAuthorUrl: string
  /** The `%s` of `commentText`. */
  readonly gravatarUrl: string
  /** Plain text with two line breaks; `%s` is the Gravatar URL. */
  readonly commentText: string
  readonly samplePageTitle: string
  readonly samplePageSlug: string
  /** Five paragraphs: intro, quote, «...or something like this:», quote, and the last one, whose `%s` is the admin URL. */
  readonly samplePageParagraphs: readonly [string, string, string, string, string]
  readonly privacyPolicyTitle: string
  readonly privacyPolicySlug: string
  /** «Suggested text:», which starts the first paragraph of every section. */
  readonly suggestedText: string
  /** Nine sections; the first paragraph of the first one has `%s` for the site URL. */
  readonly privacyPolicySections: readonly PrivacyPolicySection[]
}

/** The first comment's e-mail address (not translated). */
export const DEFAULT_COMMENT_AUTHOR_EMAIL = 'wapuu@wordpress.example'

/** WordPress' own strings, used for every locale that has no translation here. */
const en: DefaultContentStrings = {
  categoryName: 'Uncategorized',
  categorySlug: 'uncategorized', // sanitize_title() of the «Default category slug» translation
  postTitle: 'Hello world!',
  postSlug: 'hello-world', // sanitize_title() of the «Default post slug» translation
  postText: 'Welcome to WordPress. This is your first post. Edit or delete it, then start writing!',
  commentAuthor: 'A WordPress Commenter',
  commentAuthorUrl: 'https://wordpress.org/',
  gravatarUrl: 'https://gravatar.com/',
  commentText:
    'Hi, this is a comment.\nTo get started with moderating, editing, and deleting comments, please visit the Comments screen in the dashboard.\nCommenter avatars come from <a href="%s">Gravatar</a>.',
  samplePageTitle: 'Sample Page',
  samplePageSlug: 'sample-page',
  samplePageParagraphs: [
    "This is an example page. It's different from a blog post because it will stay in one place and will show up in your site navigation (in most themes). Most people start with an About page that introduces them to potential site visitors. It might say something like this:",
    "Hi there! I'm a bike messenger by day, aspiring actor by night, and this is my website. I live in Los Angeles, have a great dog named Jack, and I like pi&#241;a coladas. (And gettin' caught in the rain.)",
    '...or something like this:',
    'The XYZ Doohickey Company was founded in 1971, and has been providing quality doohickeys to the public ever since. Located in Gotham City, XYZ employs over 2,000 people and does all kinds of awesome things for the Gotham community.',
    'As a new WordPress user, you should go to <a href="%s">your dashboard</a> to delete this page and create new pages for your content. Have fun!',
  ],
  privacyPolicyTitle: 'Privacy Policy',
  privacyPolicySlug: 'privacy-policy',
  suggestedText: 'Suggested text:',
  privacyPolicySections: [
    { heading: 'Who we are', paragraphs: ['Our website address is: %s.'] },
    {
      heading: 'Comments',
      paragraphs: [
        'When visitors leave comments on the site we collect the data shown in the comments form, and also the visitor&#8217;s IP address and browser user agent string to help spam detection.',
        'An anonymized string created from your email address (also called a hash) may be provided to the Gravatar service to see if you are using it. The Gravatar service privacy policy is available here: https://automattic.com/privacy/. After approval of your comment, your profile picture is visible to the public in the context of your comment.',
      ],
    },
    {
      heading: 'Media',
      paragraphs: [
        'If you upload images to the website, you should avoid uploading images with embedded location data (EXIF GPS) included. Visitors to the website can download and extract any location data from images on the website.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'If you leave a comment on our site you may opt-in to saving your name, email address and website in cookies. These are for your convenience so that you do not have to fill in your details again when you leave another comment. These cookies will last for one year.',
        'If you visit our login page, we will set a temporary cookie to determine if your browser accepts cookies. This cookie contains no personal data and is discarded when you close your browser.',
        'When you log in, we will also set up several cookies to save your login information and your screen display choices. Login cookies last for two days, and screen options cookies last for a year. If you select &quot;Remember Me&quot;, your login will persist for two weeks. If you log out of your account, the login cookies will be removed.',
        'If you edit or publish an article, an additional cookie will be saved in your browser. This cookie includes no personal data and simply indicates the post ID of the article you just edited. It expires after 1 day.',
      ],
    },
    {
      heading: 'Embedded content from other websites',
      paragraphs: [
        'Articles on this site may include embedded content (e.g. videos, images, articles, etc.). Embedded content from other websites behaves in the exact same way as if the visitor has visited the other website.',
        'These websites may collect data about you, use cookies, embed additional third-party tracking, and monitor your interaction with that embedded content, including tracking your interaction with the embedded content if you have an account and are logged in to that website.',
      ],
    },
    {
      heading: 'Who we share your data with',
      paragraphs: ['If you request a password reset, your IP address will be included in the reset email.'],
    },
    {
      heading: 'How long we retain your data',
      paragraphs: [
        'If you leave a comment, the comment and its metadata are retained indefinitely. This is so we can recognize and approve any follow-up comments automatically instead of holding them in a moderation queue.',
        'For users that register on our website (if any), we also store the personal information they provide in their user profile. All users can see, edit, or delete their personal information at any time (except they cannot change their username). Website administrators can also see and edit that information.',
      ],
    },
    {
      heading: 'What rights you have over your data',
      paragraphs: [
        'If you have an account on this site, or have left comments, you can request to receive an exported file of the personal data we hold about you, including any data you have provided to us. You can also request that we erase any personal data we hold about you. This does not include any data we are obliged to keep for administrative, legal, or security purposes.',
      ],
    },
    {
      heading: 'Where your data is sent',
      paragraphs: ['Visitor comments may be checked through an automated spam detection service.'],
    },
  ],
}

/** WordPress' nb_NO translation (bokmål). */
const nb: DefaultContentStrings = {
  categoryName: 'Ukategorisert',
  categorySlug: 'ukategorisert', // sanitize_title() of the «Default category slug» translation
  postTitle: 'Hei, verden!',
  postSlug: 'hei-verden', // sanitize_title() of the «Default post slug» translation
  postText: 'Velkommen til WordPress. Dette er ditt første innlegg. Rediger det eller slett det og start skrivingen!',
  commentAuthor: 'En WordPress-kommentator',
  commentAuthorUrl: 'https://nb.wordpress.org/',
  gravatarUrl: 'https://nb.gravatar.com/',
  commentText:
    'Hei, dette er en kommentar.\nFor å starte med moderering, redigering og sletting av kommentarer, gå til Kommentar-skjermen i kontrollpanelet.\nKommentator-avatarer kommer fra <a href="%s">Gravatar</a>.',
  samplePageTitle: 'Testside',
  samplePageSlug: 'testside',
  samplePageParagraphs: [
    'Dette er en eksempelside. Den er forskjellig fra ert innlegg fordi det vil forbli på samme plass og vil vises i navigasjonsmenyen (i de fleste tema). De fleste starter med en Om-side som introduserer dem for mulige besøkende. Den kan si noe omtrent som følger:',
    'Hei der! Jeg er et sykkelbud om dagen, fremadstormende skuespiller om natten, og dette er min blogg. Jeg bor i Oslo, har en stor hund som heter Kim Roger, og jeg liker Pi&#241;a colada. (Og å skrive rare kommentarer til nettnyheter.)',
    '...eller noe slikt som dette:',
    'Selskapet XYZ ble stiftet i 1971, og har vært levert kvalitetsduppeditter siden da. Ligger i Kristiansund, og sysselsetter over 2000 mennesker som gjør alle slags bra ting for samfunnet.',
    'Som ny WordPress-bruker bør du gå til <a href="%s">ditt kontrollpanel</a> for å slette denne siden og lage en ny side med ditt innhold. Ha det gøy!',
  ],
  privacyPolicyTitle: 'Personvernerklæring',
  privacyPolicySlug: 'personvernerklæring',
  suggestedText: 'Foreslått tekst:',
  privacyPolicySections: [
    { heading: 'Hvem vi er', paragraphs: ['Vår nettstedsadresse er: %s'] },
    {
      heading: 'Kommentarer',
      paragraphs: [
        'Når besøkende legger inn kommentarer på siden, lagres informasjonen gitt inn i kommentarskjemaet i tillegg til IP-adressen til den besøkende og den besøkendes nettleserversjon. Dette gjøres for å bidra til å unngå useriøse kommentarer.',
        'En anonym tekststreng generert på grunnlag av e-postadressen din (også kalt en «hash») kan bli sendt til tjenesten Gravatar for å undersøke om du har en konto der. Personvernerklæringen til Gravatar ligger her: https://automattic.com/privacy/. Etter at kommentaren din er blitt godkjent, vil profilbildet ditt være synlig for hvem som helst i forbindelse med kommentaren din.',
      ],
    },
    {
      heading: 'Media',
      paragraphs: [
        'Hvis du laster opp bilder til nettstedet, bør du unngå å laste opp bilder som inneholder informasjon om stedet det er tatt (EXIF GPS). Besøkende på siden kan laste ned og hente ut slik informasjon fra bilder på siden.',
      ],
    },
    {
      heading: 'Informasjonskapsler',
      paragraphs: [
        'Hvis du legger inn en kommentar på dette nettstedet, kan du be oss om å huske navn, e-post og nettsted. Denne informasjonen lagres i en informasjonskapsel og er der for å gjøre ting lettere for deg. Du trenger da ikke å gi inn denne informasjonen på nytt neste gang du legger inn en kommentar. Disse informasjonskapslene utløper etter ett år.',
        'Om du besøker vår innloggingsside, vil vi opprette en midlertidig informasjonskapsel for å avgjøre om nettleseren din aksepterer informasjonskapsler. Denne informasjonskapselen inneholder ingen personopplysninger og forsvinner så snart du lukker nettleseren din.',
        'Når du logger deg inn, blir det opprettet informasjonskapsler som lagrer innloggingsinformasjonen din og valg du har tatt når det gjelder hvordan innhold skal vises. Informasjonskapsler med innloggingsinformasjon utløper etter to dager, mens de med visningsvalg varer i ett år. Hvis du krysser av for «Husk meg», vil innloggingsinformasjonen din oppbevares i to uker. Hvis du logger deg ut av kontoen din, vil disse informasjonskapslene forsvinne.',
        'Hvis du redigerer eller publiserer en artikkel, vil ytterligere en informasjonskapsel bli lagret i nettleseren din. Denne informasjonskapselen inneholder ingen personopplysninger, men bare ID-en til artikkelen du nettopp redigerte. Den utløper etter én dag.',
      ],
    },
    {
      heading: 'Innebygd innhold fra andre nettsteder',
      paragraphs: [
        'Artikler på denne siden kan inkludere innebygd innhold (f.eks. videoer, bilder, artikler osv.). Innebygd innhold fra andre nettsteder oppfører seg på nøyaktig samme måte som om den besøkende hadde besøkt nettstedet som det innebygde innholdet kommer fra.',
        'Disse nettstedene kan samle inn opplysninger om deg, bruke informasjonskapsler, bygge inn sporingssystemer fra tredjeparter og overvåke hva du gjør via dette innebygde innholdet. Dette omfatter også sporing av handlingene dine via det innebygde innholdet dersom du har en konto og er logget inn på nettstedet.',
      ],
    },
    {
      heading: 'Hvem vi deler dine opplysninger med',
      paragraphs: ['Om du ber om tilbakestilling av passord vil din IP-adresse tas med i e-post om tilbakestilling.'],
    },
    {
      heading: 'Hvor lenge vi oppbevarer opplysninger om deg',
      paragraphs: [
        'Hvis du legger igjen en kommentar, blir kommentaren og informasjon om kommentaren lagret på ubestemt tid. Dette er for at vi kan gjenkjenne oppfølgingskommentarer og godkjenne dem automatisk i stedet for å legge dem i en kø der de må godkjennes manuelt av en redaktør.',
        'For brukere som registrerer seg på dette nettstedet (dersom denne muligheten eksisterer), lagres det også personopplysninger som de oppgir i brukerprofilen sin. Alle brukere kan se, redigere og slette sine egne personopplysninger når som helst (bortsett fra brukernavn). Nettstedets administratorer kan også se og redigere denne informasjonen.',
      ],
    },
    {
      heading: 'Rettighetene dine når det gjelder opplysninger om deg',
      paragraphs: [
        'Hvis du har en konto på dette nettstedet eller har lagt igjen kommentarer, kan du be om å få en eksportfil som inneholder personopplysningene vi har om deg. Dette omfatter all data du har gitt oss. Du kan også be om at vi sletter alle personopplysninger vi har om deg. Dette omfatter ikke opplysninger vi er pålagt å lagre av administrative, juridiske eller sikkerhetsmessige årsaker.',
      ],
    },
    {
      heading: 'Hvor dine opplysninger sendes',
      paragraphs: [
        'Besøkendes kommentarer kan bli kontrollert gjennom en automatisk gjenkjennelsestjeneste mot søppelkommentarer.',
      ],
    },
  ],
}

/** The locales that have their own strings. Any other locale gets the English ones. */
export const DEFAULT_CONTENT_STRINGS = { en, nb } as const satisfies Readonly<Record<string, DefaultContentStrings>>
export type DefaultContentLocale = keyof typeof DEFAULT_CONTENT_STRINGS

/** The strings for a BCP 47 tag: the tag itself, then its language (nb-NO → nb), then English. */
export function defaultContentStrings(locale: string): DefaultContentStrings {
  const language = locale.split('-')[0] ?? locale
  if (language === 'nb') {
    return DEFAULT_CONTENT_STRINGS.nb
  }
  return DEFAULT_CONTENT_STRINGS.en
}
