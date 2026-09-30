import QtQuick
import QtQuick.Layouts

// Seven weekday toggles; days holds ISO numbers (1 = Mon).
RowLayout {
    id: dt
    property var days: []
    property bool readOnly: false
    property int size: 28
    signal toggled(var days)
    spacing: 4

    Repeater {
        model: 7
        Rectangle {
            readonly property bool on: dt.days.indexOf(index + 1) >= 0
            width: dt.size
            height: dt.size
            radius: 4
            color: on ? Theme.accent : Theme.bg
            border.width: 1
            border.color: on ? Theme.accent : Theme.border
            Text {
                anchors.centerIn: parent
                text: "MTWTFSS"[index]
                color: parent.on ? Theme.accentInk : Theme.muted
                font.family: Theme.mono
                font.pixelSize: 11
                font.weight: Font.DemiBold
            }
            MouseArea {
                anchors.fill: parent
                enabled: !dt.readOnly
                cursorShape: dt.readOnly ? Qt.ArrowCursor : Qt.PointingHandCursor
                onClicked: {
                    const d = dt.days.slice();
                    const i = d.indexOf(index + 1);
                    if (i >= 0) d.splice(i, 1); else d.push(index + 1);
                    d.sort();
                    dt.days = d;
                    dt.toggled(d);
                }
            }
        }
    }
}
