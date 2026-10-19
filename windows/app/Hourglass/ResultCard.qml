import QtQuick
import QtQuick.Layouts

// What the assistant did, drawn: an alarm is a clock face showing its time
// with a tick, a timer a ring counting down, an event a calendar page (a cake
// for a birthday) with the days to go, a day its timeline. The server sends
// each card with its text already written (server/cards.js); this only draws.
Rectangle {
    id: card
    property var info: ({})
    property double now: Date.now()
    readonly property string kind: info.kind || ""
    readonly property string st: info.state || ""
    readonly property bool gone: st === "removed" || st === "stopped" || st === "off"
    // Timer: seconds left, counted here so the ring moves.
    readonly property double secsLeft: kind === "timer" && info.ends_at ? Math.max(0, Math.ceil((info.ends_at - now) / 1000)) : 0

    implicitWidth: 340
    implicitHeight: kind === "day" ? dayCol.implicitHeight + 24 : 92
    color: Theme.surface
    border.width: 1
    border.color: gone ? Theme.border : Theme.alpha(accentOf(), 0.55)
    opacity: (gone ? 0.75 : 1) * appear
    // It pops in once when it appears: a little rise and settle.
    property real appear: 0
    NumberAnimation on appear { from: 0; to: 1; duration: 260; easing.type: Easing.OutCubic }
    NumberAnimation on scale { from: 0.92; to: 1; duration: 380; easing.type: Easing.OutBack; easing.overshoot: 1.6 }
    // Alarm: the hands sweep round to the time.
    property real shownMinutes: (info.minutes || 0)
    NumberAnimation on shownMinutes { from: (info.minutes || 0) - 120; to: (info.minutes || 0); duration: 750; easing.type: Easing.OutCubic }
    onShownMinutesChanged: if (kind === "alarm") face.requestPaint()

    function accentOf() {
        if (kind === "alarm") return Theme.accent;
        if (kind === "timer") return Theme.teal;
        if (kind === "event") return info.birthday ? Theme.gold : Theme.orange;
        return Theme.teal;
    }
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function countdown(s) {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
        return h > 0 ? h + ":" + pad(m) + ":" + pad(x) : m + ":" + pad(x);
    }
    function badge() {
        if (st === "removed") return { text: "REMOVED", color: Theme.muted };
        if (st === "stopped") return { text: "STOPPED", color: Theme.muted };
        if (st === "off") return { text: "OFF", color: Theme.muted };
        if (st === "on") return { text: "ON", color: Theme.teal };
        if (st === "added") return { text: "ADDED", color: Theme.teal };
        if (st === "changed") return { text: "CHANGED", color: Theme.teal };
        if (kind === "alarm" && st === "set") return { text: "SET", color: Theme.teal };
        if (kind === "timer" && st === "running") return { text: secsLeft > 0 ? "RUNNING" : "DONE", color: Theme.teal };
        return null;
    }
    onNowChanged: if (kind === "timer" && info.ends_at) ring.requestPaint()

    // --- the picture on the left --------------------------------------------------------
    Item {
        id: art
        visible: kind !== "day"
        width: 68; height: 68
        anchors { left: parent.left; leftMargin: 12; verticalCenter: parent.verticalCenter }

        // Alarm: a clock face with the hands at the alarm's time.
        Canvas {
            id: face
            anchors.fill: parent
            visible: kind === "alarm"
            onPaint: {
                const c = getContext("2d");
                c.reset();
                const r = width / 2 - 3, cx = width / 2, cy = height / 2;
                c.lineWidth = 2;
                c.strokeStyle = card.gone ? Theme.muted : Theme.accent;
                c.fillStyle = Theme.bg;
                c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); c.stroke();
                for (let i = 0; i < 12; i++) {
                    const a = i * Math.PI / 6;
                    const inner = i % 3 === 0 ? r - 8 : r - 5;
                    c.lineWidth = i % 3 === 0 ? 2 : 1;
                    c.strokeStyle = Theme.muted;
                    c.beginPath(); c.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner); c.lineTo(cx + Math.sin(a) * (r - 2), cy - Math.cos(a) * (r - 2)); c.stroke();
                }
                const mins = card.shownMinutes;
                const ha = ((mins / 60) % 12) * Math.PI / 6, ma = (mins % 60) * Math.PI / 30;
                c.strokeStyle = Theme.fg; c.lineCap = "round";
                c.lineWidth = 3; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(ha) * r * 0.5, cy - Math.cos(ha) * r * 0.5); c.stroke();
                c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(ma) * r * 0.78, cy - Math.cos(ma) * r * 0.78); c.stroke();
                c.fillStyle = card.gone ? Theme.muted : Theme.accent;
                c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.fill();
            }
        }
        // Timer: a ring that empties as it counts down.
        Canvas {
            id: ring
            anchors.fill: parent
            visible: kind === "timer"
            onPaint: {
                const c = getContext("2d");
                c.reset();
                const r = width / 2 - 5, cx = width / 2, cy = height / 2;
                c.lineWidth = 6;
                c.strokeStyle = Theme.surface2;
                c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
                const total = card.info.duration_s || 1;
                const frac = card.st === "running" ? Math.min(1, card.secsLeft / total) : 0;
                if (frac > 0) {
                    c.strokeStyle = Theme.teal; c.lineCap = "round";
                    c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); c.stroke();
                }
            }
            Text {
                anchors.centerIn: parent
                text: card.st === "running" ? card.countdown(card.secsLeft) : "–"
                color: Theme.fg; font.family: Theme.mono; font.pixelSize: card.secsLeft >= 3600 ? 11 : 13; font.weight: Font.DemiBold
            }
        }
        // Event: a calendar page; a birthday gets a cake on it.
        Rectangle {
            anchors.fill: parent
            visible: kind === "event"
            color: Theme.bg
            border.width: 2
            border.color: card.accentOf()
            readonly property var parts: (card.info.when || "").split(" ")   // "Fri 5 Mar 2027", "today", "tomorrow"
            Rectangle {
                id: band
                anchors { left: parent.left; right: parent.right; top: parent.top }
                height: 18
                color: card.accentOf()
                Text {
                    anchors.centerIn: parent
                    text: parent.parent.parts.length >= 3 ? parent.parent.parts[2].toUpperCase() : (card.info.when || "").toUpperCase()
                    color: "#121212"; font.family: Theme.mono; font.pixelSize: 10; font.weight: Font.Bold
                }
            }
            Text {
                visible: !card.info.birthday
                anchors { horizontalCenter: parent.horizontalCenter; top: band.bottom; topMargin: 4 }
                text: parent.parts.length >= 2 ? parent.parts[1] : (card.info.days_until === 0 ? "★" : "")
                color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold
            }
            Canvas {
                visible: !!card.info.birthday
                anchors { left: parent.left; right: parent.right; top: band.bottom; bottom: parent.bottom; margins: 4 }
                onPaint: {
                    const c = getContext("2d");
                    c.reset();
                    const w = width, h = height;
                    c.fillStyle = Theme.gold; c.fillRect(w * 0.18, h * 0.55, w * 0.64, h * 0.4);
                    c.fillStyle = Theme.accent; c.fillRect(w * 0.18, h * 0.55, w * 0.64, h * 0.1);
                    c.fillStyle = Theme.fg; c.fillRect(w * 0.47, h * 0.25, w * 0.06, h * 0.3);
                    c.fillStyle = Theme.orange; c.beginPath(); c.ellipse(w * 0.44, h * 0.06, w * 0.12, h * 0.2); c.fill();
                }
                Text {
                    anchors { right: parent.right; top: parent.top }
                    text: parent.parent.parts.length >= 2 ? parent.parent.parts[1] : ""
                    color: Theme.fg; font.family: Theme.mono; font.pixelSize: 11; font.weight: Font.Bold
                }
            }
        }
        // Note or setting: an icon in a square.
        Rectangle {
            anchors.fill: parent
            visible: kind === "note" || kind === "setting"
            color: Theme.bg
            border.width: 1
            border.color: Theme.border
            Icon { anchors.centerIn: parent; name: kind === "note" ? "note" : "check"; size: 26; color: Theme.teal }
        }
    }

    // --- the words on the right ---------------------------------------------------------
    ColumnLayout {
        visible: kind !== "day"
        anchors { left: art.right; leftMargin: 14; right: parent.right; rightMargin: 12; verticalCenter: parent.verticalCenter }
        spacing: 2
        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Text {
                Layout.fillWidth: true
                text: kind === "alarm" ? (card.info.time || "") : kind === "timer" ? (card.info.label || "Timer") : (card.info.label || "")
                color: Theme.fg
                elide: Text.ElideRight
                font.family: Theme.mono
                font.pixelSize: kind === "alarm" ? 22 : 15
                font.weight: Font.Bold
                font.strikeout: card.st === "removed"
            }
            Rectangle {
                readonly property var b: card.badge()
                // The badge springs in a beat after the card.
                transformOrigin: Item.Center
                SequentialAnimation on scale {
                    NumberAnimation { to: 0; duration: 0 }
                    PauseAnimation { duration: 260 }
                    NumberAnimation { to: 1; duration: 320; easing.type: Easing.OutBack; easing.overshoot: 3 }
                }
                visible: !!b
                implicitWidth: badgeText.implicitWidth + 12
                implicitHeight: 18
                color: Theme.alpha(b ? b.color : Theme.muted, 0.2)
                RowLayout {
                    anchors.centerIn: parent
                    spacing: 3
                    Icon { visible: !!parent.parent.b && (parent.parent.b.text === "SET" || parent.parent.b.text === "ADDED"); name: "check"; size: 9; color: parent.parent.b ? parent.parent.b.color : Theme.muted }
                    Text { id: badgeText; text: parent.parent.b ? parent.parent.b.text : ""; color: parent.parent.b ? parent.parent.b.color : Theme.muted; font.family: Theme.mono; font.pixelSize: 10; font.weight: Font.Bold; font.letterSpacing: 1 }
                }
            }
        }
        Text {
            Layout.fillWidth: true
            text: kind === "alarm" ? (card.info.label || "Alarm")
                : kind === "timer" ? (card.st === "running" ? (card.secsLeft > 0 ? "rings in " + card.countdown(card.secsLeft) : "rang") : "stopped")
                : kind === "event" ? [card.info.when, card.info.time].filter(x => !!x).join(" · ")
                : kind === "note" ? (card.info.course || (card.st === "added" ? "New note" : "Note"))
                : (card.info.value || "")
            color: Theme.muted
            elide: Text.ElideRight
            font.family: Theme.mono
            font.pixelSize: 13
        }
        Text {
            Layout.fillWidth: true
            visible: text !== ""
            text: kind === "alarm" ? (card.info.when || "")
                : kind === "event" ? (card.info.days_until > 1 ? "in " + card.info.days_until + " days" + (card.info.repeats ? " · " + card.info.repeats : "") : card.info.days_until === 1 ? "tomorrow" : card.info.days_until === 0 ? "today!" : (card.info.repeats || ""))
                : ""
            color: kind === "event" && card.info.days_until !== null && card.info.days_until <= 7 ? card.accentOf() : Theme.faint
            elide: Text.ElideRight
            font.family: Theme.mono
            font.pixelSize: 12
        }
    }

    // --- a day: its timeline, then the list ---------------------------------------------------
    ColumnLayout {
        id: dayCol
        visible: kind === "day"
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12 }
        spacing: 8
        readonly property var items: card.info.items || []
        readonly property int from: items.length ? Math.min.apply(null, items.map(i => i.from)) : 8 * 60
        readonly property int to: items.length ? Math.max.apply(null, items.map(i => i.to)) : 18 * 60
        Text { text: (card.info.label || "").toUpperCase(); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11; font.letterSpacing: 1.5; font.weight: Font.Bold }
        Text { visible: dayCol.items.length === 0; text: "Nothing on."; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14 }
        Item {
            visible: dayCol.items.length > 0
            Layout.fillWidth: true
            implicitHeight: 14
            Rectangle { anchors.fill: parent; color: Theme.surface2 }
            Repeater {
                model: dayCol.items
                Rectangle {
                    required property var modelData
                    readonly property double span: Math.max(1, dayCol.to - dayCol.from)
                    x: (modelData.from - dayCol.from) / span * parent.width
                    width: Math.max(4, (modelData.to - modelData.from) / span * parent.width - 2)
                    height: parent.height
                    color: modelData.color || Theme.teal
                }
            }
        }
        Repeater {
            model: dayCol.items
            RowLayout {
                required property var modelData
                Layout.fillWidth: true
                spacing: 8
                Rectangle { width: 8; height: 8; color: modelData.color || Theme.teal }
                Text { text: modelData.start + "–" + modelData.end; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                Text { Layout.fillWidth: true; text: modelData.title + (modelData.location ? "  " + modelData.location : ""); color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
            }
        }
    }
}
