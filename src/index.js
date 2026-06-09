#!/usr/bin/env node

/**
 * MCP server for Google Drive.
 *
 * Tools: list_files, search_files, read_file, create_file, create_folder, write_file, edit_document_text, insert_document_text, upload_file, delete_file, delete_folder, copy_file, insert_image, replace_image
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  listFiles,
  searchFiles,
  readFile,
  createFile,
  updateFile,
  uploadFile,
  deleteFile,
  copyFile,
  insertImage,
  createFolder,
  replaceImage,
  replaceDocumentText,
  insertDocumentText,
} from './drive.js';

const server = new McpServer({
  name: 'mcp-gdrive',
  version: '1.0.0',
});

// ── list_files ──────────────────────────────────────────────

server.registerTool(
  'list_files',
  {
    title: 'List Files',
    description:
      'List files in Google Drive, optionally filtered to a specific folder. Returns file metadata including id, name, mimeType, size, and modifiedTime.',
    inputSchema: {
      folderId: z.string().optional().describe('Folder ID to list files from. Omit for root / recent files.'),
      pageSize: z.number().optional().describe('Number of files to return (default 20, max 100).'),
      pageToken: z.string().optional().describe('Token for fetching the next page of results.'),
    },
  },
  async ({ folderId, pageSize, pageToken }) => {
    const result = await listFiles({ folderId, pageSize, pageToken });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── search_files ────────────────────────────────────────────

server.registerTool(
  'search_files',
  {
    title: 'Search Files',
    description:
      'Full-text search across Google Drive files. Searches file names and content.',
    inputSchema: {
      query: z.string().describe('Search query text.'),
      pageSize: z.number().optional().describe('Number of results to return (default 20, max 100).'),
      pageToken: z.string().optional().describe('Token for the next page of results.'),
    },
  },
  async ({ query, pageSize, pageToken }) => {
    const result = await searchFiles(query, { pageSize, pageToken });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── read_file ───────────────────────────────────────────────

server.registerTool(
  'read_file',
  {
    title: 'Read File',
    description:
      'Read the content of a file from Google Drive. Google Docs are exported with text and embedded images, Sheets as CSV. Returns metadata, content, and any inline images.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID.'),
    },
  },
  async ({ fileId }) => {
    const result = await readFile(fileId);
    const content = [
      { type: 'text', text: `--- Metadata ---\n${JSON.stringify(result.metadata, null, 2)}\n\n--- Content ---\n${result.content}` },
    ];
    // Append embedded images as MCP image content items
    if (result.images && result.images.length > 0) {
      result.images.forEach((img, i) => {
        content.push({
          type: 'image',
          data: img.data,
          mimeType: img.mimeType,
        });
      });
    }
    return { content };
  },
);

// ── create_file ─────────────────────────────────────────────

server.registerTool(
  'create_file',
  {
    title: 'Create File',
    description:
      'Create a new file in Google Drive with the given content.',
    inputSchema: {
      name: z.string().describe('File name (e.g. "notes.txt").'),
      content: z.string().describe('Text content of the file.'),
      mimeType: z.string().optional().describe('MIME type (default "text/plain").'),
      folderId: z.string().optional().describe('Parent folder ID. Omit for root.'),
    },
  },
  async ({ name, content, mimeType, folderId }) => {
    const result = await createFile({ name, content, mimeType, folderId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── create_folder ──────────────────────────────────────────

server.registerTool(
  'create_folder',
  {
    title: 'Create Folder',
    description:
      'Create a new folder in Google Drive.',
    inputSchema: {
      name: z.string().describe('Folder name.'),
      folderId: z.string().optional().describe('Parent folder ID. Omit for root.'),
    },
  },
  async ({ name, folderId }) => {
    const result = await createFolder({ name, folderId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── write_file ──────────────────────────────────────────────

server.registerTool(
  'write_file',
  {
    title: 'Write / Update File',
    description:
      'Update the content of an existing file in Google Drive.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID to update.'),
      content: z.string().describe('New text content for the file.'),
      mimeType: z.string().optional().describe('MIME type (default "text/plain").'),
    },
  },
  async ({ fileId, content, mimeType }) => {
    const result = await updateFile({ fileId, content, mimeType });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── edit_document_text ──────────────────────────────────────

server.registerTool(
  'edit_document_text',
  {
    title: 'Edit Document Text',
    description:
      "Surgically replace specific text within a Google Doc in place, preserving the document's existing formatting (headings, fonts, styles). Use this instead of write_file when you want to change existing text without overwriting the whole document. Each replacement finds every occurrence of a string and swaps in new text, which inherits the formatting of the text it replaces. To target a single spot, find on a unique string.",
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID of the Google Doc.'),
      replacements: z
        .array(
          z.object({
            find: z.string().describe('Exact text to find in the document.'),
            replace: z.string().describe('Replacement text. Inherits the formatting of the matched text.'),
            matchCase: z.boolean().optional().describe('Case-sensitive search (default true).'),
          }),
        )
        .min(1)
        .describe('One or more find/replace operations, applied in a single atomic batch.'),
    },
  },
  async ({ fileId, replacements }) => {
    const result = await replaceDocumentText({ fileId, replacements });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── insert_document_text ────────────────────────────────────

server.registerTool(
  'insert_document_text',
  {
    title: 'Insert Document Text',
    description:
      'Insert new text into a Google Doc at a specific character index, without overwriting the rest of the document. By default the inserted text inherits the formatting of the preceding character; pass fontFamily and/or bold to style the inserted range. Use read_file or a document-structure inspection to find the target index. When inserting at multiple points, apply edits bottom-up (highest index first) since each insert shifts later indices. Use "\\n" to start a new paragraph and "\\v" (vertical tab) for a line break within a paragraph.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID of the Google Doc.'),
      index: z.number().int().min(1).describe('Document body index to insert at (1 = beginning of the body).'),
      text: z.string().describe('Text to insert.'),
      fontFamily: z.string().optional().describe('Font family to apply to the inserted text (e.g. "Roboto Mono"). Omit to inherit adjacent formatting.'),
      bold: z.boolean().optional().describe('Whether the inserted text should be bold. Omit to inherit adjacent formatting.'),
    },
  },
  async ({ fileId, index, text, fontFamily, bold }) => {
    const result = await insertDocumentText({ fileId, index, text, fontFamily, bold });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── upload_file ─────────────────────────────────────────────

server.registerTool(
  'upload_file',
  {
    title: 'Upload File',
    description:
      'Upload a local file to Google Drive.',
    inputSchema: {
      name: z.string().describe('Name for the file in Drive.'),
      localPath: z.string().describe('Absolute path to the local file.'),
      mimeType: z.string().optional().describe('MIME type. Auto-detected if omitted.'),
      folderId: z.string().optional().describe('Parent folder ID. Omit for root.'),
    },
  },
  async ({ name, localPath, mimeType, folderId }) => {
    const result = await uploadFile({ name, localPath, mimeType, folderId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── delete_file ────────────────────────────────────────────

server.registerTool(
  'delete_file',
  {
    title: 'Delete File',
    description:
      'Permanently delete a file from Google Drive. This cannot be undone.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID to delete.'),
    },
  },
  async ({ fileId }) => {
    const result = await deleteFile(fileId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── delete_folder ─────────────────────────────────────────

server.registerTool(
  'delete_folder',
  {
    title: 'Delete Folder',
    description:
      'Permanently delete a folder and all of its contents from Google Drive. This cannot be undone.',
    inputSchema: {
      folderId: z.string().describe('The Google Drive folder ID to delete.'),
    },
  },
  async ({ folderId }) => {
    const result = await deleteFile(folderId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── copy_file ──────────────────────────────────────────────

server.registerTool(
  'copy_file',
  {
    title: 'Copy File',
    description:
      'Create a copy of an existing Google Drive file. Preserves all content, formatting, and embedded images.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID to copy.'),
      name: z.string().describe('Name for the new copy.'),
      folderId: z.string().optional().describe('Parent folder ID for the copy. Omit to use the same folder.'),
    },
  },
  async ({ fileId, name, folderId }) => {
    const result = await copyFile({ fileId, name, folderId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── insert_image ───────────────────────────────────────────

server.registerTool(
  'insert_image',
  {
    title: 'Insert Image',
    description:
      'Insert an image into a Google Doc at a given document index. Use index 1 to insert at the very beginning of the document. The image must be a publicly accessible URL.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID of the Google Doc.'),
      uri: z.string().describe('Public URL of the image to insert (PNG, JPEG, or GIF, max 50 MB).'),
      index: z.number().int().min(1).optional().describe('Document body index to insert at (default 1 = beginning of doc).'),
    },
  },
  async ({ fileId, uri, index }) => {
    const result = await insertImage({ fileId, uri, index });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── replace_image ──────────────────────────────────────────

server.registerTool(
  'replace_image',
  {
    title: 'Replace Image',
    description:
      'Replace an embedded image in a Google Doc by its index (1-based, matching [image N] placeholders from read_file). The replacement must be a publicly accessible image URL.',
    inputSchema: {
      fileId: z.string().describe('The Google Drive file ID of the Google Doc.'),
      imageIndex: z.number().int().min(1).describe('1-based index of the image to replace (matches [image N] from read_file output).'),
      uri: z.string().describe('Public URL of the replacement image (PNG, JPEG, or GIF, max 50 MB).'),
    },
  },
  async ({ fileId, imageIndex, uri }) => {
    const result = await replaceImage({ fileId, imageIndex, uri });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ── start ───────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
