import QtQuick

// Pixel-art hourglass, drawn from a grid like the Omarchy mark.
Item {
    id: logo
    property int cell: 3
    property color frame: Theme.accent
    property color sand: Theme.gold
    readonly property int cols: rows[0].length
    readonly property var rows: [
        "#########",
        ".#.....#.",
        ".#ooooo#.",
        "..#ooo#..",
        "...#o#...",
        "...#o#...",
        "..#.o.#..",
        ".#.ooo.#.",
        ".#ooooo#.",
        "#########"
    ]
    width: cols * cell
    height: rows.length * cell
    // alive: a grain of sand keeps falling through the neck, and a hover turns the glass over.
    property bool alive: false
    transformOrigin: Item.Center
    Behavior on rotation { NumberAnimation { duration: 620; easing.type: Easing.OutBack; easing.overshoot: 1.4 } }
    MouseArea {
        anchors.fill: parent
        enabled: logo.alive
        hoverEnabled: true
        onEntered: logo.rotation += 180
    }

    Repeater {
        model: logo.rows.length * logo.cols
        Rectangle {
            readonly property string ch: logo.rows[Math.floor(index / logo.cols)][index % logo.cols]
            visible: ch !== "."
            x: (index % logo.cols) * logo.cell
            y: Math.floor(index / logo.cols) * logo.cell
            width: logo.cell
            height: logo.cell
            color: ch === "o" ? logo.sand : logo.frame
        }
    }

    // The falling grain: from the neck to the pile, then again.
    Rectangle {
        id: grain
        visible: logo.alive
        width: logo.cell
        height: logo.cell
        x: 4 * logo.cell
        y: 4 * logo.cell
        color: Qt.lighter(logo.sand, 1.3) // a glint, so it shows against the sand it falls through
        opacity: 0
        SequentialAnimation {
            running: logo.alive && logo.visible
            loops: Animation.Infinite
            PauseAnimation { duration: 700 }
            PropertyAction { target: grain; property: "y"; value: 4 * logo.cell }
            NumberAnimation { target: grain; property: "opacity"; to: 1; duration: 80 }
            NumberAnimation { target: grain; property: "y"; to: 7 * logo.cell; duration: 520; easing.type: Easing.InQuad }
            NumberAnimation { target: grain; property: "opacity"; to: 0; duration: 120 }
        }
    }
}
