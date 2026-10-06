import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Dropdown. options: [{ label, value, color? }]
Rectangle {
    id: pk
    property var options: []
    property var value: null
    signal picked(var value)
    readonly property var current: options.find(o => o.value === value) || null

    implicitHeight: 36
    implicitWidth: 180
    radius: 0
    color: Theme.bg
    border.width: 1
    border.color: pop.visible ? Theme.fg : Theme.border

    RowLayout {
        anchors { fill: parent; leftMargin: 11; rightMargin: 10 }
        spacing: 8
        Rectangle { visible: !!(pk.current && pk.current.color); width: 10; height: 10; radius: 0; color: pk.current && pk.current.color ? pk.current.color : "transparent" }
        Text {
            Layout.fillWidth: true
            text: pk.current ? pk.current.label : "Choose"
            color: pk.current ? Theme.fg : Theme.faint
            elide: Text.ElideRight
            font.family: Theme.mono
            font.pixelSize: 14
        }
        Icon { name: "down"; size: 11; color: Theme.muted }
    }
    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: pop.open() }

    Popup {
        id: pop
        y: pk.height + 4
        width: pk.width
        padding: 4
        height: Math.min(list.contentHeight + 8, 260)
        background: Rectangle { color: Theme.surface; radius: 0; border.color: Theme.border }
        ListView {
            id: list
            anchors.fill: parent
            clip: true
            model: pk.options
            delegate: Rectangle {
                required property var modelData
                width: list.width
                height: 32
                radius: 0
                color: hover.containsMouse || modelData.value === pk.value ? Theme.surface2 : "transparent"
                RowLayout {
                    anchors { fill: parent; leftMargin: 9; rightMargin: 9 }
                    spacing: 8
                    Rectangle { visible: !!modelData.color; width: 10; height: 10; radius: 0; color: modelData.color || "transparent" }
                    Text { Layout.fillWidth: true; text: modelData.label; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                }
                MouseArea {
                    id: hover
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: { pk.value = modelData.value; pk.picked(modelData.value); pop.close(); }
                }
            }
        }
    }
}
