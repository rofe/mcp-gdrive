#!/usr/bin/env node

/**
 * MCP server for Google Drive.
 *
 * Tools: list_files, search_files, read_file, create_file, write_file, upload_file, replace_image
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
  replaceImage,
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
