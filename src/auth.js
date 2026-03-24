#!/usr/bin/env node

/**
 * Standalone script to perform the OAuth2 authorization flow.
 * Run: npm run auth
 *
 * Prerequisites:
 *   1. Create a Google Cloud project and enable the Drive API.
 *   2. Create OAuth 2.0 credentials (Desktop app).
 *   3. Set environment variables GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET,
 *      or place a credentials.json file in the project root.
 */

import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '..', '.gdrive-token.json');
const CREDS_PATH = path.join(__dirname, '..', 'credentials.json');

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const REDIRECT_PORT = 3333;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function getCredentials() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  if (fs.existsSync(CREDS_PATH)) {
    const raw = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
    const creds = raw.installed || raw.web;
    return { clientId: creds.client_id, clientSecret: creds.client_secret };
  }

  console.error(
    'No credentials found. Either set GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET env vars,\n'
    + `or place a credentials.json file in ${path.dirname(CREDS_PATH)}`,
  );
  process.exit(1);
}

async function main() {
  const { clientId, clientSecret } = getCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log(`\nOpening browser for authorization...\n\nIf it doesn't open, visit:\n${authUrl}\n`);

  // Try to open the browser automatically
  try {
    const openMod = await import('open');
    await openMod.default(authUrl);
  } catch {
    // open is optional — user can follow the URL manually
  }

  // Start a tiny HTTP server to receive the OAuth callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname === '/oauth2callback') {
        const authCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (error) {
          res.end('Authorization denied.');
          server.close();
          reject(new Error(error));
          return;
        }
        res.end('Authorization successful! You can close this tab.');
        server.close();
        resolve(authCode);
      }
    });
    server.listen(REDIRECT_PORT, () => {
      console.log(`Waiting for OAuth callback on port ${REDIRECT_PORT}...`);
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nTokens saved to ${TOKEN_PATH}`);
}

main().catch((err) => {
  console.error('Auth failed:', err.message);
  process.exit(1);
});
