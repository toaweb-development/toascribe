# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting instead: on the
repository, open the **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce
it, and which version you tested.

You can expect an answer that the report was received within a few days. We will tell you whether we can reproduce it,
agree on a fix and a release, and credit you in the CHANGELOG if you want that.

## Each toascribe site: security.txt

Every site can name its own contact for security problems under «Innstillinger → Personvern → Sikkerhet». The site then serves
`/.well-known/security.txt` (RFC 9116) with that contact, the policy page if one is given, the preferred languages and an
expiry date half a year ahead (renewed on its own). Without a contact the site answers 404 there. Problems in toascribe itself go
to this repository, as above.

## How a report is handled

1. Acknowledged within a few days, in the private advisory.
2. Reproduced and rated (Critical, High, Medium, Low) against the latest release.
3. Fixed on a private branch, with a test that fails without the fix; the fix is released as a patch version.
4. The advisory is published with the release, crediting the reporter if they want it, and the CHANGELOG names it under «Security».

## Supported versions

Only the latest 0.x release is supported. Fixes are released as a new patch version of it.

| Version        | Supported |
| -------------- | --------- |
| latest 0.x     | yes       |
| anything older | no        |

## What is already in place

- The database roles are split: the running API and worker connect as a role with no DDL rights, and only the
  one-shot migrate step has the owner role (`docker/postgres/init.sql`).
- Images run as a non-root user, with `no-new-privileges`, all capabilities dropped and a read-only root filesystem
  wherever the service allows it. Only the proxy publishes a port.
- Every image is scanned for known vulnerabilities before it is published, by `pnpm release:check` and again by the
  release workflow (Critical and High with a known fix fail the release). The production dependencies are audited before
  every release (`scripts/release.sh`).

## By design: custom HTML runs on the public site

The «Egendefinert HTML» block (custom HTML) is written into the public site as it is, scripts included, as WordPress does
(Tor's decision, M1.4). It is not a hole in the content security policy: the site gives every `<script>` it renders the
response's nonce, so a script in that block runs with the page's rights.

- Only an account with `unfiltered_html` can add the block or change it. By default that is the administrator alone (unlike
  WordPress, the editor does not have it). The
  API checks this on every save, so a role without it cannot write one, even by calling the API directly.
- The admin always shows the block's source and never runs it. This keeps a script in a post from running in a signed-in
  person's session there.
- Treat `unfiltered_html` as a trusted right. Give it only to people you would give your site's code to.

A password-protected post is never sent before its password is given: not its text, its excerpt or its search matches. A
preview link works for 30 minutes, for one item only, and stops when the session that made it ends.
