# mcp-gdrive

MCP server for Google Drive — list, search, read, write, create, and upload files.

## Setup

### 1. Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select an existing one)
3. Enable the **Google Drive API**
4. Create **OAuth 2.0 credentials** (Application type: Desktop app)
5. Download the credentials JSON and save it as `credentials.json` in the project root
   — or set `GDRIVE_CLIENT_ID` and `GDRIVE_CLIENT_SECRET` environment variables

### 2. Install dependencies

```bash
npm install
```

### 3. Authorize

```bash
npm run auth
```

This opens a browser for Google sign-in. Tokens are saved to `.gdrive-token.json` (git-ignored).

### 4. Configure your MCP client

Add to your Claude Desktop / Claude Code config:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-gdrive/src/index.js"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `list_files` | List files, optionally in a specific folder |
| `search_files` | Full-text search across Drive |
| `read_file` | Read file content (exports Google Docs as text, Sheets as CSV) |
| `create_file` | Create a new file with text content |
| `write_file` | Update an existing file's content |
| `upload_file` | Upload a local file to Drive |
