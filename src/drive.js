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

let authClient;

function getAuth() {
  if (authClient) return authClient;

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

  authClient = oauth2Client;
  return authClient;
}

let driveInstance;

export function getDrive() {
  if (driveInstance) return driveInstance;
  driveInstance = google.drive({ version: 'v3', auth: getAuth() });
  return driveInstance;
}

let docsInstance;

export function getDocs() {
  if (docsInstance) return docsInstance;
  docsInstance = google.docs({ version: 'v1', auth: getAuth() });
  return docsInstance;
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

/**
 * Strip HTML tags and decode common entities to produce readable plain text.
 */
function htmlToText(html) {
  // Remove style and script blocks
  let text = html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Convert <br> and block-level closings to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/**
 * Extract base64-encoded images from HTML <img> tags with data URIs.
 * Returns { images: [{ mimeType, data }], html } with images replaced by placeholders.
 */
function extractImages(html) {
  const images = [];
  const cleaned = html.replace(
    /<img[^>]+src="data:([^;]+);base64,([^"]+)"[^>]*>/gi,
    (match, mime, data) => {
      images.push({ mimeType: mime, data });
      return `[image ${images.length}]`;
    },
  );
  return { images, html: cleaned };
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
    'application/vnd.google-apps.document': 'text/html',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing': 'image/png',
  };

  let content;
  let images = [];

  if (exportMap[mimeType]) {
    const exportMime = exportMap[mimeType];
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'text' },
    );

    if (mimeType === 'application/vnd.google-apps.document') {
      // Extract embedded images from the HTML export
      const extracted = extractImages(res.data);
      images = extracted.images;
      content = htmlToText(extracted.html);
    } else {
      content = res.data;
    }
  } else {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'text' },
    );
    content = res.data;
  }

  return { metadata: meta.data, content, images };
}

const GOOGLE_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

export async function createFile({ name, content, mimeType = 'text/plain', folderId }) {
  const drive = getDrive();
  const fileMetadata = { name };
  if (folderId) fileMetadata.parents = [folderId];

  // For Google Workspace types, set the target type in metadata and upload as plain text
  let mediaMimeType = mimeType;
  if (GOOGLE_MIME_TYPES.has(mimeType)) {
    fileMetadata.mimeType = mimeType;
    mediaMimeType = 'text/plain';
  }

  const media = {
    mimeType: mediaMimeType,
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

/**
 * Get the inline image objectIds from a Google Doc in document order.
 */
async function getImageObjectIds(documentId) {
  const docs = getDocs();
  const { data: doc } = await docs.documents.get({ documentId });

  const objectIds = [];
  const walk = (elements) => {
    for (const el of elements) {
      if (el.paragraph) {
        for (const pe of el.paragraph.elements) {
          if (pe.inlineObjectElement) {
            objectIds.push(pe.inlineObjectElement.inlineObjectId);
          }
        }
      }
      if (el.table) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells) {
            walk(cell.content);
          }
        }
      }
    }
  };
  walk(doc.body.content);
  return { objectIds, inlineObjects: doc.inlineObjects || {} };
}

export async function insertImage({ fileId, uri, index = 1 }) {
  const docs = getDocs();
  const { data: doc } = await docs.documents.get({ documentId: fileId });

  // Find the insertion point: beginning of the document body
  const location = index;

  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests: [
        {
          insertInlineImage: {
            uri,
            location: { index: location },
          },
        },
      ],
    },
  });

  return { inserted: true, uri, locationIndex: location };
}

export async function copyFile({ fileId, name, folderId }) {
  const drive = getDrive();
  const requestBody = { name };
  if (folderId) requestBody.parents = [folderId];

  const res = await drive.files.copy({
    fileId,
    requestBody,
    fields: DEFAULT_FIELDS,
  });
  return res.data;
}

export async function replaceImage({ fileId, imageIndex, uri }) {
  const { objectIds, inlineObjects } = await getImageObjectIds(fileId);

  if (imageIndex < 1 || imageIndex > objectIds.length) {
    throw new Error(
      `Image index ${imageIndex} out of range. Document has ${objectIds.length} image(s).`,
    );
  }

  const objectId = objectIds[imageIndex - 1];
  const docs = getDocs();
  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests: [{ replaceImage: { imageObjectId: objectId, uri } }],
    },
  });

  const props = inlineObjects[objectId]?.inlineObjectProperties?.embeddedObject;
  return {
    replacedObjectId: objectId,
    imageIndex,
    title: props?.title || null,
    totalImages: objectIds.length,
  };
}

export async function deleteFile(fileId) {
  const drive = getDrive();
  await drive.files.delete({ fileId });
  return { deleted: true, fileId };
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
