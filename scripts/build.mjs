import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))), dist = resolve(ROOT, 'dist');
await mkdir(dist, { recursive: true });
await rm(resolve(dist, 'web'), { recursive: true, force: true });
await mkdir(resolve(dist, 'web'), { recursive: true });
await cp(resolve(ROOT, 'client'), resolve(dist, 'web'), { recursive: true });
await cp(resolve(ROOT, 'shared'), resolve(dist, 'web/shared'), { recursive: true });
/** Restricted, zero-dependency static bundler for this project's named-import-only ESM.
 * This is NOT a general JS compiler. Unsupported module syntax fails the build. */
const registry = new Map();
async function bundleModule(id) {
    if (registry.has(id))
        return;
    registry.set(id, '');
    const disk = id.startsWith('/shared/') ? resolve(ROOT, id.slice(1)) : resolve(ROOT, 'client', id.slice(1));
    let source = await readFile(disk, 'utf8');
    const deps = [];
    source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, names, path) => {
        const target = path.startsWith('/') ? path : posix.normalize(posix.join(posix.dirname(id), path));
        deps.push(target);
        return `const {${names.replace(/\s+as\s+/g, ':')}} = require(${JSON.stringify(target)});`;
    });
    const names = [];
    source = source.replace(/export\s+(async\s+)?(const|let|class|function)\s+([A-Za-z_$][\w$]*)/g, (_, asyncWord, kind, name) => { names.push(name); return `${asyncWord || ''}${kind} ${name}`; });
    if (/^\s*(import|export)\s/m.test(source))
        throw new Error(`Unsupported ESM syntax in ${id}`);
    registry.set(id, `function(require,exports){'use strict';\n${source}\nObject.assign(exports,{${names.join(',')}});\n}`);
    for (const dep of deps)
        await bundleModule(dep);
}
await bundleModule('/app.mjs');
const bundle = `(()=>{'use strict';const factories={${[...registry].map(([id, code]) => JSON.stringify(id) + ':' + code).join(',\n')}};const cache={};function require(id){if(cache[id])return cache[id];const exports=cache[id]={};if(!factories[id])throw new Error('Missing module '+id);factories[id](require,exports);return exports;}require('/app.mjs');})();`;
await writeFile(resolve(dist, 'standalone.js'), bundle);
let html = await readFile(resolve(ROOT, 'client/index.html'), 'utf8'), css = await readFile(resolve(ROOT, 'client/styles.css'), 'utf8'), legacy = await readFile(resolve(ROOT, 'client/legacy.js'), 'utf8');
html = html.replace(/<link[^>]*href="\/(?:styles\.css|icon\.svg|manifest\.webmanifest)"[^>]*>/g, '')
    .replace('<script src="/legacy.js"></script>', `<script>${legacy}</script>`)
    .replace('<script type="module" src="/app.mjs"></script>', '')
    .replace('</head>', `<style>${css}</style></head>`)
    .replace('</body>', `<script>window.BREAKAWAY_STANDALONE=true;${bundle.replace(/<\/script/gi, '<\\/script')}</script></body>`);
await writeFile(resolve(dist, 'PLAY-SOLO.html'), html);
await writeFile(resolve(ROOT, 'PLAY-SOLO.html'), html);
await mkdir(resolve(ROOT, 'android/app/src/main/assets'), { recursive: true });
await rm(resolve(ROOT, 'android/app/src/main/assets/game'), { recursive: true, force: true });
await cp(resolve(dist, 'web'), resolve(ROOT, 'android/app/src/main/assets/game'), { recursive: true });
console.log(`Built web assets, Android game assets, and dist/PLAY-SOLO.html (${Math.round(Buffer.byteLength(html) / 1024)} KiB).`);
