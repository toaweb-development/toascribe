# Changelog

All notable changes to this project are documented here, newest first. Versioning:
[SemVer](https://semver.org/spec/v2.0.0.html). From the next release on, each release is one heading `## X.Y.Z — YYYY-MM-DD`
(a long dash, an ISO date) with plain bullets under it, written for the people who run toascribe (VERSIONING_STANDARD_2026 §2);
`scripts/release.sh` refuses to release without it. The notes collect under `## [Unreleased]` until then. The sections below
that heading keep the format they were written in (Keep a Changelog).

## [Unreleased]

Posts and pages (M1.1): the content API and the lists «Alle innlegg» and «Alle sider». One migration (`0007_content_api`): three
indexes for the scheduler and the trash, and the removal of the editor prototype's per-account drafts.

Categories, tags and the media library (M1.2). Two migrations: `0008_media_library` (the file name, the processing state and an
index for the lookup of a size's file) and `0009_media_processing_attempts` (the worker's tries per file). New settings:
`upload_max_size_mb` (64), `image_max_pixels` (100 million) and `upload_groups_by_role`. New environment variable
`TOASCRIBE_UPLOAD_MAX_SIZE_MB` (64): the largest upload request in MiB, in the proxy and the api alike (a file can be 64 KiB
less, the rest of the form); the setting cannot go above it. The api and the worker share a new volume, `uploads`. New dependencies: `sharp` (in the
worker only), `file-type` and `image-size`.

### Added

- Categories and tags (M1.2): «Innlegg → Kategorier» and «Innlegg → Stikkord» (`manage_categories`), with the form on the left
  and the list on the right, search, Rediger, Hurtigrediger, Slett and bulk delete; categories have a parent. «Ukategorisert» is
  the default category: it can be renamed, not deleted. Deleting a category works as in WordPress: its child categories
  move up to its parent, and a post left without any category gets «Ukategorisert». Slugs are made as WordPress makes them, also for Norwegian letters.
- The terms API under `/api/v1/taxonomies` and `/api/v1/taxonomies/{taxonomy}/terms`, and categories and tags in the content API.
  The post list has the columns «Kategorier» and «Stikkord» as filter links and a category filter; quick edit has the category
  tree and the tags as text; bulk «Rediger» can add categories and tags.
- The media library (M1.2): «Media → Bibliotek» as a grid or a list, filtered by type, month and folder, with search and folders;
  «Vedleggsdetaljer» with the alternative text, title, caption, description, visibility, folder, «Kopier URL til
  utklippstavlen» and «Brukes på» (the posts and pages you may read by name, the rest as «og N andre»); Erstatt (a new file under
  the same id, once the worker is done with it), Rediger bilde (turn, mirror, crop, scale; the original is kept), Lag
  bildestørrelser på nytt and Slett permanent with a warning that names where the file is used. Everyone who may upload can make
  folders and put files in them; renaming, moving and deleting a folder needs `edit_others_posts`.
- «Media → Legg til ny» and the library's uploader: drag and drop or choose files, each with its progress, the largest size and
  the allowed types shown; «Sett inn fra nettadresse» fetches a file into the library and refuses private addresses.
- The image sizes of WordPress, made by the worker as WebP: thumbnail (150 × 150, cropped), medium (300), medium_large (768),
  large (1024), 1536 and 2048, and a `-scaled` copy of an image over 2560 pixels; the original is kept. `toa media regenerate`
  makes them again. Every run gives them new file names, so a cached copy of an old size is never shown for a new one. An image
  the worker cannot handle is tried three times, then marked «Feilet» in the library with the reason; «Lag bildestørrelser på
  nytt» tries again.
- «Innstillinger → Media»: the three image sizes and the thumbnail crop, the year and month folders, the upload limit, the pixel
  limit and which types each role may upload.
- The media API under `/api/v1/media` and `/api/v1/media-folders`, and `/api/v1/settings/media`. An upload's type is read from
  its bytes and must agree with its name; SVG, HTML, scripts and programs are never accepted. Files are served with `nosniff`
  and a sandbox Content-Security-Policy, and a file that is not an image as a download. A file made private moves to new
  addresses, so a copy a cache holds of its public address is never served again. A private file has no public address: it is served by the api to its uploader
  and to those who may read private posts.
- The image block stores the file's id from the library, with the alternative text (required unless the image is marked
  decorative) and the caption, and is drawn with `srcset` and `sizes` from the file's sizes. Image blocks with an address from
  before are upgraded to the file's id when the file is in the library.
- The users list takes `per_page` and answers with `X-Total-Count` and `X-Total-Pages`.

- The content API under `/api/v1/content`: list posts or pages (views, author, search, month, sort, pages, `X-Total-Count` and
  `X-Total-Pages`), make, read, change and delete them, publish, move to the trash and restore, bulk actions, and the list of
  possible authors. Who may do what follows WordPress: posts and pages have their own capabilities, own and others' items,
  published and not, and a contributor can send for review but not publish.
- Statuses as in WordPress: draft, pending, scheduled, published, private and trash. A scheduled item is published, and a
  published item with an unpublish time goes back to draft, by a job in the worker every minute; each change happens once, also
  with two workers. The trash is emptied after 30 days, and a restored item gets its old status back.
- Slugs as WordPress makes them (`Blåbær på Ørland` becomes `blabaer-pa-orland`), unique per type, language and parent with
  `-2`, `-3` when taken; a trashed item's slug gets `__trashed` until it is restored.
- Short links (`/?p=<number>`) in every answer, several authors per item, password protection (the password is stored hashed and
  can be replaced, not read), private items, sticky posts, and the parent, order and template of pages.
- Search finds text in the title, the excerpt and the blocks; the blocks are checked against their `block.json` on every save.
- The admin menu has «Innlegg» (Alle innlegg, Legg til nytt) and «Sider» (Alle sider, Legg til ny). The lists have the views with
  their counts, a month filter, search, sorting, pages, child pages under their parent, row actions (Rediger, Hurtigredigering,
  Papirkurv, Forhåndsvis; in the trash Gjenopprett and Slett permanent), quick edit, bulk actions (Rediger, Flytt til
  papirkurven, Gjenopprett, Slett permanent, Tøm papirkurven) and «Skjermalternativer» for the columns and the number per page,
  saved with the account.
- «Legg til nytt» and «Rediger» open the block editor on the post or page, with a title field, «Lagre utkast» and «Publiser».
  «Forhåndsvis» shows the item drawn from its blocks.

### Changed

- «I korte trekk» on the dashboard counts published posts and pages with the content API, and links to the lists.
- Content routes check the right of the type: a role with only `edit_pages` can work with pages (M1.2).
- Words of the admin now follow WordPress' Norwegian translation (nb_NO), among them «Kladd», «Hurtigrediger»,
  «Visningsinnstillinger», «Identifikator», «Masserediger», «Gjør om» and «Vis nettsted».
- Releases follow toa-rules 5.0 (release-only): `scripts/release.sh X.Y.Z` runs `pnpm release:check` and the audit, writes the
  version, tags and pushes `main` and the tag in one push. The tag only builds, scans and publishes the images: there is no
  GitHub Release any more, so an installation without a clone takes `docker/compose.yaml` from the release tag (README,
  «Installer uten å klone repoet»). No git hook is required; the weekly audit workflow, Dependabot and commitlint are gone.

### Removed

- The editor prototype's own page, its preview and its per-account draft endpoints; the editor now saves real posts and pages.
  The prototype's image upload is gone too (M1.2): images come from the media library.
- Images from another address in the editor: they will be brought into the media library first (M1.2). The admin no longer lets
  images in from other hosts on any page.

## [0.6.0] - 2026-10-26

The last milestone of phase 0: a prototype of the block editor, to answer whether the editor model in the plan holds before
phase 1 is estimated. The answer, the experiences and the estimate are in `docs/decisions/0001-editor-model.md`. The prototype is
reached at `/admin/editor-prototype` (not in the menu) and goes away when the real content API and editor come (M1.1–M1.3).
There is no migration and no new setting or environment variable.

### Added

- The block format (`@toascribe/blocks`): blocks stored as `{ id, type, version, attrs, children }`, a `block.json` for the
  paragraph, image, columns and column blocks, and one validation that the editor and the api share. Rich text is stored as data
  (text with bold, italic, code and links, and line breaks), never as HTML; links may only point to `http:`, `https:`, `mailto:`,
  a path on the site or an anchor.
- The editor prototype at `/admin/editor-prototype` (accounts that can edit posts): paragraphs with their own formatting,
  images from an upload or an https address with alt text and a caption, and 2–4 columns. Blocks are added with the «/» menu or
  «+», moved with buttons or Alt+Shift+Up/Down (also into and out of columns), deleted, split with Enter and joined or removed
  with Backspace. Undo and redo (Ctrl+Z, Ctrl+Shift+Z) cover typing, formatting, inserting, moving and deleting in one history
  for the whole document. Everything works from the keyboard.
- `/admin/editor-prototype/preview`: the saved draft as HTML rendered on the server from the stored blocks, without the editor.
- Prototype endpoints under `/api/v1/prototype/editor`: read and save the signed-in account's own draft (`edit_posts`; the
  blocks are checked against their `block.json` and refused with `invalid_blocks` and the list of problems), and image uploads
  (`upload_files`; PNG, JPEG, GIF or WebP found from the file's bytes, kept in the api's temporary folder, at most 50, gone after
  a restart).

### Changed

- The audit entry for a test mail that went through names the account that asked by its id, so it stays right if the
  username is changed before the mail is sent.
- `docs/PLAN.md`: only the Administrator has `unfiltered_html` by default (as decided in 0.3.0).
- **Releases come from a tag.** A release now starts when the maintainer pushes a tag `vX.Y.Z`; merging into `main` no
  longer releases anything, and the release workflow no longer creates the tag. The version is raised once per release in a
  `chore(release)` commit, and changes are collected under «Unreleased» in this file until then. A release can be run again
  with the same tag; the images and the release that already exist are left as they are.
- **CI is replaced by local checks.** No workflow runs on a push or a pull request. `pnpm check` runs before every push, and
  `pnpm release:check` runs everything CI used to do before a release, on the maintainer's machine: the workflow check, the
  dependency audit, the database and e-mail tests, the image build, the image scan, the stack started from the scanned images
  with the route checks around `toa core install`, a dry run of the publishing, and the end-to-end tests. The dependency audit
  also runs weekly on GitHub. Dependabot proposes version updates once a month, one batch per ecosystem; security updates
  still come at once.

### Security

- The two editor prototype pages allow images from any https address in their Content Security Policy; every other admin page
  still allows only its own images.
- **The release workflow is split into three jobs.** The job that builds and scans the images can only read the repository.
  Only the job that publishes can write packages, and it runs no third-party code: it takes the scanned images from the build
  as a checked artifact and publishes each one by the digest that was scanned, so what is published is what was scanned. The
  GitHub Release is made by a third job. All of them run on GitHub's own runners.

## [0.5.0] - 2026-10-24

The admin shell: after login the admin now has a menu, a top bar, a dashboard, a profile page and a users list, in place of
the empty page that came before. The repository has moved to `github.com/toaweb-development/toascribe`, and the images are
now published as `ghcr.io/toaweb-development/toascribe-*`. **On upgrade, download the new `compose.yaml`** (or change the
`image:` names in yours): 0.4.1 was the last version published under `ghcr.io/toaweb/`. There is no migration and no new
setting or environment variable; the account preferences are stored in a column that already existed.

### Added

- The admin shell. A sidebar menu with WordPress' positions and icons, drawn from a registry on the server
  (`GET /api/v1/admin/menu`) that leaves out what the signed-in account may not use, so an administrator gets «Kontrollpanel»
  and «Brukere», and an account that cannot list users gets «Kontrollpanel» and «Profil». Code on the server can register more items, which
  is how later features will join the menu. A top bar with a link to the site and the «Hei, navn» menu (profile, log out).
  The sidebar can be collapsed to a rail of icons.
- Four colour schemes per account (Standard, Lys, Midnatt and Hav), chosen on the profile page and applied from the first
  paint on every device the person signs in on.
- The dashboard at `/admin`: notices, a welcome panel that can be dismissed for good, and «I korte trekk» with the number of
  published posts and pages, the comments (approved and waiting) and the version, each shown only to an account that may
  see it (`GET /api/v1/dashboard/glance`). Notices come from `GET /api/v1/notices`, and a dismissible one is hidden with
  `POST /api/v1/notices/{key}/dismiss` (audit-logged). Two are computed from the state of the stack and cannot be
  dismissed: «e-post ikke testet» while no test mail has gone through with the saved mail settings, and a warning when
  `TOASCRIBE_TRUSTED_PROXY` is empty and requests come from one private address.
- Account preferences (`PATCH /api/v1/me/preferences`): colour scheme, whether the toolbar shows on the site, and whether
  the welcome panel is dismissed. `GET /api/v1/me` returns them.
- The profile page at `/admin/profile`: personal options, name, contact (an e-mail change is only made when the new address
  is confirmed, and until then the page shows «Venter på bekreftelse av ny e-post» with the new address), a short bio,
  password, two-factor and the account's sessions.
- The users list at `/admin/users` (`GET /api/v1/users`) with views per role, search, sorting and paging, and role
  assignment for one or many accounts (`PUT /api/v1/users/roles`). You cannot change your own role, the last active
  administrator keeps the role (two requests at once cannot remove both), and nobody can grant a role that holds a capability
  they do not hold themselves. Every change is written to the audit log.

### Changed

- The images are published under `ghcr.io/toaweb-development/toascribe-*` (proxy, site, admin, api, postgres, mailpit),
  and the labels and links point at `github.com/toaweb-development/toascribe`. 0.4.1 was the last version under
  `ghcr.io/toaweb/`; those images stay where they are.
- A test mail that goes through after the install now marks e-mail as verified, as the wizard's test does, and resolves the
  «e-post hoppet over» notice. The worker marks it when it has sent the mail, and only if the mail settings are still the
  ones it sent with; a failed mail, or settings saved meanwhile, marks nothing. One function in the install package is the
  only code that writes the verified time, for the wizard's test and the later ones alike.
- `GET /api/v1/me` and `PATCH /api/v1/me` return `preferences` and `pendingEmail` (the address of an e-mail change that
  waits for its confirmation link, and when the link expires, or `null`).

### Security

- The admin's Content-Security-Policy gets a `style-src-attr` that allows five exact inline style strings by hash, with
  `'unsafe-hashes'`: the width of Nuxt UI's sidebar (open and collapsed) and three strings that Reka UI writes for Nuxt UI's
  select, checkbox, radio group (its focus group) and visually hidden fields. They are in the HTML the server sends, so the admin uses Nuxt UI's own form
  controls on every screen. `'unsafe-hashes'` is used for style attributes only, never for scripts, and the site has none.
  The strings are kept in one list; a test fails when a screen draws a string that is not on it, or the list holds one that
  no screen draws. There is still no `'unsafe-inline'` and no `'unsafe-eval'`, and a page cannot add a style attribute of
  its own.
- The setup wizard takes a `?token=` query out of the address bar at once, without reading its value, so a token put in
  the wrong place does not stay in the history. The token still travels only in the fragment and the `X-Setup-Token` header.

## [0.4.1] - 2026-10-24

The first published version of M0.4. 0.4.0 below was never released: its release stopped before every image was
published and before the tag, so there is no `v0.4.0` and no 0.4.0 images to install. 0.4.1 has everything listed under
0.4.0, plus the changes here. **No action is needed on upgrade** from 0.3.0; see 0.4.0 for what the upgrade does.

### Security

- Every image now runs `apk upgrade` when it is built, so it gets every security fix Alpine has published since its
  base image was built, not only the one a scan happened to find. The scan before publishing is still the gate. This
  fixes CVE-2026-111497 (brotli-libs, HIGH) in the proxy image.
- The proxy is built on the rebuild of `caddy:2.11.7-alpine` on Alpine 3.23.7.

## [0.4.0] - 2026-10-23

First run: a fresh stack now ends in a setup wizard in the browser, or in `toa core install`, and the images are published
for installation from two files. **No action is needed on upgrade.** A 0.3.0 site with an active administrator is marked
installed by migration `0005_install_state`, so it never shows the wizard and gets no default content; the migration run
does the rest.

### Added

- A setup wizard at `/admin/setup` in seven steps: the one-time code, a system check (database, migrations, keys, proxy
  and the address the site is served on), the site (language, title, time zone, administrator e-mail, search engines),
  e-mail (with a test mail, or skip), the administrator account, the recovery key, and a summary before it installs. A
  reload keeps the position. Until the site is installed every page of the site and the admin goes to the wizard; once it
  is, `/admin/setup` and every setup route except the status answer 404. `/setup` redirects to `/admin/setup`.
- A one-time setup token. While the site is not installed, the api writes a new token to its log once at start-up, in the
  address to open (`/admin/setup#token=...`), and stores only its hash. The token is in the URL fragment, which a browser
  never sends to a server, so neither the proxy nor the api can log it from a request. The wizard reads it from the
  fragment, takes it out of the address bar at once and sends it in the `X-Setup-Token` header, never in a query string; a
  `?token=` in the address is not read. Wrong guesses are rate-limited per address without affecting login. A restart or `toa core setup-token` replaces it; the install deletes it.
- `toa core install | is-installed | gen-env | setup-token`. `install` does what the wizard does, from flags or by asking
  in a terminal, and prints the recovery key once; `is-installed` answers with its exit code; `gen-env` prints the
  three database passwords and the two keys, ready to append to `docker/.env`; `setup-token` prints a new token and the
  address (`#token=...`). Two runs of `install` at once give one winner, and a failed install changes nothing.
- `--notify` on `toa user create`, `toa user reset-password` and `toa user reset-login-limit`. `create --notify` makes a
  pending account and mails a 24-hour link where the person sets their own password, so no password is printed.
  The other two tell the account owner what was done. The reset notices say the change was made by an administrator,
  not by a link from «Mistet passordet?».
- `toa user mfa-reset`: removes every second factor and recovery code of an account, ends its sessions, writes an audit
  entry and tells the owner by e-mail.
- Default content, as in a Norwegian WordPress: the category «Ukategorisert», the post «Hei, verden!» with its comment, the page
  «Testside» and a draft «Personvernerklæring» page, all in blocks and made in the install transaction. Another
  locale gets WordPress' English texts. `category` and `post_tag` exist as built-in taxonomies.
- A recovery key, shown once in the wizard (with a download) and by `toa core install`. Only a verifier is stored, never
  the key; the wizard asks for it back before it installs.
- Images are published to `ghcr.io/toaweb/toascribe-proxy`, `-site`, `-admin`, `-api`, `-postgres` and `-mailpit` when a
  version reaches `main`, tagged with the version and `sha-<short>`, after Trivy has scanned every one (Critical and High
  with a fix fail the release, and then there is no tag). They carry provenance and an SBOM. Pull requests run the same
  build and scan without a push.
- Installing from `compose.yaml` and `.env` only, without cloning the repo: pull the images, make the secrets with
  `toa core gen-env`, then `up -d`. The GitHub Release attaches `compose.yaml` and `env.example`, and the README has the
  steps.
- `GET /api/v1/setup/status`, `/state`, `/check` and the other setup routes, with a `setup-token` policy kind in the
  OpenAPI document; the `setup` action in the login limiter.
- `@toascribe/install`: the install service that the api and the command line share.

### Changed

- `POST /api/v1/auth/register` answers 409 `username_taken` when the name is taken (case-insensitively), with the same
  answer whether or not the e-mail address is. A free name with a taken address still answers 202, and the owner of the
  address gets the "account exists" mail either way.
- Compose no longer uses `:?`. The three database passwords and the two keys have an empty default so that
  `toa core gen-env` can run through compose before `.env` exists. The postgres image refuses to start on an empty
  password, before it creates anything, and the api and worker refuse empty keys. The role URLs are empty when their
  password is, so the apps stop at their own config check. `up` now shows «unhealthy» for postgres; the reason is in
  `docker compose logs postgres`.
- `installed`, `installed_at` and `smtp_verified_at` are read-only settings; the settings API refuses to write them.
  `smtp_verified_at` is when a test mail went through with the saved SMTP settings: the setup's e-mail step is done on that
  or on a skip, never on saved settings alone, and saving the settings again clears it. New settings: `admin_email`,
  `default_category` and `wp_page_for_privacy_policy`.
- Migrations `0005_install_state` (the install state, `admin_notice` and `site_secret`, and the upgrade rule above) and
  `0006_setup_attempts` (the `setup` login-limit action, and `SELECT` on `drizzle.__drizzle_migrations` for the app role,
  which the system check uses to compare the applied migrations with the expected ones).
- One password rule, enforced on the server: a password equal to the username or to the e-mail address (compared without
  regard to case) is refused with 400 `weak_password` by the setup install, `PATCH /me/password`, the password reset and
  the set-password link, and by `toa user create`, `toa user reset-password` and `toa core install`. The wizard goes back to
  the administrator step and keeps what was typed. The rule is `isTooObvious` in `@toascribe/auth`; the api and the command
  line no longer have a copy each.
- One exit-code rule for the whole `toa` command: `0` is success, `1` is an error underway (the command was well formed,
  and the database or a live operation decided: a taken username or e-mail, an account or role that is not there, a site
  that is already installed, a database or mail failure), and `2` is invalid input or usage (an unknown command or flag, a
  missing or malformed value, a refused password, a bad environment). `toa core is-installed` is the exception: `0`
  installed, `1` not installed, `2` any error. These paths exited `1` before and now exit `2`: a missing or wrong
  `DATABASE_URL`, `PUBLIC_ORIGIN` or `MIGRATION_DATABASE_URL` (a `ConfigError`) in every command that reads one,
  `toa user create --notify` without `TOASCRIBE_ENCRYPTION_KEY`, `toa dev seed tom` outside development and test, and
  `toa user reset-password` with a password equal to the username or e-mail. The usage text (`toa help`) and the README
  state the rule.
- The site and the admin both send `frame-ancestors 'none'` and `X-Frame-Options: DENY`; the site was allowed to frame
  itself before.

### Security

- The proxy's logs drop `X-Setup-Token`, `X-Csrf-Token`, `Cookie`, `Authorization`, `Proxy-Authorization` and
  `Set-Cookie`, and replace the value of every query parameter in the request address, the `Referer` header and the
  `Location` header, except `action`, `loggedout` and `checkemail` (the notices of the login screens). `token`, `key`,
  `code`, `password`, `secret`, `signature`, `state` and `access_token` are redacted, and so is any other name. The same
  filter now covers Caddy's error log, which writes the whole request, `X-Setup-Token` included, when an upstream does not
  answer; it was unfiltered before. Tested with the real setup token: it is in the api's start-up line and nowhere else.
- The setup token and the recovery key are stored as hashes only, in their own table that no settings reader can see. The
  token is compared in constant time, and parallel guesses are held by the limiter before they are judged.
- Nothing can frame the site or the admin.

## [0.3.0] - 2026-10-22

Sign-in: people can now log in, stay logged in safely, reset a lost password and use a second factor. **Action needed on
upgrade:** two new keys are required, see the first item under Changed.

### Added

- Login that works like `wp-login.php`: one address, `/admin/login`, with the screens for lost password, new password,
  registration, second factor and e-mail confirmation behind it. `/login`, `/register`, `/logout` and `/wp-login.php`
  (with its `action` values) redirect there and keep the query.
- Passwords are stored with argon2id. A WordPress password hash (phpass `$P$`, or bcrypt as `$2y$` and `$wp$2y$`) is
  accepted at login and replaced with argon2id the first time it is used, so an imported user keeps the old password.
- Sessions in a `__Host-` cookie that scripts cannot read and that only the same site can send, with a CSRF token on every
  write. «Husk meg» keeps a session for 14 days instead of 2; both are settings.
- A capability policy on every API route. A route without one does not compile, is caught by a test, and stops the API
  from starting.
- Login limits per login name and per address, without any hard lock: after five wrong tries (20 per address) the next
  one has to wait 30 seconds (`429` with `Retry-After`), the wait doubles with every further failure up to 15 minutes,
  and it shrinks by itself as old failures pass out of the hour that is remembered. A name nobody has waits exactly like
  one that exists. A finished password reset and `toa user reset-login-limit` end the wait at once. Every number is a
  setting (`login_limit_*`).
- Two-factor login with an authenticator app (TOTP) and ten recovery codes, set up on screen with a QR code. A role can
  require it (`mfa_required_roles`), and then the person must set it up before anything else.
- Lost password, registration and e-mail change through one-time links that work once and expire. The answers never
  tell whether an account exists.
- E-mail through the job queue and SMTP, with bokmål templates. The server is set in `.env` and can be overridden in
  settings, where the SMTP password is stored encrypted. `docker compose --profile mailpit up` adds Mailpit, which
  catches all mail for development and is published on `127.0.0.1` only.
- A test e-mail endpoint for the administrator (`POST /api/v1/system/test-email`).
- Daily clean-up jobs in the worker: ended sessions and spent links, IP addresses past the retention, and spam
  comments past theirs. IP addresses are kept 90 days by default; one setting, `ip_retention_days`, covers sessions,
  comments, application passwords, login attempts and the audit log.
- `@toascribe/http`: an HTTP client that refuses private, loopback and link-local addresses at connect time, on every
  redirect, and limits size and time.
- `@toascribe/auth`: password hashing and one-time tokens, shared by the API and the command line.
- `toa user create`, `toa user reset-password` and `toa user reset-login-limit`. The password comes from standard input or
  is generated and printed once; it is never taken from an argument.
- The password is asked for again before a second factor is added, removed or given new recovery codes, and before the
  password or the e-mail address is changed; a code from the app is not accepted instead. The owner gets an e-mail about
  each of them before it happens, and after a password has been reset with a link. (Setting up the factor that a role
  requires, right after the login, does not ask again.)
- The api writes one warning to its log when `TOASCRIBE_TRUSTED_PROXY` is empty and its first requests all come from the
  same private address, because every visitor then shares one rate-limit bucket. See «Behind a reverse proxy» in the
  README.
- The login, register, lost-password and logout screens show the site name from the settings (`GET /api/v1/auth/options`
  returns `siteName`), and the product's name only when it is empty. While a try has to wait, the screens say for how long
  («Prøv igjen om 30 sekunder»), from `Retry-After`; the lost-password and register forms do the same.
- The public site sends security headers (K-314): the same strict Content-Security-Policy with a nonce per response as the
  admin, `X-Content-Type-Options`, `Referrer-Policy`, and HSTS when the request came in over https. Images may come from any
  https host (themes show them), the site may be framed by itself only, and a page is `private, no-cache`.
- Login screens in the admin, in bokmål, tested in a real browser at phone and desktop widths with an accessibility check
  (`pnpm test:e2e`, see the README).

### Changed

- **Action needed on upgrade:** `TOASCRIBE_ENCRYPTION_KEY` and `TOASCRIBE_SIGNING_KEY` are new and required, and
  `docker compose up` stops without them. Generate both before you start (`openssl rand -hex 32`, a different value
  each) and put them in `docker/.env`. **Back up the encryption key outside the server:** TOTP secrets and the SMTP
  password cannot be read without it. `TOASCRIBE_ENCRYPTION_KEY_VERSION` and `TOASCRIBE_ENCRYPTION_OLD_KEYS` let you
  replace the key without losing data.
- **BREAKING:** the editor role no longer has `unfiltered_html`, and `administrator` can no longer be the default role
  for new accounts (`default_role` refuses it). Migration `0003_rights_ip_retention` applies both once on an
  existing database: it removes `unfiltered_html` from the built-in editor role only (a role you made yourself is left
  alone), and sets `default_role` back to `subscriber` if it was `administrator`. Each change is written to the audit
  log. The administrator can grant `unfiltered_html` to a role again.
- The settings `login_limit_lockout_minutes` and `login_limit_lockout_max_minutes` are replaced by
  `login_limit_delay_seconds` (30) and `login_limit_delay_max_minutes` (15), and `login_limit_window_minutes` now
  defaults to 60. Migration `0004_login_attempt_login_hash` removes the two old rows and adds `login_attempt.login_hash`,
  a keyed hash of the typed name (never the name); the migration run that follows seeds the new settings.
- `TOASCRIBE_TRUSTED_PROXY` is passed on to the api (it only reads whether it is empty).
- The IP clean-up reads `ip_retention_days` (7 to 3650, default 90) instead of a fixed 90 days.
- The admin sends a strict Content-Security-Policy with a nonce per response, and no cached pages. Its base is set once in
  `packages/nuxt-base`, so the site and the admin send the same policy apart from what differs.
- Compose publishes one more port in the Mailpit profile (`127.0.0.1:8025`), off by default. Its image is
  `ghcr.io/toaweb/toascribe-mailpit`: Mailpit 1.31.6 with the binary rebuilt on Go 1.27.3.

### Security

- Nothing the admin serves can run inline script or style: no `unsafe-inline`, no `unsafe-eval`, no framing.
- An unknown account and a wrong password look the same to the visitor, as do an unknown address on lost password and an
  address that is already registered.
- Reset and confirmation links are read from the address fragment and removed from the address bar at once, so they do
  not reach logs or the `Referer` header.
- A TOTP code works once (RFC 6238 replay protection), and a password reset ends every session of the account.
- The address to return to after login must be a path on the same site; anything else, including encoded tricks, is
  refused.
- The mail server settings cannot carry line breaks into a mail header.

## [0.2.0] - 2026-10-21

The data model: the database now holds everything a site needs, and a fresh stack starts with roles and settings in place.

### Added

- The core data model: 43 tables in two migrations, with time-ordered ids, a short numeric id for `/?p=` links, named
  foreign keys and indexes for JSON content and search. The app role gets data rights only. On the audit log it has
  only insert and select, and every entry names its actor. IP addresses on the audit log are cleared after 90 days by
  a database function that the app role may only execute. [docs/DATAMODEL.md](docs/DATAMODEL.md) has the ER diagram,
  the draft and revision model and where it departs from the plan.
- `seedCore()`: the five WordPress roles with WordPress' capabilities and 51 default settings (Norwegian date, time
  and timezone, locale `nb`, WordPress permalinks, comments open). The migrate step runs it after the migrations and
  never overwrites a row that exists, so a fresh `docker compose up` ends with roles and settings in place.
- `toa dev seed tom`: resets a development database to the migrated and seeded state. It refuses unless `NODE_ENV` is
  `development` or `test`.
- `packages/nuxt-base`: one Nuxt layer shared by the site and the admin (API plugin, status component, runtime config,
  head basics).
- Norwegian bokmål as the first interface language, through `@nuxtjs/i18n`. All screen text goes through messages, and a
  test fails on hard-coded text in templates.
- `pnpm check`: format, lint, type check, tests and build, including the root files, in one command. CI and the docs
  use it; the pre-commit hook runs the lint and type check part (`pnpm lint && pnpm typecheck`).
- A `source` export condition on the workspace libraries, so lint, type check and tests read `src/` without building
  first. Node still loads `dist/`.

### Changed

- **BREAKING:** the proxy publishes its port on `127.0.0.1` by default. Set `TOASCRIBE_HTTP_BIND` to expose it on
  another address.
- Lint, type check and tests no longer need the libraries built first, so the root `build:libs` step and the single-worker
  setting are gone.
- The version gate ignores changes that only touch tests.

### Security

- The proxy believes `X-Forwarded-For`, `-Proto` and `-Host` only from the address in `TOASCRIBE_TRUSTED_PROXY`, and
  replaces them with what it sees itself otherwise. The edge network has a fixed subnet.
- The proxy reads `X-Forwarded-For` from the right (`trusted_proxies_strict`), so entries a visitor writes in front of
  the real address are ignored, and sends the client address to the apps in `X-Real-IP`, which the apps read instead
  of `X-Forwarded-For`. The README shows an nginx setup that overwrites the header and asks for one trusted address
  only, never a network.
- Paths that are not normalised are rejected with 400.
- The database init script passes the role passwords to psql with `\getenv`, so they no longer show in the process
  list.
- gosu is pinned to a commit, and the optional Valkey image is pinned and scanned like the others.

## [0.1.0] - 2026-10-20

The skeleton: everything runs end to end, nothing is a feature yet.

### Added

- A pnpm workspace with TypeScript 6, ESLint, Prettier, Vitest and one version for every dependency.
- `packages/db`: the Drizzle client, a migration runner that takes a database lock and also installs the pg-boss
  schema, and the two PostgreSQL roles (owner for migrations, app role with no DDL rights).
- `apps/api`: a Hono API with `/api/health`, `/api/ready` and an OpenAPI document, and `apps/worker`: a pg-boss
  worker with a heartbeat healthcheck. Both shut down cleanly on SIGTERM.
- `apps/site` and `apps/admin`: two Nuxt 4 apps that show the API status, and the default theme as a Nuxt layer.
- The `toa` command, with `--version`.
- `docker/compose.yaml`: the whole stack on one port, with a Caddy proxy that routes `/api`, `/admin` and the site,
  a migrate step that runs before the API, and optional Valkey. Compose refuses to start with an empty password.
- CI: lint, type check, tests (against PostgreSQL 18), build, image build, vulnerability scan of the images and the
  dependencies, a start of the full stack, and a version gate that asks for a new version and CHANGELOG entry when
  released files change.

[Unreleased]: https://github.com/toaweb-development/toascribe/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/toaweb-development/toascribe/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/toaweb-development/toascribe/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/toaweb-development/toascribe/compare/v0.3.0...v0.4.1
[0.3.0]: https://github.com/toaweb-development/toascribe/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/toaweb-development/toascribe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/toaweb-development/toascribe/releases/tag/v0.1.0
