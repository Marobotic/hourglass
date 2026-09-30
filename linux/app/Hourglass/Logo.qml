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
}
