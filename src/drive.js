/**
 * Google Drive API helpers — thin wrappers around googleapis.
 */

import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '..', '.gdrive-token.json');
const CREDS_PATH = path.join(__dirname, '..', 'credentials.json');

function getCredentials() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };

  if (fs.existsSync(CREDS_PATH)) {
    const raw = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
    const creds = raw.installed || raw.web;
    return { clientId: creds.client_id, clientSecret: creds.client_secret };
  }
  throw new Error('No Google OAuth credentials found.');
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `No token file found at ${TOKEN_PATH}. Run "npm run auth" first.`,
    );
  }
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

let driveInstance;

export function getDrive() {
  if (driveInstance) return driveInstance;

  const { clientId, clientSecret } = getCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  const tokens = loadTokens();
  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens and persist them
  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
    oauth2Client.setCredentials(merged);
  });

  driveInstance = google.drive({ version: 'v3', auth: oauth2Client });
  return driveInstance;
}

// ---------- helpers ----------

const DEFAULT_FIELDS = 'id, name, mimeType, size, modifiedTime, parents, webViewLink';

export async function listFiles({ folderId, pageSize = 20, pageToken, query } = {}) {
  const drive = getDrive();
  const qParts = [];
  if (folderId) qParts.push(`'${folderId}' in parents`);
  if (query) qParts.push(query);
  qParts.push('trashed = false');

  const res = await drive.files.list({
    q: qParts.join(' and '),
    pageSize,
    pageToken,
    fields: `nextPageToken, files(${DEFAULT_FIELDS})`,
    orderBy: 'modifiedTime desc',
  });
  return { files: res.data.files, nextPageToken: res.data.nextPageToken };
}

export async function searchFiles(queryText, { pageSize = 20, pageToken } = {}) {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `fullText contains '${queryText.replace(/'/g, "\\'")}' and trashed = false`,
    pageSize,
    pageToken,
    fields: `nextPageToken, files(${DEFAULT_FIELDS})`,
  });
  return { files: res.data.files, nextPageToken: res.data.nextPageToken };
}

export async function readFile(fileId) {
  const drive = getDrive();

  // First get metadata to determine type
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
  });

  const { mimeType } = meta.data;

  // Google Workspace files need to be exported
  const exportMap = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing': 'image/png',
  };

  let content;
  if (exportMap[mimeType]) {
    const res = await drive.files.export(
      { fileId, mimeType: exportMap[mimeType] },
      { responseType: 'text' },
    );
    content = res.data;
  } else {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'text' },
    );
    content = res.data;
  }

  return { metadata: meta.data, content };
}

export async function createFile({ name, content, mimeType = 'text/plain', folderId }) {
  const drive = getDrive();
  const fileMetadata = { name };
  if (folderId) fileMetadata.parents = [folderId];

  const media = {
    mimeType,
    body: Readable.from([content]),
  };

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: DEFAULT_FIELDS,
  });
  return res.data;
}

export async function updateFile({ fileId, content, mimeType = 'text/plain' }) {
  const drive = getDrive();
  const media = {
    mimeType,
    body: Readable.from([content]),
  };

  const res = await drive.files.update({
    fileId,
    media,
    fields: DEFAULT_FIELDS,
  });
  return res.data;
}

export async function uploadFile({ name, localPath, mimeType, folderId }) {
  const drive = getDrive();
  const fileMetadata = { name };
  if (folderId) fileMetadata.parents = [folderId];

  const media = {
    mimeType: mimeType || 'application/octet-stream',
    body: fs.createReadStream(localPath),
  };

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: DEFAULT_FIELDS,
  });
  return res.data;
}
