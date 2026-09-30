/* This tiny classic script can explain unsupported WebViews before the module parser runs. */
if (!Object.hasOwn)
    Object.hasOwn = function (object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
        if (!window.breakawayStarted) {
            var boot = document.getElementById('boot');
            if (boot)
                boot.textContent = 'BREAKAWAY could not start. Use Chrome / Android System WebView 90 or newer, or open the game on a separate device. See docs/COMPATIBILITY.md. Check the browser console for details.';
        }
    }, 7000);
});
