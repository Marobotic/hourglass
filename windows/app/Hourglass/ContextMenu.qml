import QtQuick
import QtQuick.Controls.Basic

// Right-click menu in the app's own look (the same shape as Jukebox's):
// a dark panel with an accent border, the item's name on top, rows that
// light up on hover, danger rows in red. A row with `sub` opens its list in
// place, with a "‹ Back" row.
//
//   menu.show(x, y, "Title", [{ key, label, danger?, checked?, sub?: [...] }])
//   onPicked: key => ...
Popup {
    id: m
    property string title: ""
    property var items: []
    property var stack: [] // the lists we came from, for Back
    signal picked(string key)

    // x, y: the click, in the coordinates of the menu's parent.
    function show(px, py, t, list) {
        title = t || "";
        items = list;
        stack = [];
        cx = px;
        cy = py;
        open();
    }
    property real cx: 0
    property real cy: 0
    // Opens down-right from the cursor; flips when there is no room.
    x: parent ? Math.max(0, cx + width <= parent.width ? cx : cx - width) : cx
    y: parent ? Math.max(0, cy + height <= parent.height ? cy : cy - height) : cy

    width: 240
    padding: 5
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    background: Rectangle {
        color: Qt.darker(Theme.fg, 3.0) // as Jukebox's menu
        border.width: 1
        border.color: Theme.accent
        radius: 4
    }

    contentItem: Column {
        id: col
        spacing: 1

        Text {
            width: col.width
            visible: m.title !== ""
            text: m.title
            textFormat: Text.PlainText
            color: Theme.muted
            elide: Text.ElideRight
            font.family: Theme.mono
            font.pixelSize: 12
            font.bold: true
            leftPadding: 6
            topPadding: 2
            bottomPadding: 5
        }

        component Row_: Rectangle {
            id: row
            property string label
            property color tint: Theme.fg
            property bool checked: false
            signal hit()
            width: col.width
            height: 28
            radius: 3
            color: hov.containsMouse ? Theme.alpha(Theme.accent, 0.32) : "transparent"
            Text {
                anchors { left: parent.left; right: mark.left; leftMargin: 8; rightMargin: 6; verticalCenter: parent.verticalCenter }
                text: row.label
                textFormat: Text.PlainText
                color: row.tint
                elide: Text.ElideRight
                font.family: Theme.mono
                font.pixelSize: 13
            }
            Text {
                id: mark
                anchors { right: parent.right; rightMargin: 8; verticalCenter: parent.verticalCenter }
                text: row.checked ? "✓" : ""
                color: Theme.accent
                font.family: Theme.mono
                font.pixelSize: 13
            }
            MouseArea { id: hov; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: row.hit() }
        }

        Row_ {
            visible: m.stack.length > 0
            label: "‹  Back"
            tint: Theme.muted
            onHit: { const s = m.stack.slice(); m.items = s.pop(); m.stack = s; }
        }

        Repeater {
            model: m.items
            delegate: Column {
                required property var modelData
                width: col.width
                // A thin line between groups ({ separator: true }).
                Rectangle { visible: !!modelData.separator; width: col.width; height: 9; color: "transparent"
                    Rectangle { anchors.verticalCenter: parent.verticalCenter; width: parent.width; height: 1; color: Theme.border } }
                Row_ {
                    visible: !modelData.separator
                    label: (modelData.label || "") + (modelData.sub ? "  ›" : "")
                    tint: modelData.danger ? Qt.lighter(Theme.accent, 1.45) : modelData.disabled ? Theme.faint : Theme.fg
                    checked: !!modelData.checked
                    onHit: {
                        if (modelData.disabled) return;
                        if (modelData.sub) { m.stack = m.stack.concat([m.items]); m.items = modelData.sub; return; }
                        m.close();
                        m.picked(modelData.key);
                    }
                }
            }
        }
    }
}
