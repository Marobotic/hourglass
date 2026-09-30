import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Centered dialog with a title, a body slot and a footer slot.
Popup {
    id: m
    property string title: ""
    property string subtitle: ""
    default property alias body: bodyCol.data
    property alias footer: footerRow.data
    modal: true
    focus: true
    anchors.centerIn: Overlay.overlay
    width: Math.min(520, (parent ? parent.width : 520) - 48)
    padding: 0
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    Overlay.modal: Rectangle { color: Theme.alpha("#000000", 0.55) }
    background: Rectangle { color: Theme.surface; radius: Theme.radius + 2; border.color: Theme.border }

    enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 110 } NumberAnimation { property: "scale"; from: 0.97; to: 1; duration: 110; easing.type: Easing.OutCubic } }
    exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 80 } }

    contentItem: ColumnLayout {
        spacing: 0
        ColumnLayout {
            Layout.fillWidth: true
            Layout.margins: 20
            Layout.bottomMargin: 6
            spacing: 3
            RowLayout {
                Layout.fillWidth: true
                Text { Layout.fillWidth: true; text: m.title; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 17; font.weight: Font.DemiBold }
                Btn { icon: "close"; kind: "subtle"; compact: true; onClicked: m.close() }
            }
            Text { visible: m.subtitle !== ""; text: m.subtitle; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
        }
        ColumnLayout {
            id: bodyCol
            Layout.fillWidth: true
            Layout.leftMargin: 20
            Layout.rightMargin: 20
            Layout.topMargin: 10
            Layout.bottomMargin: 18
            spacing: 12
        }
        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; visible: footerRow.children.length > 0 }
        RowLayout {
            id: footerRow
            Layout.fillWidth: true
            Layout.margins: 14
            Layout.leftMargin: 20
            Layout.rightMargin: 20
            spacing: 8
            visible: children.length > 0
        }
    }
}
