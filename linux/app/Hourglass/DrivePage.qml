import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs

// Files on the server, in folders. Upload with the button or by dropping
// files on the page; click a file to open it. The bar on top is the
// server's disk, live, so you know how much still fits.
Item {
    id: page
    property var app
    property string folder: "" // "" = the top
    property var drive: ({ path: [], folders: [], files: [] })
    property var usage: null
    property string busy: ""
    property string problem: ""

    function load() {
        Api.action("list_drive", folder ? { folder_id: folder } : {}, d => { if (d) page.drive = d; else page.folder = ""; });
    }
    function loadUsage() { Api.get("/api/drive/usage", d => { if (d) page.usage = d; }); }
    onFolderChanged: load()
    Component.onCompleted: { load(); loadUsage(); }
    onVisibleChanged: if (visible) { load(); loadUsage(); }
    Connections { target: Api; function onChanged() { if (page.visible) page.load(); } }
    // Real time: the disk is read again every few seconds while you look.
    Timer { interval: 5000; running: page.visible; repeat: true; onTriggered: page.loadUsage() }

    function size(n) {
        if (n === undefined || n === null) return "";
        const u = ["B", "KB", "MB", "GB", "TB"];
        let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i && n < 10 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
    }
    function kindIcon(f) { return /^image\//.test(f.mime) ? "image" : "file"; }

    function upload(urls) {
        if (!urls.length) return;
        let left = urls.length;
        page.problem = "";
        page.busy = "Uploading " + left + (left === 1 ? " file…" : " files…");
        for (const u of urls) {
            Api.request("POST", "/api/files/upload", { path: u.toString(), folder: page.folder || null }, (f, err) => {
                if (err) page.problem = err;
                left--;
                page.busy = left ? "Uploading " + left + (left === 1 ? " file…" : " files…") : "";
                if (!left) { page.load(); page.loadUsage(); }
            }, true);
        }
    }
    function openFile(f) {
        page.busy = "Opening " + f.name + "…";
        Api.request("GET", "/api/files/" + f.id + "/local", null, (d, err) => {
            page.busy = "";
            if (d) Qt.openUrlExternally(d.url); else page.problem = err;
        }, true);
    }

    FileDialog {
        id: picker
        title: "Upload files"
        fileMode: FileDialog.OpenFiles
        onAccepted: page.upload(selectedFiles)
    }
    DropArea {
        id: drop
        anchors.fill: parent
        onDropped: d => { if (d.hasUrls) page.upload(d.urls); }
    }

    // New folder / rename
    Modal {
        id: nameDlg
        property var target: null // null = new folder; else { table, row }
        width: 440
        title: target ? "Rename" : "New folder"
        Field { id: nameF; Layout.fillWidth: true; placeholderText: "Name"; onAccepted: nameDlg.save() }
        function ask(t) { target = t; nameF.text = t ? t.row.name : ""; open(); nameF.forceActiveFocus(); nameF.selectAll(); }
        function save() {
            const n = nameF.text.trim();
            if (!n) return;
            if (!target) Api.action("add_folder", page.folder ? { name: n, parent_id: page.folder } : { name: n }, () => nameDlg.close());
            else Api.put("/api/" + target.table + "/" + target.row.id, { name: n }, () => nameDlg.close());
        }
        footer: [Item { Layout.fillWidth: true }, Btn { text: "Cancel"; onClicked: nameDlg.close() }, Btn { kind: "primary"; text: "Save"; onClicked: nameDlg.save() }]
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: 0

            ColumnLayout {
                Layout.fillWidth: true
                Layout.margins: 40
                spacing: 18

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Text { Layout.fillWidth: true; text: "Drive"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold }
                    Btn { icon: "plus"; text: "New folder"; onClicked: nameDlg.ask(null) }
                    Btn { kind: "primary"; icon: "upload"; text: "Upload"; onClicked: picker.open() }
                }

                // The server's disk
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Rectangle {
                        Layout.fillWidth: true
                        height: 10
                        color: Theme.surface2
                        Rectangle {
                            height: parent.height
                            width: page.usage ? parent.width * Math.min(1, page.usage.used / page.usage.total) : 0
                            color: page.usage && page.usage.free / page.usage.total < 0.1 ? Theme.accent : Theme.muted
                        }
                        Rectangle {
                            height: parent.height
                            width: page.usage ? Math.max(2, parent.width * page.usage.mine / page.usage.total) : 0
                            color: Theme.accent
                        }
                    }
                    Text {
                        text: !page.usage ? "Reading the server's storage…"
                            : page.size(page.usage.free) + " free of " + page.size(page.usage.total) + " on the server  ·  your files " + page.size(page.usage.mine)
                              + "  ·  up to " + page.size(Math.min(page.usage.usable, page.usage.max_file)) + " per upload"
                        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                    }
                }

                // Where you are
                RowLayout {
                    spacing: 6
                    Text {
                        text: "Drive"
                        color: page.folder ? Theme.accent : Theme.fg
                        font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.folder = "" }
                    }
                    Repeater {
                        model: page.drive.path
                        RowLayout {
                            required property var modelData
                            required property int index
                            spacing: 6
                            Text { text: "/"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 15 }
                            Text {
                                text: modelData.name
                                color: index === page.drive.path.length - 1 ? Theme.fg : Theme.accent
                                font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.folder = modelData.id }
                            }
                        }
                    }
                    Item { width: 16 }
                    Text { text: page.busy; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                    Text { text: page.problem; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                }

                Text {
                    visible: !page.drive.folders.length && !page.drive.files.length
                    Layout.topMargin: 20
                    text: page.folder ? "This folder is empty. Upload files or drop them here." : "Nothing here yet. Make a folder, upload files, or drop them on this page."
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14
                }

                // Folders, then files
                Repeater {
                    model: page.drive.folders.map(f => ({ table: "folders", row: f })).concat(page.drive.files.map(f => ({ table: "files", row: f })))
                    Rectangle {
                        id: item
                        required property var modelData
                        readonly property bool isFolder: modelData.table === "folders"
                        Layout.fillWidth: true
                        height: 48
                        color: im.containsMouse ? Theme.surface2 : Theme.surface
                        border.width: 1
                        border.color: Theme.border
                        MouseArea {
                            id: im
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: item.isFolder ? page.folder = item.modelData.row.id : page.openFile(item.modelData.row)
                        }
                        RowLayout {
                            anchors { fill: parent; leftMargin: 16; rightMargin: 8 }
                            spacing: 14
                            Icon { name: item.isFolder ? "folder" : page.kindIcon(item.modelData.row); size: 16; color: item.isFolder ? Theme.accent : Theme.muted }
                            Text { Layout.fillWidth: true; text: item.modelData.row.name; color: Theme.fg; elide: Text.ElideMiddle; font.family: Theme.mono; font.pixelSize: 15 }
                            Text {
                                text: item.isFolder ? item.modelData.row.items + (item.modelData.row.items === 1 ? " item" : " items")
                                    : page.size(item.modelData.row.size) + "  ·  " + Util.shortDate(Util.dayOf(item.modelData.row.updated_at))
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                            }
                            Btn { compact: true; kind: "subtle"; icon: "edit"; tip: "Rename"; onClicked: nameDlg.ask(item.modelData) }
                            Btn {
                                compact: true; kind: "subtle"; icon: "trash"; tip: "Delete"
                                onClicked: item.isFolder
                                    ? page.app.confirm("Delete " + item.modelData.row.name + "?", "The folder and everything in it are deleted from the server.", "Delete",
                                        () => Api.action("remove_folder", { folder_id: item.modelData.row.id }, () => page.loadUsage()))
                                    : page.app.confirm("Delete " + item.modelData.row.name + "?", "It is deleted from the server" + (item.modelData.row.note_id ? " and stops showing in its note." : "."), "Delete",
                                        () => Api.del("/api/files/" + item.modelData.row.id, () => page.loadUsage()))
                            }
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        visible: drop.containsDrag
        color: Theme.alpha(Theme.accent, 0.12)
        border.width: 2
        border.color: Theme.accent
        Text { anchors.centerIn: parent; text: "Drop to upload here"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
    }
}
