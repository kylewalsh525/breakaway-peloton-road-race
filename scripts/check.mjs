import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let count = 0;
for (const directory of ['shared', 'client', 'server', 'scripts', 'tests']) {
    for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
        if (!item.isFile() || !['.mjs', '.js'].includes(extname(item.name)))
            continue;
        const file = resolve(root, directory, item.name);
        const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (run.status !== 0)
            throw new Error(run.stderr);
        count++;
        const text = await readFile(file, 'utf8');
        if (/sk-(?:proj-)?[a-zA-Z0-9]{30,}|ghp_[a-zA-Z0-9]{20,}/.test(text))
            throw new Error(`Potential credential in ${file}`);
    }
}
console.log(`Checked syntax of ${count} JavaScript modules; no embedded credential patterns.`);
