import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A focused publication guard, not a substitute for reviewing what is published.
export function privatePathReason(file) {
    const parts = file.replaceAll('\\', '/').toLowerCase().split('/');
    const name = parts.at(-1);
    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return 'Private environment file';
    if (['.envrc', '.netrc', '.npmrc', '.pypirc'].includes(name)) return 'Local credential configuration';
    if (parts.some(part => ['.aws', '.ssh', '.kube'].includes(part))) return 'Private account configuration';
    if (/\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name)) return 'Private key or signing store';
    if (/^(?:service[-_]account.*|credentials|application_default_credentials)\.json$/.test(name)) return 'Credential JSON file';
    return null;
}

const tokenPatterns = [
    ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
    ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
    ['Google OAuth secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g],
    ['Slack token', /\b(?:xox[baprs]-[A-Za-z0-9-]{20,}|xapp-[A-Za-z0-9-]{20,})\b/g],
    ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]{16,}/g],
    ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
    ['Private key material', /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g],
    ['Credentials in HTTP URL', /\bhttps?:\/\/[^\s/@?\#<>"'`]+@[^\s/<>"'`]+/gi],
];

function placeholder(value) {
    return /^(?:example|sample|dummy|placeholder|changeme|change[-_]?me|replace[-_ ]?me|your[-_ ]|<)/i.test(value)
        || /\$\{|process\.env|os\.environ|Deno\.env|getenv\(/.test(value);
}

export function scanText(text, file = '<content>') {
    const findings = [];
    const seen = new Set();
    const add = (label, offset) => {
        const line = text.slice(0, offset).split('\n').length;
        const key = `${label}:${line}`;
        if (!seen.has(key)) findings.push({ path: file, line, label });
        seen.add(key);
    };
    for (const [label, pattern] of tokenPatterns) {
        for (const match of text.matchAll(pattern)) add(label, match.index);
    }
    // Check the structure as well as the prefix to avoid matching ordinary dotted text.
    for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}\b/g)) {
        try {
            const [header, payload] = match[0].split('.').slice(0, 2).map(part => JSON.parse(Buffer.from(part, 'base64url').toString()));
            if (typeof header?.alg === 'string' && payload && typeof payload === 'object') add('JWT credential', match.index);
        } catch { /* Not a JSON Web Token. */ }
    }
    // Only literal secret assignments: access codes used as game/test data are excluded.
    const quoted = /\b([A-Za-z0-9_]*password|passwd|pwd|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key)["']?\s*[:=]\s*(["'])([^\r\n"']{8,})\2/gi;
    const env = /^\s*(?:export\s+)?([A-Z0-9_]*PASSWORD|PASSWD|PWD|CLIENT_SECRET|AWS_SECRET_ACCESS_KEY)\s*=\s*([^\s"'`#]{8,})\s*(?:#.*)?$/gm;
    for (const pattern of [quoted, env]) {
        for (const match of text.matchAll(pattern)) {
            const value = pattern === quoted ? match[3] : match[2];
            if (!placeholder(value)) add(/aws/i.test(match[1]) ? 'AWS secret access key' : 'Literal password or client secret', match.index);
        }
    }
    if (file.replaceAll('\\', '/').split('/').at(-1).toLowerCase() === '.env.example') {
        for (const match of text.matchAll(/^[ \t]*(?:export[ \t]+)?ACCESS_CODE[ \t]*=[ \t]*([^\r\n]*)/gm)) {
            if (!/^(?:""|'')?[ \t]*(?:#.*)?$/.test(match[1])) add('Nonempty example access code', match.index);
        }
    }
    return findings;
}

function git(root, args, input) {
    try {
        return execFileSync('git', args, { cwd: root, input, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
        // Git errors can include file content or command input. Never forward them.
        throw new Error('Unable to inspect Git repository');
    }
}

function readBlobs(root, blobs) {
    if (!blobs.length) return [];
    const batch = git(root, ['cat-file', '--batch'], `${blobs.join('\n')}\n`);
    const result = [];
    let offset = 0;
    for (const id of blobs) {
        const end = batch.indexOf(10, offset);
        const [actualId, type, bytes] = batch.subarray(offset, end).toString().split(' ');
        const size = Number(bytes);
        if (end < 0 || actualId !== id || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || end + size + 1 >= batch.length)
            throw new Error('Unable to inspect Git contents');
        result.push({ id, text: batch.subarray(end + 1, end + 1 + size).toString('utf8') });
        offset = end + size + 2;
    }
    return result;
}

function historyContents(root) {
    const ids = git(root, ['rev-list', '--objects', '--all', '--no-object-names']).toString().trim();
    if (!ids) return [];
    const blobs = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], `${ids}\n`).toString().trim().split('\n')
        .filter(line => line.endsWith(' blob')).map(line => line.split(' ')[0]);
    return readBlobs(root, blobs);
}

export function auditRepository(root, { history = false } = {}) {
    const findings = [];
    const seen = new Set();
    const add = (finding, scope) => {
        const entry = { scope, ...finding };
        const key = JSON.stringify(entry);
        if (!seen.has(key)) findings.push(entry);
        seen.add(key);
    };
    const paths = [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))];
    let worktreeFiles = 0;
    for (const file of paths) {
        const label = privatePathReason(file);
        if (label) add({ path: file, line: 1, label }, 'worktree');
        let content;
        try {
            const full = resolve(root, file);
            const stat = lstatSync(full);
            if (stat.isSymbolicLink()) content = readlinkSync(full); // Do not follow links outside the repository.
            else if (stat.isFile()) content = readFileSync(full, 'utf8');
            else continue;
        } catch (error) {
            if (error.code === 'ENOENT') continue; // Locally deleted tracked files have no worktree contents.
            throw new Error('Unable to read a repository file');
        }
        worktreeFiles++;
        for (const finding of scanText(content, file)) add(finding, 'worktree');
    }
    // A safe working copy must not conceal a credential already staged for commit.
    const indexPathsByBlob = new Map();
    const indexPaths = new Set();
    for (const entry of git(root, ['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean)) {
        const tab = entry.indexOf('\t');
        const [mode, id] = entry.slice(0, tab).split(' ');
        if (!['100644', '100755', '120000'].includes(mode)) continue; // Submodule entries are commits, not files.
        const file = entry.slice(tab + 1);
        indexPaths.add(file);
        if (!indexPathsByBlob.has(id)) indexPathsByBlob.set(id, new Set());
        indexPathsByBlob.get(id).add(file);
        const label = privatePathReason(file);
        if (label) add({ path: file, line: 1, label }, 'index');
    }
    for (const { id, text } of readBlobs(root, [...indexPathsByBlob.keys()])) {
        for (const file of indexPathsByBlob.get(id))
            for (const finding of scanText(text, file)) add(finding, 'index');
    }
    let historyBlobs = 0;
    const historicalPaths = new Set();
    if (history) {
        const pathsByBlob = new Map();
        const trees = new Set(git(root, ['log', '--all', '--format=%T']).toString().trim().split('\n').filter(Boolean));
        for (const tree of trees) {
            for (const entry of git(root, ['ls-tree', '-r', '-z', '--full-tree', tree]).toString().split('\0').filter(Boolean)) {
                const tab = entry.indexOf('\t');
                const [, type, id] = entry.slice(0, tab).split(' ');
                if (type !== 'blob') continue;
                const file = entry.slice(tab + 1);
                historicalPaths.add(file);
                if (!pathsByBlob.has(id)) pathsByBlob.set(id, new Set());
                pathsByBlob.get(id).add(file);
                const label = privatePathReason(file);
                if (label) add({ path: file, line: 1, label }, 'history');
            }
        }
        for (const { id, text } of historyContents(root)) {
            historyBlobs++;
            for (const file of pathsByBlob.get(id) ?? [`git-blob:${id}`])
                for (const match of scanText(text, file)) add(match, 'history');
        }
    }
    return { worktreeFiles, indexFiles: indexPaths.size, historyBlobs, historicalPaths: historicalPaths.size, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.slice(2).some(arg => arg !== '--history')) throw new Error('Usage: node scripts/check-public-repo.mjs [--history]');
        const result = auditRepository(fileURLToPath(new URL('..', import.meta.url)), { history: process.argv.includes('--history') });
        for (const finding of result.findings) console.error(JSON.stringify(finding));
        const counts = `${result.worktreeFiles} worktree files, ${result.indexFiles} index files, ${result.historyBlobs} historical blobs, ${result.historicalPaths} historical paths`;
        if (result.findings.length) {
            console.error(`Public-repository check failed: ${result.findings.length} finding(s); ${counts}. Credential values are redacted.`);
            process.exitCode = 1;
        } else console.log(`Public-repository check passed: ${counts}.`);
    } catch {
        console.error('Public-repository check could not complete. Confirm this is a readable Git checkout and use only --history.');
        process.exitCode = 2;
    }
}
