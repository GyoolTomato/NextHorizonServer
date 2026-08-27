# Live deployment bundle

Copy the contents of this directory to the live server.

- Runtime port: `3000`
- SQLite database: `dev.db`
- Install dependencies with `npm ci` when needed.
- Generate the Prisma client with `npm run prisma:generate` after schema changes.
- Start the server with `npm start`.
- Daily logs use Korea Standard Time and are written to `.logs/YYYY-MM-DD-server.txt`.

This directory is a deployment snapshot. Development runs from the parent directory on port `3099`.
