import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditRepository, privatePathReason, scanText } from '../scripts/check-public-repo.mjs';

const random = (length = 40) => randomBytes(length).toString('hex').slice(0, length);
const token = (...parts) => parts.join('') + random();

test('known credential formats report only paths, lines, and labels', () => {
    const jwt = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sub: random(12) })).toString('base64url'),
        random(40),
    ].join('.');
    const cases = [
        [token('sk', '-', 'proj', '-'), 'OpenAI API key'],
        [token('gh', 'p_'), 'GitHub token'],
        [token('github', '_pat_'), 'GitHub token'],
        [['A', 'KIA'].join('') + random(16).toUpperCase(), 'AWS access key'],
        [['AI', 'za'].join('') + random(35), 'Google API key'],
        [token('GOC', 'SPX-'), 'Google OAuth secret'],
        [token('xox', 'b-'), 'Slack token'],
        [['https://hooks.', 'slack.com/services/', random(12), '/', random(12), '/', random(30)].join(''), 'Slack webhook'],
        [token('sk', '_live_'), 'Stripe secret key'],
        [token('rk', '_test_'), 'Stripe secret key'],
        [['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'].join(''), 'Private key material'],
        [jwt, 'JWT credential'],
        [['https://', random(8), ':', random(), '@example.invalid/path'].join(''), 'Credentials in HTTP URL'],
        [['http://', random(), '@example.invalid/path'].join(''), 'Credentials in HTTP URL'],
    ];
    for (const [value, label] of cases) {
        const findings = scanText(`safe\n${value}\n`, 'fixture.txt');
        assert.equal(findings.some(finding => finding.label === label && finding.line === 2), true, label);
        assert.equal(JSON.stringify(findings).includes(value), false, 'Finding must not include credential contents');
        assert.equal(findings.every(finding => Object.keys(finding).sort().join(',') === 'label,line,path'), true);
    }
});

test('literal passwords and cloud secrets are detected without matching references or fixtures', () => {
    for (const key of ['password', 'db_password', 'client_secret', 'aws_secret_access_key']) {
        assert.equal(scanText(`${key}: '${random()}'`).length, 1, key);
    }
    for (const key of ['PASSWORD', 'DATABASE_PASSWORD', 'AWS_SECRET_ACCESS_KEY']) {
        assert.equal(scanText(`${key}=${random()}`).length, 1, key);
    }
    const safe = [
        "password: process.env.PASSWORD",
        'PASSWORD=${DATABASE_PASSWORD}',
        "password: 'your-password-here'",
        "password: 'example-password'",
        "password: '<replace with password>'",
        "accessCode: 'only-my-friends'",
        'ACCESS_CODE=',
    ].join('\n');
    assert.equal(scanText(safe).length, 0);
});

test('environment templates require a blank access code without matching game fixtures', () => {
    for (const value of ['', '   ', "''", '""', '# set locally', "'' # set locally"]) {
        assert.equal(scanText(`PORT=8787\nACCESS_CODE=${value}\n`, 'config/.env.example').length, 0);
    }
    const value = random(12);
    for (const file of ['.env.example', 'config/.env.example']) {
        const findings = scanText(`PORT=8787\nACCESS_CODE=${value}\n`, file);
        assert.deepEqual(findings, [{ path: file, line: 2, label: 'Nonempty example access code' }]);
        assert.equal(JSON.stringify(findings).includes(value), false);
    }
    assert.equal(scanText("accessCode: 'only-my-friends'", 'tests/server.test.mjs').length, 0);
    assert.equal(scanText('https://example.invalid/path https://example.invalid?email=user@example.invalid https://example.invalid#user@example.invalid').length, 0);
});

test('private path policy permits the environment template and ordinary source files', () => {
    for (const file of ['.env', 'config/.env.production', '.envrc', '.aws/config', '.ssh/id_ed25519', '.kube/config', '.netrc', '.npmrc', '.pypirc', 'keys/sign.pem', 'keys/sign.key', 'sign.p12', 'sign.pfx', 'sign.jks', 'sign.keystore', 'service-account-dev.json', 'credentials.json'])
        assert.equal(typeof privatePathReason(file), 'string', file);
    for (const file of ['.env.example', 'nested/.env.example', 'shared/credentials.mjs', 'docs/environment.md'])
        assert.equal(privatePathReason(file), null, file);
});

test('the guard and its synthetic fixtures contain no credential candidates', () => {
    for (const url of [new URL('../scripts/check-public-repo.mjs', import.meta.url), import.meta.url])
        assert.equal(scanText(readFileSync(new URL(url), 'utf8')).length, 0);
});

function temporaryRepository(t) {
    const root = mkdtempSync(join(tmpdir(), 'breakaway-public-check-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    const commit = () => git('-c', 'user.name=Publication Guard Test', '-c', 'user.email=guard@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic fixture');
    return { root, git, commit };
}

test('repository scan includes staged and untracked files, excludes ignored files, and does not follow symlinks', t => {
    const { root, git } = temporaryRepository(t);
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'tracked.txt'), `safe\n${token('gh', 'p_')}\n`);
    git('add', 'tracked.txt');
    writeFileSync(join(root, 'untracked.txt'), token('sk', '_live_'));
    writeFileSync(join(root, 'ignored.txt'), token('sk', '-', 'proj', '-'));
    writeFileSync(join(root, '.env.production'), '');
    symlinkSync(join(root, 'ignored.txt'), join(root, 'outside-link'));
    const result = auditRepository(root);
    assert.equal(result.worktreeFiles, 5);
    assert.equal(result.indexFiles, 1);
    assert.deepEqual(result.findings.filter(finding => finding.scope === 'worktree').map(({ path, line, label }) => ({ path, line, label })).sort((a, b) => a.path.localeCompare(b.path)), [
        { path: '.env.production', line: 1, label: 'Private environment file' },
        { path: 'tracked.txt', line: 2, label: 'GitHub token' },
        { path: 'untracked.txt', line: 1, label: 'Stripe secret key' },
    ]);
});

test('index credentials remain visible after a safe working-copy overwrite', t => {
    const { root, git } = temporaryRepository(t);
    const value = token('gh', 'p_');
    writeFileSync(join(root, 'staged.txt'), `safe\n${value}\n`);
    writeFileSync(join(root, '.env.example'), `ACCESS_CODE=${random(12)}\n`);
    git('add', 'staged.txt', '.env.example');
    writeFileSync(join(root, 'staged.txt'), 'safe\n');
    writeFileSync(join(root, '.env.example'), 'ACCESS_CODE=\n');
    const result = auditRepository(root);
    assert.equal(result.worktreeFiles, 2);
    assert.equal(result.indexFiles, 2);
    assert.equal(result.findings.length, 2);
    assert.equal(result.findings.every(finding => finding.scope === 'index'), true);
    assert.equal(result.findings.some(finding => finding.path === 'staged.txt' && finding.line === 2 && finding.label === 'GitHub token'), true);
    assert.equal(result.findings.some(finding => finding.path === '.env.example' && finding.label === 'Nonempty example access code'), true);
    assert.equal(JSON.stringify(result).includes(value), false);
});

test('history scan finds removed credentials and all historical private filenames', t => {
    const { root, git, commit } = temporaryRepository(t);
    const value = token('gh', 'p_');
    writeFileSync(join(root, 'removed.txt'), `safe\n${value}\n`);
    writeFileSync(join(root, '.env.production'), 'PORT=8787\n');
    writeFileSync(join(root, 'safe.txt'), 'PORT=8787\n'); // Same blob under a public filename.
    git('add', '.');
    commit();
    git('rm', '-q', 'removed.txt', '.env.production');
    commit();
    assert.equal(auditRepository(root).findings.length, 0);
    const result = auditRepository(root, { history: true });
    assert.equal(result.historyBlobs, 2);
    assert.equal(result.historicalPaths, 3);
    assert.equal(result.findings.some(finding => finding.path === 'removed.txt' && finding.line === 2 && finding.label === 'GitHub token'), true);
    assert.equal(result.findings.some(finding => finding.path === '.env.production' && finding.label === 'Private environment file'), true);
    assert.equal(JSON.stringify(result).includes(value), false, 'History findings must be redacted');
});

test('history applies the environment-template policy to each blob filename', t => {
    const { root, git, commit } = temporaryRepository(t);
    const contents = `ACCESS_CODE=${random(12)}\n`;
    writeFileSync(join(root, '.env.example'), contents);
    writeFileSync(join(root, 'fixture.txt'), contents);
    git('add', '.');
    commit();
    writeFileSync(join(root, '.env.example'), 'ACCESS_CODE=\n');
    git('add', '.env.example');
    commit();
    assert.equal(auditRepository(root).findings.length, 0);
    assert.deepEqual(auditRepository(root, { history: true }).findings, [
        { scope: 'history', path: '.env.example', line: 1, label: 'Nonempty example access code' },
    ]);
});

test('CLI module imports without inspecting a repository or writing output', () => {
    const url = new URL('../scripts/check-public-repo.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
});
