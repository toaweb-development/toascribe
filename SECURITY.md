# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting instead: on the
repository, open the **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce
it, and which version you tested.

You can expect an answer that the report was received within a few days. We will tell you whether we can reproduce it,
agree on a fix and a release, and credit you in the CHANGELOG if you want that.

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
- CI scans every image for known vulnerabilities (Critical and High with a known fix fail the build) and audits the
  production dependencies.
