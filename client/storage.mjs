import { emptyProfile } from '../shared/profile.mjs';
export function load(key, fallback) { try {
    const parsed = JSON.parse(localStorage.getItem('breakaway.' + key) || 'null');
    return parsed ?? fallback;
}
catch {
    return fallback;
} }
export function save(key, value) { try {
    localStorage.setItem('breakaway.' + key, JSON.stringify(value));
    return true;
}
catch {
    return false;
} }
export function loadProfile() { const p = load('profile', null); return p && p.version === 1 && Array.isArray(p.history) && Array.isArray(p.achievements) && Number.isFinite(p.xp) ? p : emptyProfile(); }
export function download(name, data, type = 'application/json') {
    if (window.BreakawayBridge?.exportFile) {
        window.BreakawayBridge.exportFile(name, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        return;
    }
    const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value) { const text = String(value ?? ''); return '"' + (/^[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"'; }
