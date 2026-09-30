export const $ = id => document.getElementById(id);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const timeLabel = value => value === null || value === undefined ? 'DNF' : `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
let toastTimer, modalClose = null, previousFocus = null;
export function toast(message, duration = 4000) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), duration); }
export function modal(title, html, close = null) { previousFocus = document.activeElement; $('modal-title').textContent = title; $('modal-content').innerHTML = html; $('modal').classList.remove('hidden'); modalClose = close; setTimeout(() => { $('modal').querySelector('input, button, select')?.focus(); }, 0); }
export function closeModal() { if ($('modal').classList.contains('hidden'))
    return; $('modal').classList.add('hidden'); const fn = modalClose; modalClose = null; fn?.(); previousFocus?.focus?.(); }
$('close-modal').onclick = closeModal;
$('modal').addEventListener('click', e => { if (e.target === $('modal'))
    closeModal(); });
document.addEventListener('keydown', e => {
    if ($('modal').classList.contains('hidden'))
        return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
    }
    if (e.key === 'Tab') {
        const els = [...$('modal').querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled);
        if (!els.length)
            return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});
