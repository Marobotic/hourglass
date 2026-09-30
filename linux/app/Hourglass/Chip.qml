import QtQuick

Rectangle {
    id: chip
    property string text: ""
    property color tint: Theme.muted
    property bool solid: false
    implicitWidth: label.implicitWidth + 14
    implicitHeight: 20
    radius: 4
    color: solid ? tint : Theme.alpha(tint, 0.16)
    Text {
        id: label
        anchors.centerIn: parent
        text: chip.text.toUpperCase()
        color: chip.solid ? (chip.tint.hslLightness > 0.62 ? "#121212" : "#ffffff") : chip.tint
        font.family: Theme.mono
        font.pixelSize: 12
        font.weight: Font.DemiBold
        font.letterSpacing: 0.8
    }
}
