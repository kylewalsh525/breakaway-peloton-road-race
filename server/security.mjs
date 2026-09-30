import { randomBytes, timingSafeEqual } from 'node:crypto';
export const token = (n = 32) => randomBytes(n).toString('hex');
export function equalSecret(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
export class RateLimiter {
    constructor(limit = 60, windowMs = 60000) { this.limit = limit; this.windowMs = windowMs; this.buckets = new Map(); }
    allow(key, now = Date.now(), cost = 1) {
        let b = this.buckets.get(key);
        if (!b || now - b.at >= this.windowMs) {
            b = { at: now, count: 0 };
            this.buckets.set(key, b);
        }
        b.count += cost;
        return b.count <= this.limit;
    }
    clean(now = Date.now()) { for (const [k, b] of this.buckets)
        if (now - b.at > this.windowMs * 2)
            this.buckets.delete(k); }
}
export async function readJson(req, max = 8192) {
    if (!(req.headers['content-type'] || '').startsWith('application/json'))
        throw new HttpError(415, 'Use application/json');
    if (Number(req.headers['content-length']) > max)
        throw new HttpError(413, 'Request too large');
    let size = 0;
    const chunks = [];
    for await (const part of req) {
        size += part.length;
        if (size > max)
            throw new HttpError(413, 'Request too large');
        chunks.push(part);
    }
    try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new Error();
        return data;
    }
    catch {
        throw new HttpError(400, 'Invalid JSON object');
    }
}
export function sendJson(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
export function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
