export const USER_CREATE_USAGE = `  user create --username <name> --email <address> --role <slug> [--display-name <name>] [--password-stdin | --notify]
                         Create an account with any role, administrator included. Needs DATABASE_URL (app role).
                         The password is read from standard input with --password-stdin, otherwise one is generated
                         and printed once on stdout; the account is active at once.
                         With --notify no password is made: the account waits for its first password and a mail with a
                         link to choose one (valid 24 hours) is queued to the address. Needs TOASCRIBE_ENCRYPTION_KEY
                         too, and the worker to send it. Cannot be combined with --password-stdin.`

export const USER_RESET_PASSWORD_USAGE = `  user reset-password (--username <name> | --email <address>) [--password-stdin] [--notify]
                         Set a new password (from standard input, or generated and printed once on stdout), end every
                         session of the account and write an audit entry. With --notify a security notice is queued to
                         the address of the account (it holds no password). Needs DATABASE_URL.`

export const USER_RESET_LOGIN_LIMIT_USAGE = `  user reset-login-limit (--username <name> | --email <address>) [--notify]
                         End the wait the api puts on an account after failed logins, codes, lost-password requests and
                         registrations. Nothing is locked; this lets the owner try at once. Writes an audit entry; the
                         password and the sessions stay as they are. With --notify a short notice is queued to the
                         address of the account. Needs DATABASE_URL.`

export const USER_MFA_RESET_USAGE = `  user mfa-reset (--username <name> | --email <address>) [--notify]
                         Remove every second factor and every recovery code of the account, end all its sessions and write
                         an audit entry (mfa.reset). The account always gets a security notice by e-mail (queued for the
                         worker); --notify is accepted and changes nothing. If a role of the account is in mfa_required_roles,
                         its next login is an enrolment. Needs DATABASE_URL.`

export const CORE_INSTALL_USAGE = `  core install [--url <origin>] [--title <text>] [--locale nb] [--timezone Europe/Oslo]
               [--admin-user <name>] [--admin-email <address>] [--admin-password-stdin]
               [--skip-email] [--no-index]
                         Install the site, as the setup wizard does: the administrator, the default content (a post, a page, a
                         privacy page, the category) and the settings, in one transaction. With --url, --title, --admin-user and
                         --admin-email it asks nothing; without them it asks (in a terminal only). --url must be the address in
                         PUBLIC_ORIGIN. The administrator's password comes from standard input with --admin-password-stdin,
                         otherwise one is generated. Prints the recovery key for backups once on stdout, and the generated
                         password with it; neither is kept anywhere. E-mail: the SMTP settings of the environment (SMTP_HOST,
                         MAIL_FROM_ADDRESS) are used as they are and no test mail is sent; --skip-email stores the notice the
                         wizard stores instead. --no-index asks search engines not to index the site. Exit 1 when the site is
                         already installed (nothing is changed). Needs DATABASE_URL and PUBLIC_ORIGIN.`

export const MEDIA_REGENERATE_USAGE = `  media regenerate [--id <uuid>]
                         Make the image sizes again (every image, or the one with --id), for example after the sizes in Settings →
                         Media changed. Marks them pending and queues a job per image; the worker makes them. Writes an audit
                         entry. Needs DATABASE_URL.`

export const CORE_IS_INSTALLED_USAGE = `  core is-installed
                         Exit 0 when the site is installed, 1 when it is not, 2 on an error. Prints nothing. Needs DATABASE_URL.`

export const CORE_GEN_ENV_USAGE = `  core gen-env
                         Print five new random values as .env lines: POSTGRES_PASSWORD, POSTGRES_OWNER_PASSWORD,
                         POSTGRES_APP_PASSWORD, TOASCRIBE_ENCRYPTION_KEY and TOASCRIBE_SIGNING_KEY (32 random bytes each,
                         hex). Needs no database and no environment, and writes no file: append it with
                           toa core gen-env >> docker/.env
                         Run it once for a new site. Back up TOASCRIBE_ENCRYPTION_KEY outside the server.`

export const CORE_SETUP_TOKEN_USAGE = `  core setup-token
                         Make a new setup token (the old one stops working) and print it with the address of the wizard,
                         PUBLIC_ORIGIN/admin/setup#token=... For a site that is not installed yet; exit 1 when it is.
                         Needs DATABASE_URL and PUBLIC_ORIGIN.`

/** The one exit-code rule of every command. kit.ts holds the constants and says how 1 is told from 2. */
export const EXIT_CODES_USAGE = `Exit codes:
  0   Success.
  1   An error underway: the database does not answer, the mail queue failed, the site is already installed, a name is
      taken or an account is not found, a conflict with another run.
  2   Invalid input or usage: an unknown command or flag, a missing or malformed value, a password the rules refuse,
      a bad environment (a variable that is missing or wrong).
  One exception: \`core is-installed\` is a question. It exits 0 when the site is installed, 1 when it is not and 2 on any error.`

export const MAINTENANCE_USAGE = `  maintenance on [--message <text>] [--retry-after <seconds>] | off | status [--format table|json]
                         Maintenance mode (K-288): visitors get 503 with Retry-After (default 600 s) and the maintenance page, with
                         --message as its text; accounts with manage_options see the site, and the api answers, so an administrator
                         can sign in and turn it off. A restore and a migration turn it on and off by themselves. Needs DATABASE_URL.`

export const CHECK_UPDATE_USAGE = `  check-update [--format table|json]     (also: core check-update)
                         Looks for a newer release now (the public image tags on ghcr.io; nothing about the site is sent) and
                         stores the answer for «Oppdateringer». Off with TOASCRIBE_UPDATE_CHECK=off or the update_check setting
                         (exit 1, nothing asked). Needs DATABASE_URL.`

const AS_USER = `--user <username or e-mail> is the account whose rights the command uses (as WP-CLI); the audit log names
                         «cli» with that account.`

export const POST_USAGE = `  post list [--type post|page] [--status <status>] [--search <text>] [--page n] [--per-page n] --user <login>
  post get <id> --user <login>
  post create [--type post|page] --title <text> [--content <text> | --blocks <json>] [--status draft|publish|...]
              [--slug <slug>] [--excerpt <text>] --user <login>
  post update <id> [--title] [--content | --blocks] [--status] [--slug] [--excerpt] --user <login>
  post delete <id> [--force] --user <login>
                         Posts and pages through the api's own service and checks. --content is plain text (an empty line
                         starts a paragraph). delete moves to the trash; --force deletes for good. ${AS_USER}
                         All take --format table|json. Needs DATABASE_URL, TOASCRIBE_ENCRYPTION_KEY and PUBLIC_ORIGIN.`

export const TERM_USAGE = `  term list <category|post_tag> [--search <text>] [--page n] [--per-page n] --user <login>
  term get <taxonomy> <id> --user <login>
  term create <taxonomy> --name <text> [--slug] [--parent <id>] [--description] --user <login>
  term update <taxonomy> <id> [--name] [--slug] [--parent] [--description] --user <login>
  term delete <taxonomy> <id> --user <login>
                         Categories and tags, as «Kategorier» and «Stikkord». All take --format table|json.`

export const MENU_USAGE = `  menu list | get <id> | create --name <text> | update <id> [--name] [--items <json>] | delete <id>   --user <login>
                         Menus, as «Utseende → Menyer» (items as the api's JSON). All take --format table|json.`

export const OPTION_USAGE = `  option list [--search <text>] | get <key> | update <key> <value>   --user <login>
                         The settings, through the screen each belongs to and its checks. <value> is read as JSON when it is
                         JSON (true, 42, "text", ["a"]), else as text. Settings are a fixed set: add and delete are refused.
                         The SMTP password is shown as [encrypted], never its value.`

export const CACHE_USAGE = `  cache flush [--tag <tag>]
                         The site drops its cached answers at its next request: all of them, or those under --tag
                         (list:post, content:<id>, menus). Needs DATABASE_URL.`

export const JOBS_USAGE = `  jobs list [--queue <name>] [--state created|retry|active|completed|cancelled|failed] [--limit n] [--format table|json]
  jobs retry <id> | jobs cancel <id>
                         The job queue (pg-boss): what is queued, running, done or failed, without the jobs' data; a failed
                         job queued again, or a waiting one cancelled. Needs DATABASE_URL.`

export const SECRETS_USAGE = `  secrets list [--format table|json]
                         The install's secrets by name and where they are (the environment, the database), and which key
                         version sealed the stored ones. Never a value.
  secrets rotate --new-key
                         A new encryption key and the steps to put it in .env (the current key is not printed).
  secrets rotate [--yes]
                         Seal every stored secret again with the current key, after the steps above. Asks first (type
                         «roter»), with a warning: keep the older keys until it has run. Needs TOASCRIBE_ENCRYPTION_KEY.`

export const SHELL_USAGE = `  shell
                         A Node REPL with db, schema, sql, the api's services and actAs(login), in the container only and at
                         a terminal (docker compose exec api toa shell). Everything typed runs for real; a warning says so.`

export const BACKUP_USAGE = `  backup create [--include-secrets] [--format table|json]
                         One file in the backups volume (BACKUPS_DIR): the database, the uploads and a manifest with a sha256 per
                         file, mode 0600. The keys are left out; --include-secrets keeps them, encrypted with age to [backup]
                         recipient in toascribe.toml (refused without one). Needs DATABASE_URL.
  backup list [--format table|json]
                         The backups in the volume, newest first.
  backup verify <file> [--identity <age key file>]
                         Reads the whole backup and checks it against its manifest. Changes nothing.
  backup prune [--keep <n>]
                         Deletes all but the newest n backups (default [backup] keep, 7).
  backup restore <file> [--identity <age key file>] [--dry-run] [--yes]
                         Replaces the database and the uploads with the backup, after checking it whole. Refuses a backup from a
                         newer toascribe; an older one is migrated up. Maintenance mode is on meanwhile and off afterwards, also on a
                         failure. Asks first (or --yes). Needs MIGRATION_DATABASE_URL: docker compose run --rm migrate toa backup restore …`

export const DB_MIGRATE_USAGE = `  db migrate [--no-backup]
  core update [--no-backup]
                         Run the migrations of this build. When they change a site that has data, a backup is made first (a failed
                         backup stops it) and maintenance mode is on while they run. --no-backup skips the backup, with a warning.
                         The migrate service runs this at every start. Needs MIGRATION_DATABASE_URL.`

export const USAGE = `Usage: toa <command>

Commands:
  version, --version     Print the toascribe version
  dev seed tom           Empty a development database, run the migrations and seed the roles and settings.
                         Refuses (exit 2) unless NODE_ENV is development or test. Needs MIGRATION_DATABASE_URL (owner role).
${CORE_INSTALL_USAGE}
${CORE_IS_INSTALLED_USAGE}
${CORE_GEN_ENV_USAGE}
${CORE_SETUP_TOKEN_USAGE}
${USER_CREATE_USAGE}
${USER_RESET_PASSWORD_USAGE}
${USER_RESET_LOGIN_LIMIT_USAGE}
${USER_MFA_RESET_USAGE}
${MEDIA_REGENERATE_USAGE}
${MAINTENANCE_USAGE}
${BACKUP_USAGE}
${CHECK_UPDATE_USAGE}
${POST_USAGE}
${TERM_USAGE}
${MENU_USAGE}
${OPTION_USAGE}
${CACHE_USAGE}
${JOBS_USAGE}
${SECRETS_USAGE}
${SHELL_USAGE}
${DB_MIGRATE_USAGE}

${EXIT_CODES_USAGE}
`
