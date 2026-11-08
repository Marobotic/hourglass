import QtQuick
import QtQuick.Layouts

// One tool the assistant used: a status mark and its name; opened, it shows the
// input and output (trimmed by the server), how long it took, and for a file
// edit the lines that changed.
ColumnLayout {
    id: tr
    property var info: ({})
    property bool expanded: false
    signal toggled()
    readonly property bool running: info.status !== "completed" && info.status !== "error"
    readonly property var diff: info.diff || null
    readonly property bool hasDetail: !!(info.input || info.output || diff)
    spacing: 4

    function duration(ms) {
        if (ms === null || ms === undefined) return "";
        return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
    }
    // JSON on one line is hard to read: show it indented when it parses.
    function pretty(s) {
        try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return String(s || ""); }
    }

    RowLayout {
        spacing: 8
        Icon {
            name: tr.info.status === "completed" ? "check" : tr.info.status === "error" ? "close" : "sync"
            size: 12
            color: tr.info.status === "completed" ? Theme.teal : tr.info.status === "error" ? Theme.accent : Theme.muted
            RotationAnimation on rotation { running: tr.running; from: 0; to: 360; duration: 1200; loops: Animation.Infinite }
        }
        Text {
            text: (tr.info.label || tr.info.tool || "") + (tr.expanded && tr.info.duration_ms !== null && tr.info.duration_ms !== undefined ? " · " + tr.duration(tr.info.duration_ms) : "")
            color: toolHover.containsMouse ? Theme.fg : Theme.muted
            font.family: Theme.mono; font.pixelSize: 12
            MouseArea { id: toolHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: tr.toggled() }
        }
        Text {
            visible: !!tr.diff && !tr.diff.tooBig
            text: "+" + (tr.diff ? tr.diff.added : 0) + " −" + (tr.diff ? tr.diff.removed : 0)
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11
        }
        Text {
            visible: tr.hasDetail
            text: tr.expanded ? "▴" : "▾"
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11
            MouseArea { anchors.fill: parent; anchors.margins: -4; cursorShape: Qt.PointingHandCursor; onClicked: tr.toggled() }
        }
    }

    Rectangle {
        visible: tr.expanded && tr.hasDetail
        Layout.fillWidth: true
        Layout.leftMargin: 20
        Layout.preferredWidth: 540
        Layout.maximumWidth: 640
        implicitHeight: detail.implicitHeight + 16
        color: Theme.surface
        border.width: 1
        border.color: Theme.border
        ColumnLayout {
            id: detail
            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 8 }
            spacing: 6
            Text { visible: !!tr.info.input; text: "INPUT"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
            Text {
                visible: !!tr.info.input
                Layout.fillWidth: true
                text: tr.expanded ? tr.pretty(tr.info.input) : ""
                textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11
            }
            Text { visible: !!tr.info.output; text: "OUTPUT"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
            Text {
                visible: !!tr.info.output
                Layout.fillWidth: true
                text: tr.expanded ? tr.pretty(tr.info.output) : ""
                textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
                color: tr.info.status === "error" ? Theme.accent : Theme.muted; font.family: Theme.mono; font.pixelSize: 11
            }
            Text {
                visible: !!tr.diff
                text: tr.diff && tr.diff.tooBig ? "CHANGES · too many to show (+" + tr.diff.added + " −" + tr.diff.removed + ")" : "CHANGES"
                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1
            }
            Column {
                visible: !!tr.diff && !tr.diff.tooBig && tr.diff.lines.length > 0
                Layout.fillWidth: true
                Repeater {
                    model: tr.expanded && tr.diff && !tr.diff.tooBig ? tr.diff.lines : []
                    Rectangle {
                        required property var modelData
                        width: parent.width
                        height: diffLine.implicitHeight + 2
                        color: modelData.op === "add" ? Theme.alpha(Theme.teal, 0.22) : modelData.op === "del" ? Theme.alpha(Theme.accent, 0.22) : "transparent"
                        Text {
                            id: diffLine
                            anchors { left: parent.left; right: parent.right; leftMargin: 4; rightMargin: 4; verticalCenter: parent.verticalCenter }
                            text: modelData.op === "skip" ? "⋯ " + modelData.count + " lines the same" : (modelData.op === "add" ? "+ " : modelData.op === "del" ? "− " : "  ") + (modelData.text || "")
                            textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
                            color: modelData.op === "skip" ? Theme.faint : Theme.fg
                            font.family: Theme.mono; font.pixelSize: 11
                        }
                    }
                }
            }
        }
    }
}
