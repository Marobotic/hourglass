import QtQuick
import QtQuick.Controls.Basic

TextField {
    id: f
    property bool invalid: false
    implicitHeight: 36
    color: Theme.fg
    placeholderTextColor: Theme.faint
    selectionColor: Theme.alpha(Theme.accent, 0.45)
    selectedTextColor: Theme.fg
    font.family: Theme.mono
    font.pixelSize: 14
    leftPadding: 11
    rightPadding: 11
    background: Rectangle {
        radius: 0
        color: Theme.bg
        border.width: 1
        border.color: f.invalid ? Theme.accent : f.activeFocus ? Theme.fg : Theme.border
    }
}
