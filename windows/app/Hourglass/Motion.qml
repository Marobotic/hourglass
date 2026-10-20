pragma Singleton
import QtQuick

// The window's motion, in one place (the same feel as Tasks): what has been
// on screen before, so cards pop in only the first time they show and glow
// when they change by themselves (a sync, the assistant, an AI over MCP), and
// the little pixel burst for finishing things. Lively.qml uses it per card.
QtObject {
    id: m

    // Last content seen per key ("note:<id>" and the like).
    property var sigs: ({})
    // Until when a change is this window's own doing (no glow for it).
    property double localUntil: 0
    // Cards that appear together cascade: each gets a little more delay.
    property int cascade: 0
    property Timer cascadeReset: Timer { interval: 90; onTriggered: m.cascade = 0 }

    // Keys glowing right now, until when: a list that rebuilds its cards mid-glow
    // (the notes grid re-sorts) hands the glow on to the new card.
    property var glowUntil: ({})

    // "new" the first time a key shows, "changed" when its content differs from
    // last time, "glowing" for a rebuilt card whose key is still mid-glow.
    function track(key, sig) {
        if (!key) return "same";
        const old = sigs[key];
        sigs[key] = sig;
        if (old === undefined) return "new";
        if (old !== sig) {
            if (!isLocal()) glowUntil[key] = Date.now() + 2300;
            return "changed";
        }
        return glowLeft(key) > 0 ? "glowing" : "same";
    }
    // How much of a key's glow is still to come, in ms.
    function glowLeft(key) { return Math.max(0, (glowUntil[key] || 0) - Date.now()); }
    function nextDelay() {
        const d = Math.min(cascade * 45, 420);
        cascade++;
        cascadeReset.restart();
        return d;
    }
    // Api calls this for every change the window makes.
    function touchLocal() { localUntil = Date.now() + 4000; }
    function isLocal() { return Date.now() < localUntil; }

    // A burst of sand-coloured pixels at a point in an item (Main draws it).
    signal burst(real x, real y)
    function burstAt(item, x, y) {
        if (!item) return;
        const p = item.mapToItem(null, x, y);
        burst(p.x, p.y);
    }
}
