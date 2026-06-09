import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf-8')).installed;
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, '.gdrive-token.json'), 'utf-8'));
const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
auth.setCredentials(tokens);
const docs = google.docs({ version: 'v1', auth });

const DOC_ID = process.argv[2];
if (!DOC_ID) {
  console.error('Usage: node inspect-doc.mjs <documentId>');
  process.exit(1);
}
const { data } = await docs.documents.get({ documentId: DOC_ID });

function paraText(p) {
  return (p.elements || []).map((e) => e.textRun ? e.textRun.content : '').join('');
}
function styleSummary(p) {
  const named = p.paragraphStyle?.namedStyleType || '';
  const runs = (p.elements || []).filter((e) => e.textRun);
  const ts = runs[0]?.textRun?.textStyle || {};
  const bits = [];
  if (ts.bold) bits.push('bold');
  if (ts.italic) bits.push('italic');
  if (ts.weightedFontFamily) bits.push(`font=${ts.weightedFontFamily.fontFamily}`);
  if (ts.backgroundColor) bits.push('bg');
  if (ts.fontSize) bits.push(`size=${ts.fontSize.magnitude}`);
  return `${named}${bits.length ? ' {' + bits.join(',') + '}' : ''}`;
}

const body = data.body.content;
for (const el of body) {
  if (!el.paragraph) {
    if (el.table) console.log(`[startIndex=${el.startIndex}] <TABLE>`);
    continue;
  }
  const txt = paraText(el.paragraph).replace(/\n/g, '⏎');
  console.log(`[${el.startIndex}-${el.endIndex}] (${styleSummary(el.paragraph)}) | ${JSON.stringify(txt).slice(0, 110)}`);
}
