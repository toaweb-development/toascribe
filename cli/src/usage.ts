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

${EXIT_CODES_USAGE}
`
