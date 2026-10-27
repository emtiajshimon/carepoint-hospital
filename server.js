// =============================================================================
// server.js — CarePoint Hospital Local Server & ChatterMate AI Gateway
// Built exclusively with native Node.js modules (http, https, fs, path, url)
// ZERO external npm dependencies required.
//
// Run with:
//   node --env-file=.env server.js
//
// API key, two ways (per-request Settings key wins, .env is the fallback):
//   1. Settings page in the app (settings.html) — paste your ChatterMate key,
//      it is saved in the browser only and sent as an X-API-Key header.
//   2. .env file — CHATTERMATE_API_KEY=your_key_here (never commit a real key;
//      .env is listed in .gitignore, so it is not pushed to GitHub).
//
// Then visit:
//   http://localhost:3000
// =============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
// Fallback key from .env. A key sent with a request (Settings page) wins.
const ENV_API_KEY = process.env.CHATTERMATE_API_KEY;

// System prompt enforced by the hospital task specifications [1][2]
const SYSTEM_PROMPT = "You are a hospital report assistant. Answer only from the report data given. Never invent numbers. If the data doesn't have the answer, say so. Money is in Taka (Tk). Keep answers short. You cannot change any data; refuse requests to edit or delete.";

// MIME types for static asset serving
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// -----------------------------------------------------------------------------
// Helper: Perform an HTTPS request returning parsed JSON or string buffer
// -----------------------------------------------------------------------------
function makeHttpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        } else {
          reject(new Error(`ChatterMate API returned HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// -----------------------------------------------------------------------------
// Step 1: Query ChatterMate for default_model_id [1][2]
// -----------------------------------------------------------------------------
async function fetchDefaultModelId(apiKey) {
  const options = {
    hostname: 'chattermate.ai',
    port: 443,
    path: '/api/chat/models',
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      'User-Agent': 'CarePoint-Hospital-Server/1.0'
    }
  };

  const response = await makeHttpsRequest(options);
  const data = JSON.parse(response.body);

  // Use "default_model_id" from the JSON, or fallback to the first active model / default model
  if (data.default_model_id) {
    return data.default_model_id;
  }

  if (Array.isArray(data.models)) {
    const defaultEntry = data.models.find(m => m.is_default || m.is_default_text);
    if (defaultEntry) return defaultEntry.id;
    if (data.models.length > 0) return data.models[0].id;
  }

  throw new Error('No valid model identifier found from ChatterMate models API.');
}

// -----------------------------------------------------------------------------
// Steps 2 & 3: Stream and parse Server-Sent Events to assemble the answer [1][2]
// -----------------------------------------------------------------------------
function queryChatterMateStream(modelId, promptText, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      models: [modelId],
      system_prompt: SYSTEM_PROMPT,
      prompt: promptText
    });

    const options = {
      hostname: 'chattermate.ai',
      port: 443,
      path: '/api/chat/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-API-Key': apiKey,
        'User-Agent': 'CarePoint-Hospital-Server/1.0'
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => { errBody += chunk; });
        res.on('end', () => {
          reject(new Error(`Stream endpoint returned HTTP ${res.statusCode}: ${errBody}`));
        });
        return;
      }

      let accumulatedAnswer = '';
      let buffer = '';

      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        // Keep the last incomplete slice in buffer
        buffer = lines.pop();

        let lastEvent = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          if (line.startsWith('event:')) {
            lastEvent = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.replace('data:', '').trim();
            if (dataStr && (lastEvent === 'model_chunk' || !lastEvent)) {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.content) {
                  accumulatedAnswer += parsed.content;
                }
              } catch (e) {
                // If it's raw text chunk instead of JSON
                if (dataStr !== '[DONE]') {
                  accumulatedAnswer += dataStr;
                }
              }
            }
          }
        }
      });

      res.on('end', () => {
        resolve(accumulatedAnswer.trim());
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// -----------------------------------------------------------------------------
// Route Handler: POST /ask
// -----------------------------------------------------------------------------
async function handleAskRoute(req, res) {
  // API key priority: Settings page key (per-request header) first, .env fallback.
  const requestApiKey = req.headers['x-api-key'];
  const apiKey = requestApiKey || ENV_API_KEY;

  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'No ChatterMate API key found. Open Settings in the app and paste your key, or set CHATTERMATE_API_KEY in .env and restart the server.'
    }));
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const parsedBody = JSON.parse(body);
      const question = parsedBody.question || '';
      const reportData = parsedBody.data || {};

      if (!question) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Question is required' }));
        return;
      }

      // Format prompt exactly as specified:
      // "Report data: " + JSON of data + " Question: " + question
      const composedPrompt = `Report data: ${JSON.stringify(reportData)} Question: ${question}`;

      console.log(`[AI Query] Asking: "${question}"`);

      // 1. Get default model ID
      const defaultModelId = await fetchDefaultModelId(apiKey);

      // 2 & 3. Stream from ChatterMate and collect content chunks
      const answer = await queryChatterMateStream(defaultModelId, composedPrompt, apiKey);

      console.log(`[AI Response] Answer generated (${answer.length} chars)`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ answer: answer || "I don't have enough data in the report to answer that." }));

    } catch (err) {
      console.error('[Error processing /ask]:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// -----------------------------------------------------------------------------
// Static File Serving
// -----------------------------------------------------------------------------
function serveStaticFile(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsedUrl.pathname;

  // Root defaults to index.html or chat.html
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Prevent directory traversal attacks
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If index.html wasn't found at root, try chat.html fallback
      if (pathname === '/index.html') {
        const chatPath = path.join(__dirname, 'chat.html');
        if (fs.existsSync(chatPath)) {
          return deliverFile(chatPath, res);
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    deliverFile(filePath, res);
  });
}

function deliverFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

// -----------------------------------------------------------------------------
// Create Native HTTP Server
// -----------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // Enable local CORS headers for safe local testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && parsedUrl.pathname === '/ask') {
    handleAskRoute(req, res);
  } else if (req.method === 'GET') {
    serveStaticFile(req, res);
  } else {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  }
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log('\n======================================================');
  console.log(`🏥 CarePoint Hospital System & AI Bridge is running!`);
  console.log(`🌐 Web URL : http://localhost:${PORT}`);
  console.log(`🤖 AI Route: http://localhost:${PORT}/ask (POST)`);
  console.log(`🔑 API Key : ${ENV_API_KEY ? 'Loaded from .env' : 'Not in .env — use the Settings page in the app'}`);
  console.log('======================================================\n');
});
