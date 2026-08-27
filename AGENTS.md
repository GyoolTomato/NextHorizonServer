# Repository instructions

After every server or database change, update `.live` as the deployment snapshot.

- Keep development runtime configuration in the repository root on port `3099`.
- Keep `.live/.env` and the fallback port in `.live/server.js` on port `3000`.
- Synchronize changed runtime files, Prisma schema/configuration, package manifests, and `dev.db` into `.live` when applicable.
- Do not copy `node_modules` into `.live`.
- Preserve the portable live database URL `DATABASE_URL="file:./dev.db"`.
- Keep API and audit logs in `.logs/YYYY-MM-DD-server.txt`, rotating by the Asia/Seoul calendar date.
