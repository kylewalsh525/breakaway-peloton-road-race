import { createApp } from './app.mjs';
import { fileURLToPath } from 'node:url';
try {
    process.loadEnvFile();
}
catch (error) {
    if (error.code !== 'ENOENT')
        throw error;
}
const int = (v, d) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : d;
const app = await createApp({ maxRooms: int(process.env.MAX_ROOMS, 32), maxSessions: int(process.env.MAX_SESSIONS, 256),
    dataDir: process.env.DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url)), publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean), accessCode: process.env.ACCESS_CODE || undefined });
const host = process.env.HOST || '127.0.0.1', port = await app.listen(int(process.env.PORT, 8787), host);
console.log(`\n  BREAKAWAY / ASPHALT ARCADE\n  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n  No package install or API key required.\n  Use HTTPS before accessing a microphone from another device.\n`);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => { if (stopping)
        return; stopping = true; await app.close(); process.exit(0); });
