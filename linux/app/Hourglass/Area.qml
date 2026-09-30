import QtQuick
import QtQuick.Controls.Basic

// Multi-line editor with its own scrolling.
ScrollView {
    id: sv
    property alias text: ta.text
    property alias placeholderText: ta.placeholderText
    property alias area: ta
    property int fontSize: 14
    property string family: Theme.mono
    clip: true
    ScrollBar.vertical.policy: ScrollBar.AsNeeded

    TextArea {
        id: ta
        wrapMode: TextArea.Wrap
        color: Theme.fg
        placeholderTextColor: Theme.faint
        selectionColor: Theme.alpha(Theme.accent, 0.45)
        selectedTextColor: Theme.fg
        font.family: sv.family
        font.pixelSize: sv.fontSize
        textFormat: TextEdit.PlainText
        selectByMouse: true
        padding: 0
        background: null
    }
}
