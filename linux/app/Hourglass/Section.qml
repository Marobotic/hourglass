import QtQuick
import QtQuick.Layouts

RowLayout {
    property string text: ""
    property string detail: ""
    spacing: 10
    Text {
        text: parent.text.toUpperCase()
        color: Theme.muted
        font.family: Theme.mono
        font.pixelSize: 11
        font.weight: Font.DemiBold
        font.letterSpacing: 1.4
    }
    Text {
        visible: parent.detail !== ""
        text: parent.detail
        color: Theme.faint
        font.family: Theme.mono
        font.pixelSize: 11
    }
    Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }
}
