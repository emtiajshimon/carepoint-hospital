// api/ask.js — Vercel serverless version of the POST /ask route in server.js.
// No dependencies, native Node.js https only.
// Key priority: Settings-page key (X-API-Key header) first,
// CHATTERMATE_API_KEY environment variable (Vercel dashboard) as fallback.

const https = require('https');

const SYSTEM_PROMPT = "You are a hospital report assistant. Answer only from the report data given. Never invent numbers. If the data doesn't have the answer, say so. Money is in Taka (Tk). Keep answers short. You cannot change any data; refuse requests to edit or delete.";

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error('ChatterMate API returned HTTP ' + res.statusCode + ': ' + body));
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function fetchDefaultModelId(apiKey) {
  return httpsRequest({
    hostname: 'chattermate.ai',
    port: 443,
    path: '/api/chat/models',
    method: 'GET',
    headers: { 'X-API-Key': apiKey, 'User-Agent': 'CarePoint-Hospital-Server/1.0' }
  }).then((body) => {
    const data = JSON.parse(body);
    if (data.default_model_id) return data.default_model_id;
    if (Array.isArray(data.models)) {
      const d = data.models.find((m) => m.is_default || m.is_default_text);
      if (d) return d.id;
      if (data.models.length > 0) return data.models[0].id;
    }
    throw new Error('No valid model identifier found from ChatterMate models API.');
  });
}

function queryChatterMateStream(modelId, promptText, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ models: [modelId], system_prompt: SYSTEM_PROMPT, prompt: promptText });
    const req = https.request({
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
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (c) => { errBody += c; });
        res.on('end', () => reject(new Error('Stream endpoint returned HTTP ' + res.statusCode + ': ' + errBody)));
        return;
      }
      let accumulated = '';
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        let lastEvent = null;
        for (const raw of lines) {
          const line = raw.trim();
          if (line.startsWith('event:')) lastEvent = line.replace('event:', '').trim();
          else if (line.startsWith('data:')) {
            const dataStr = line.replace('data:', '').trim();
            if (dataStr && (lastEvent === 'model_chunk' || !lastEvent)) {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.content) accumulated += parsed.content;
              } catch (e) {
                if (dataStr !== '[DONE]') accumulated += dataStr;
              }
            }
          }
        }
      });
      res.on('end', () => resolve(accumulated.trim()));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = req.headers['x-api-key'] || process.env.CHATTERMATE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'No ChatterMate API key found. Open Settings in the app and paste your key, or set CHATTERMATE_API_KEY in the Vercel project settings.' });
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
    const question = body.question || '';
    const reportData = body.data || {};
    if (!question) return res.status(400).json({ error: 'Question is required' });
    const composedPrompt = 'Report data: ' + JSON.stringify(reportData) + ' Question: ' + question;
    const modelId = await fetchDefaultModelId(apiKey);
    const answer = await queryChatterMateStream(modelId, composedPrompt, apiKey);
    return res.status(200).json({ answer: answer || "I don't have enough data in the report to answer that." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
