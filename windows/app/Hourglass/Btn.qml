import QtQuick
import QtQuick.Layouts

// kind: primary | ghost | subtle | danger
Rectangle {
    id: btn
    property string text: ""
    property string icon: ""
    property string kind: "ghost"
    property bool compact: false
    property bool active: false
    property string tip: ""
    signal clicked()

    readonly property bool hovered: mouse.containsMouse
    readonly property color base: kind === "primary" ? Theme.accent : kind === "danger" ? Theme.alpha(Theme.accent, 0.14) : active ? Theme.surface2 : "transparent"
    readonly property color ink: kind === "primary" ? Theme.accentInk : kind === "danger" ? Theme.accent : active ? Theme.fg : kind === "subtle" ? Theme.muted : Theme.fg

    implicitHeight: compact ? 28 : 34
    implicitWidth: row.implicitWidth + (text ? (compact ? 20 : 28) : 0) + (text ? 0 : implicitHeight - row.implicitWidth)
    radius: 0
    color: kind === "primary" ? (hovered ? Qt.lighter(base, 1.12) : base) : (hovered ? Theme.surface2 : base)
    border.width: kind === "ghost" ? 1 : 0
    border.color: Theme.border
    opacity: enabled ? 1 : 0.4
    Behavior on color { ColorAnimation { duration: 90 } }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: 7
        Icon { visible: btn.icon !== ""; name: btn.icon; color: btn.ink; size: btn.compact ? 12 : 13 }
        Text {
            visible: btn.text !== ""
            text: btn.text
            color: btn.ink
            font.family: Theme.mono
            font.pixelSize: btn.compact ? 12 : 13
            font.weight: btn.kind === "primary" ? Font.DemiBold : Font.Normal
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: btn.clicked()
    }
}
