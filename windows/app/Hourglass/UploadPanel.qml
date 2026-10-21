import QtQuick
import QtQuick.Layouts

// Uploads, like Google Drive's: a box in the bottom-right corner while files
// go up, one row per file with its name, a progress bar, how much of it has
// gone and how fast. A file can be cancelled while it goes; the box folds down
// to its header, and closes once everything is done. Any upload shows here:
// the Drive page's, a note's pictures, the assistant's attachments.
Rectangle {
    id: panel
    property var items: [] // the sidecar's /api/uploads
    property bool shown: false
    property bool folded: false
    readonly property var sending: items.filter(u => u.state === "sending")
    readonly property int waiting: Math.max(0, Api.uploading - sending.length) // asked, not going yet
    readonly property bool busy: sending.length > 0 || waiting > 0

    function poll() {
        Api.get("/api/uploads", d => {
            if (!d) return;
            panel.items = d.slice().reverse(); // newest on top
        });
    }
    function size(n) {
        if (n === undefined || n === null) return "";
        const u = ["B", "KB", "MB", "GB", "TB"];
        let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i && n < 10 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
    }
    function close() {
        Api.del("/api/uploads", () => { panel.items = []; });
        shown = false;
        folded = false;
    }
    readonly property string title: {
        const n = sending.length + waiting;
        if (n) return "Uploading " + n + (n === 1 ? " file" : " files");
        const done = items.filter(u => u.state === "done").length;
        const bad = items.length - done;
        return (done ? done + (done === 1 ? " upload" : " uploads") + " complete" : "") + (done && bad ? " · " : "") + (bad ? bad + " not uploaded" : "");
    }
    // All the files still going: one bar for the header.
    readonly property real overall: {
        let a = 0, b = 0;
        for (const u of sending) { a += u.sent; b += u.size; }
        return b ? a / b : 0;
    }

    Connections {
        target: Api
        function onUploadingChanged() {
            if (Api.uploading > 0) { panel.shown = true; panel.poll(); }
            else panel.poll(); // the last one finished: its row says so
        }
    }
    Timer { interval: 400; repeat: true; running: panel.shown && panel.busy; onTriggered: panel.poll() }

    visible: opacity > 0
    opacity: shown ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 160 } }
    transform: Translate { y: (1 - panel.opacity) * 16 }
    width: 380
    height: col.implicitHeight
    color: Theme.surface
    border.color: Theme.border
    clip: true

    ColumnLayout {
        id: col
        width: parent.width
        spacing: 0

        // Header: what is going on, fold, close.
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: 48
            color: Theme.surface2
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 16
                anchors.rightMargin: 8
                spacing: 4
                Icon { name: panel.busy ? "upload" : "check"; size: 15; color: panel.busy ? Theme.accent : Theme.teal }
                Text {
                    Layout.fillWidth: true
                    Layout.leftMargin: 8
                    text: panel.title
                    color: Theme.fg
                    elide: Text.ElideRight
                    font.family: Theme.mono
                    font.pixelSize: 13
                    font.weight: Font.Bold
                }
                Btn { compact: true; icon: "down"; rotation: panel.folded ? 180 : 0; tip: panel.folded ? "Show the files" : "Fold down"; onClicked: panel.folded = !panel.folded }
                Btn { compact: true; icon: "close"; tip: "Close"; visible: !panel.busy; onClicked: panel.close() }
            }
            // Folded while files go: the header keeps a thin bar of all of them.
            Rectangle {
                anchors.bottom: parent.bottom
                height: 2
                width: parent.width * panel.overall
                color: Theme.accent
                visible: panel.busy
                Behavior on width { NumberAnimation { duration: 380 } }
            }
        }

        // One row per file.
        ListView {
            id: list
            Layout.fillWidth: true
            Layout.preferredHeight: panel.folded ? 0 : Math.min(contentHeight, 5 * 64)
            visible: !panel.folded
            clip: true
            interactive: contentHeight > height
            model: panel.items
            header: Item {
                width: list.width
                height: panel.waiting > 0 ? 40 : 0
                visible: panel.waiting > 0
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    x: 16
                    text: panel.waiting === 1 ? "1 file getting ready…" : panel.waiting + " files getting ready…"
                    color: Theme.muted
                    font.family: Theme.mono
                    font.pixelSize: 12
                }
            }
            delegate: Item {
                id: row
                required property var modelData
                readonly property var u: modelData
                readonly property bool going: u.state === "sending"
                width: list.width
                height: 64
                Rectangle { anchors.top: parent.top; width: parent.width; height: 1; color: Theme.border }
                Icon {
                    id: kind
                    x: 16
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.verticalCenterOffset: -6
                    name: /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(row.u.name) ? "image" : "file"
                    size: 16
                    color: Theme.muted
                }
                Text {
                    id: nameText
                    anchors.left: parent.left
                    anchors.leftMargin: 46
                    anchors.right: action.left
                    anchors.rightMargin: 10
                    y: 12
                    text: row.u.name
                    color: Theme.fg
                    elide: Text.ElideMiddle
                    font.family: Theme.mono
                    font.pixelSize: 13
                }
                // The bar: how much of the file has gone.
                Rectangle {
                    id: track
                    anchors.left: nameText.left
                    anchors.right: nameText.right
                    anchors.top: nameText.bottom
                    anchors.topMargin: 7
                    height: 3
                    color: Theme.surface2
                    Rectangle {
                        height: parent.height
                        width: parent.width * (row.u.state === "done" ? 1 : row.u.size ? row.u.sent / row.u.size : 0)
                        color: row.u.state === "done" ? Theme.teal : row.u.state === "sending" ? Theme.accent : Theme.faint
                        Behavior on width { NumberAnimation { duration: 380 } }
                    }
                }
                Text {
                    anchors.left: nameText.left
                    anchors.right: nameText.right
                    anchors.top: track.bottom
                    anchors.topMargin: 6
                    text: row.going && row.u.sent >= row.u.size ? panel.size(row.u.size) + "  ·  finishing…"
                        : row.going ? panel.size(row.u.sent) + " of " + panel.size(row.u.size) + (row.u.speed > 0 ? "  ·  " + panel.size(row.u.speed) + "/s" : "")
                        : row.u.state === "done" ? panel.size(row.u.size) + "  ·  uploaded"
                        : row.u.state === "cancelled" ? "Cancelled" : (row.u.error || "Not uploaded")
                    color: row.u.state === "failed" ? Theme.accent : Theme.muted
                    elide: Text.ElideRight
                    font.family: Theme.mono
                    font.pixelSize: 11
                }
                // Cancel while it goes; a check once it's there.
                Item {
                    id: action
                    anchors.right: parent.right
                    anchors.rightMargin: 10
                    anchors.verticalCenter: parent.verticalCenter
                    width: 28; height: 28
                    Btn { anchors.centerIn: parent; compact: true; icon: "close"; tip: "Cancel this upload"; visible: row.going; onClicked: Api.request("POST", "/api/uploads/" + row.u.id + "/cancel", {}, () => panel.poll(), true) }
                    Icon { anchors.centerIn: parent; visible: row.u.state === "done"; name: "check"; size: 15; color: Theme.teal }
                }
            }
        }
    }
}
