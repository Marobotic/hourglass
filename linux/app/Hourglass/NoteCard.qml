import QtQuick
import QtQuick.Layouts

Card {
    id: nc
    property var note: ({})
    property bool showCourse: false
    property color tint: Theme.accent
    hoverable: true
    implicitHeight: col.implicitHeight + 24

    ColumnLayout {
        id: col
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12; leftMargin: 14 }
        spacing: 5
        RowLayout {
            spacing: 8
            Layout.fillWidth: true
            Icon { name: nc.note.pinned ? "pin" : "note"; color: nc.note.pinned ? Theme.gold : Theme.muted; size: 13 }
            Text {
                Layout.fillWidth: true
                text: nc.note.title || "Untitled"
                color: Theme.fg
                elide: Text.ElideRight
                font.family: Theme.mono
                font.pixelSize: 15
                font.weight: Font.DemiBold
            }
            Text {
                visible: nc.showCourse && !!nc.note.course_name
                text: nc.note.course_name || ""
                color: nc.tint
                font.family: Theme.mono
                font.pixelSize: 13
            }
        }
        Text {
            Layout.fillWidth: true
            visible: text !== ""
            text: Util.preview(nc.note.body || nc.note.snippet)
            color: Theme.muted
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
            font.family: Theme.sans
            font.pixelSize: 14
            lineHeight: 1.15
        }
    }
}
