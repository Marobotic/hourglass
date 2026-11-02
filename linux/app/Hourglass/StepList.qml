import QtQuick
import QtQuick.Layouts

// What the assistant is doing or did, one line per step, with the time since
// the message started: "+0.0 s Asking big-pickle (free)…", "+4.1 s Connected",
// "+6.3 s Thinking: …", "+7.0 s Set an alarm".
ColumnLayout {
    id: sl
    property var steps: []
    property double start: steps.length ? steps[0].at : 0
    spacing: 3
    Repeater {
        model: sl.steps
        RowLayout {
            required property var modelData
            Layout.fillWidth: true
            spacing: 8
            Text {
                Layout.alignment: Qt.AlignTop
                Layout.preferredWidth: 58
                text: "+" + ((modelData.at - sl.start) / 1000).toFixed(1) + " s"
                color: Theme.faint
                horizontalAlignment: Text.AlignRight
                font.family: Theme.mono
                font.pixelSize: 11
            }
            Text {
                Layout.fillWidth: true
                text: modelData.text
                color: /went quiet|failed|stalled|not connected/.test(modelData.text) ? Theme.accent : /^Thinking/.test(modelData.text) ? Theme.faint : Theme.muted
                font.italic: /^Thinking/.test(modelData.text)
                wrapMode: Text.Wrap
                font.family: Theme.mono
                font.pixelSize: 12
            }
        }
    }
}
