import QtQuick

// Put one inside a card or row, with a key and a signature of its content:
// the card pops in the first time the key shows, and its edge glows gold when
// the same key comes back with different content this window didn't just
// change (so a phone, the assistant or an AI editing it shows up here).
// It only animates its parent's scale, so the parent's own opacity bindings stay.
Item {
    id: h
    property string key: ""
    property string sig: ""
    property bool ready: false
    anchors.fill: parent
    z: 40

    // Fades the card in from the page colour while it scales up.
    // Covers a never-seen card from its first frame, so it never flashes before popping in.
    Rectangle { id: veil; anchors.fill: parent; color: Theme.bg; opacity: h.key !== "" && Motion.sigs[h.key] === undefined ? 1 : 0 }
    Rectangle { id: wash; anchors.fill: parent; color: Theme.gold; opacity: 0 }
    Rectangle { id: edge; anchors.fill: parent; anchors.margins: -2; color: "transparent"; border.width: 2; border.color: Theme.gold; opacity: 0 }

    SequentialAnimation {
        id: pop
        property alias wait: pause.duration
        PauseAnimation { id: pause; duration: 0 }
        ParallelAnimation {
            NumberAnimation { target: veil; property: "opacity"; to: 0; duration: 240; easing.type: Easing.OutQuad }
            NumberAnimation { target: h.parent; property: "scale"; from: 0.9; to: 1; duration: 420; easing.type: Easing.OutBack; easing.overshoot: 1.8 }
        }
    }
    SequentialAnimation {
        id: glow
        ParallelAnimation {
            NumberAnimation { target: edge; property: "opacity"; to: 1; duration: 160 }
            NumberAnimation { target: wash; property: "opacity"; to: 0.14; duration: 160 }
            NumberAnimation { target: h.parent; property: "scale"; to: 1.02; duration: 160; easing.type: Easing.OutQuad }
        }
        ParallelAnimation {
            NumberAnimation { target: h.parent; property: "scale"; to: 1; duration: 420; easing.type: Easing.OutBack }
            SequentialAnimation {
                PauseAnimation { duration: 600 }
                ParallelAnimation {
                    NumberAnimation { target: edge; property: "opacity"; to: 0; duration: 1500; easing.type: Easing.OutCubic }
                    NumberAnimation { target: wash; property: "opacity"; to: 0; duration: 1500; easing.type: Easing.OutCubic }
                }
            }
        }
    }

    ParallelAnimation {
        id: fade
        NumberAnimation { id: rest; target: edge; property: "opacity"; to: 0; duration: 1300; easing.type: Easing.OutCubic }
        NumberAnimation { target: wash; property: "opacity"; to: 0; duration: rest.duration; easing.type: Easing.OutCubic }
    }

    function check() {
        const r = Motion.track(h.key, h.sig);
        if (r === "new") {
            veil.opacity = 1;
            h.parent.scale = 0.9;
            pop.wait = Motion.nextDelay();
            pop.restart();
        } else if (r === "changed" && !Motion.isLocal()) {
            glow.restart();
        } else if (r === "glowing") {
            // A card rebuilt mid-glow picks it up where the old one was.
            const left = Motion.glowLeft(h.key);
            edge.opacity = Math.min(1, left / 1500);
            wash.opacity = 0.14 * edge.opacity;
            rest.duration = left;
            fade.restart();
        }
    }
    Component.onCompleted: { check(); ready = true; }
    onSigChanged: if (ready) check()
    onKeyChanged: if (ready) check()
}
