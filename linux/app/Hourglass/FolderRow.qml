import QtQuick
import QtQuick.Layouts

// One entry in the Notes folder list.
Rectangle {
    id: f
    property string label
    property string sub: ""
    property color swatch: "transparent"
    property string glyph: ""
    property bool current: false
    property int count: 0
    signal clicked()
    Layout.fillWidth: true
    height: sub ? 58 : 44
    radius: 0
    color: current ? Theme.surface2 : fm.containsMouse ? Theme.surface : "transparent"
    Rectangle { visible: f.current; width: 3; height: 20; radius: 0; color: Theme.accent; anchors { left: parent.left; verticalCenter: parent.verticalCenter } }
    RowLayout {
        anchors { fill: parent; leftMargin: 12; rightMargin: 12 }
        spacing: 12
        Rectangle { visible: f.glyph === ""; width: 12; height: 12; radius: 0; color: f.swatch }
        Icon { visible: f.glyph !== ""; name: f.glyph; size: 14; color: Theme.muted }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            Text { Layout.fillWidth: true; text: f.label; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.DemiBold }
            Text { visible: f.sub !== ""; Layout.fillWidth: true; text: f.sub; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
        }
        Text { text: f.count; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
    }
    MouseArea { id: fm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: f.clicked() }
}
