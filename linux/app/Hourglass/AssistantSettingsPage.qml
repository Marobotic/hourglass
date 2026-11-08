import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Popup {
    id: page
    property string title: ""
    property string subtitle: ""
    default property alias body: bodyColumn.data
    property alias footer: footerRow.data
    parent: Overlay.overlay
    x: 0; y: 0; width: parent ? parent.width : 800; height: parent ? parent.height : 600
    modal: true; focus: true; padding: 0
    closePolicy: Popup.CloseOnEscape
    background: Rectangle { color: Theme.bg }
    contentItem: ColumnLayout {
        spacing: 12
        RowLayout {
            Layout.fillWidth: true; Layout.margins: 16
            Btn { text: "← Back"; onClicked: page.close() }
            Text { text: page.title; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 17; Layout.fillWidth: true }
        }
        ScrollView {
            Layout.fillWidth: true; Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth
            ColumnLayout {
                width: parent.width
                Text { Layout.fillWidth: true; Layout.leftMargin: 20; Layout.rightMargin: 20; text: page.subtitle; wrapMode: Text.Wrap; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                ColumnLayout {
                    id: bodyColumn
                    Layout.fillWidth: true; Layout.margins: 20
                    spacing: 12
                }
            }
        }
        RowLayout {
            id: footerRow
            Layout.fillWidth: true; Layout.margins: 16
            spacing: 8
        }
    }
}
