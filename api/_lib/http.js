/* Small helpers shared by the stint endpoints: JSON replies and a size-capped
   body reader (Vercel usually pre-parses JSON, but not for every content type). */

const MAX_BODY = 768 * 1024; // a board with 200 stints is ~40 KB; an uploaded logo can add ~250 KB.

export function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}

export function fail(res, status, message) {
  json(res, status, { error: message });
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return parse(req.body);

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Тело запроса слишком большое');
    chunks.push(chunk);
  }
  return parse(Buffer.concat(chunks).toString('utf8'));
}

function parse(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new Error('Тело запроса не является корректным JSON');
  }
}
