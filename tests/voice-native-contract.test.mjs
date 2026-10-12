import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VOICE_ALIASES } from '../shared/voice.mjs';

test('Android offline grammar and browser voice controls support the same short phrases', async () => {
    const source = await readFile(new URL('../android/app/src/main/java/com/breakaway/race/VoiceEngine.java', import.meta.url), 'utf8');
    const declaration = source.match(/String\[\] commands\s*=\s*\{([^}]+)\}/);
    assert.ok(declaration, 'Native command grammar must remain inspectable without an Android runtime');
    const phrases = [...declaration[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(phrases.sort(), Object.keys(VOICE_ALIASES).sort());
});
