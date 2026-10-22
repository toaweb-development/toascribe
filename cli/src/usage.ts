export const USER_CREATE_USAGE = `  user create --username <name> --email <address> --role <slug> [--display-name <name>] [--password-stdin]
                         Create an active account with any role, administrator included. Needs DATABASE_URL (app role).
                         The password is read from standard input with --password-stdin, otherwise one is generated
                         and printed once on stdout.`

export const USER_RESET_PASSWORD_USAGE = `  user reset-password (--username <name> | --email <address>) [--password-stdin]
                         Set a new password (from standard input, or generated and printed once on stdout), end every
                         session of the account and write an audit entry. Sends no e-mail. Needs DATABASE_URL.`

export const USER_RESET_LOGIN_LIMIT_USAGE = `  user reset-login-limit (--username <name> | --email <address>)
                         End the wait the api puts on an account after failed logins, codes, lost-password requests and
                         registrations. Nothing is locked; this lets the owner try at once. Writes an audit entry; the
                         password and the sessions stay as they are. Needs DATABASE_URL.`

export const USAGE = `Usage: toa <command>

Commands:
  version, --version     Print the toascribe version
  dev seed tom           Empty a development database, run the migrations and seed the roles and settings.
                         Refuses unless NODE_ENV is development or test. Needs MIGRATION_DATABASE_URL (owner role).
${USER_CREATE_USAGE}
${USER_RESET_PASSWORD_USAGE}
${USER_RESET_LOGIN_LIMIT_USAGE}
`
