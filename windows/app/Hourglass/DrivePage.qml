import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs
import QtMultimedia

// Files on the server, in folders. Every course has its own folder, holding
// the files put there (its notes and times live in the other tabs). Upload
// with the button or by dropping files on the page. Click a file to open it
// with its app; right-click for more. The bar on top is the server's disk,
// live, so you know how much still fits.
//
// Opened files stay on this computer and are watched: save an edit in its
// app (Illustrator, Photoshop, Word...) and it is uploaded again.
Item {
    id: page
    property var app
    property string folder: "" // "" = the top
    property string course: "" // a course's folder
    property var drive: ({ path: [], folders: [], files: [], courses: [] })
    property var usage: null
    property string busy: ""
    property string problem: ""
    property var info: null // { file_base, key } for previews

    function load() {
        const args = course ? { course_id: course } : folder ? { folder_id: folder } : {};
        Api.action("list_drive", args, d => { if (d) page.drive = d; else { page.folder = ""; page.course = ""; } });
    }
    function loadUsage() { Api.get("/api/drive/usage", d => { if (d) page.usage = d; }); }
    function go(f, c) { page.folder = f || ""; page.course = c || ""; load(); }
    Component.onCompleted: { load(); loadUsage(); Api.get("/api/drive/info", d => { if (d) page.info = d; }); }
    onVisibleChanged: if (visible) { load(); loadUsage(); }
    Connections { target: Api; function onChanged() { if (page.visible) page.load(); } }
    // Real time: the disk is read again every few seconds while you look,
    // and the list too (an edited file's new size, files from other devices).
    Timer { interval: 5000; running: page.visible; repeat: true; onTriggered: { page.loadUsage(); page.load(); } }

    function size(n) {
        if (n === undefined || n === null) return "";
        const u = ["B", "KB", "MB", "GB", "TB"];
        let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i && n < 10 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
    }
    function isImage(f) { return /^image\//.test(f.mime) && !/svg/.test(f.mime); }
    function isVideo(f) { return /^video\//.test(f.mime) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name); }
    function kindIcon(f) { return isImage(f) ? "image" : isVideo(f) ? "play" : "file"; }
    function src(f) { return page.info ? page.info.file_base + f.id + "?k=" + page.info.key + "&v=" + f.updated_at : ""; }

    function upload(urls) {
        if (!urls.length) return;
        let left = urls.length;
        page.problem = "";
        page.busy = "Uploading " + left + (left === 1 ? " file…" : " files…");
        for (const u of urls) {
            Api.request("POST", "/api/files/upload", { path: u.toString(), folder: page.folder || null, course: page.course || null }, (f, err) => {
                if (err) page.problem = err;
                left--;
                page.busy = left ? "Uploading " + left + (left === 1 ? " file…" : " files…") : "";
                if (!left) { page.load(); page.loadUsage(); }
            }, true);
        }
    }
    function openFile(f) {
        page.busy = "Opening " + f.name + "…";
        page.problem = "";
        Api.request("GET", "/api/files/" + f.id + "/local", null, (d, err) => {
            page.busy = "";
            if (d) Qt.openUrlExternally(d.url); else page.problem = err;
        }, true);
    }
    function reveal(f) { Api.request("POST", "/api/files/" + f.id + "/reveal", {}, (d, err) => { if (err) page.problem = err; }, true); }
    function moveTo(f, courseId) { Api.action("move_file", { file_id: f.id, course: courseId }, () => page.load()); }
    function remove(it) {
        if (it.table === "folders")
            page.app.confirm("Delete " + it.row.name + "?", "The folder and everything in it are deleted from the server.", "Delete",
                () => Api.action("remove_folder", { folder_id: it.row.id }, () => page.loadUsage()));
        else
            page.app.confirm("Delete " + it.row.name + "?", "It is deleted from the server and every device" + (it.row.note_id ? ", and stops showing in its note." : "."), "Delete",
                () => Api.del("/api/files/" + it.row.id, () => page.loadUsage()));
    }

    FileDialog {
        id: picker
        title: "Upload files"
        fileMode: FileDialog.OpenFiles
        onAccepted: page.upload(selectedFiles)
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

    // Right-click menu for a file or folder, in the app's look.
    property var menuItem: null
    function openMenu(it, area, mx, my) {
        menuItem = it;
        const p = area.mapToItem(page, mx, my);
        const f = it.row;
        if (it.table === "folders") {
            menu.show(p.x, p.y, f.name, [
                { key: "open", label: "Open folder" },
                { key: "rename", label: "Rename" },
                { separator: true },
                { key: "delete", label: "Delete folder", danger: true },
            ]);
            return;
        }
        const media = page.isImage(f) || page.isVideo(f);
        const courses = (page.app ? page.app.courses : []).map(c => ({ key: "course:" + c.id, label: c.name, checked: f.course_id === c.id }));
        menu.show(p.x, p.y, f.name, [
            { key: "open", label: "Open" },
            media ? { key: "preview", label: "Preview" } : null,
            { key: "reveal", label: "Show in folder" },
            { separator: true },
            { key: "course", label: "Set course", sub: courses.concat([{ separator: true }, { key: "course:", label: "No course", disabled: !f.course_id }]) },
            { key: "rename", label: "Rename" },
            { separator: true },
            { key: "delete", label: "Delete", danger: true },
        ].filter(x => x));
    }
    ContextMenu {
        id: menu
        onPicked: key => {
            const it = page.menuItem, f = it.row;
            if (key === "open") it.table === "folders" ? page.go(f.id, "") : page.openFile(f);
            else if (key === "preview") preview.show(f);
            else if (key === "reveal") page.reveal(f);
            else if (key.startsWith("course:")) page.moveTo(f, key.slice(7) || null);
            else if (key === "rename") nameDlg.ask(it);
            else if (key === "delete") page.remove(it);
        }
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
                    Btn { visible: !page.course; icon: "plus"; text: "New folder"; onClicked: nameDlg.ask(null) }
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
                        color: page.folder || page.course ? Theme.accent : Theme.fg
                        font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.go("", "") }
                    }
                    Text { visible: !!page.course; text: "/  Courses"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 15 }
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
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: modelData.course ? page.go("", modelData.id) : page.go(modelData.id, "") }
                            }
                        }
                    }
                    Item { width: 16 }
                    Text { text: page.busy; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                    Text { text: page.problem; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                }

                // Courses: one folder each (at the top only)
                Text {
                    visible: !!(page.drive.courses && page.drive.courses.length)
                    text: "COURSES"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 2
                }
                Flow {
                    visible: !!(page.drive.courses && page.drive.courses.length)
                    Layout.fillWidth: true
                    spacing: 10
                    Repeater {
                        model: page.drive.courses || []
                        Rectangle {
                            id: ct
                            required property var modelData
                            width: 230; height: 64
                            color: ctm.containsMouse ? Theme.surface2 : Theme.surface
                            border.width: 1
                            border.color: ctm.containsMouse ? Theme.alpha(modelData.color, 0.8) : Theme.border
                            Rectangle { width: 4; height: parent.height; color: ct.modelData.color }
                            ColumnLayout {
                                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 16; rightMargin: 12 }
                                spacing: 2
                                RowLayout {
                                    spacing: 8
                                    Icon { name: "folder"; size: 14; color: ct.modelData.color }
                                    Text { Layout.fillWidth: true; text: ct.modelData.name; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14; font.weight: Font.Bold }
                                }
                                Text { text: ct.modelData.items + (ct.modelData.items === 1 ? " file" : " files"); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                            }
                            MouseArea { id: ctm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.go("", ct.modelData.id) }
                        }
                    }
                }
                Text {
                    visible: !page.course && !page.folder
                    Layout.topMargin: 6
                    text: "FILES"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 2
                }

                Text {
                    visible: !page.drive.folders.length && !page.drive.files.length
                    text: page.course ? "No files for this course yet. Upload or drop them here, or right-click any file > Set course."
                        : page.folder ? "This folder is empty. Upload files or drop them here."
                        : "Make a folder, upload files, or drop them on this page."
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14
                }

                // Folders, then files
                Repeater {
                    model: page.drive.folders.map(f => ({ table: "folders", row: f })).concat(page.drive.files.map(f => ({ table: "files", row: f })))
                    Rectangle {
                        id: item
                        required property var modelData
                        readonly property bool isFolder: modelData.table === "folders"
                        readonly property var f: modelData.row
                        Layout.fillWidth: true
                        height: 52
                        color: im.containsMouse ? Theme.surface2 : Theme.surface
                        border.width: 1
                        border.color: Theme.border
                        MouseArea {
                            id: im
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            acceptedButtons: Qt.LeftButton | Qt.RightButton
                            onClicked: e => {
                                if (e.button === Qt.RightButton) { page.openMenu(item.modelData, im, e.x, e.y); return; }
                                if (item.isFolder) page.go(item.f.id, "");
                                else if (page.isImage(item.f) || page.isVideo(item.f)) preview.show(item.f);
                                else page.openFile(item.f);
                            }
                            onDoubleClicked: if (!item.isFolder) page.openFile(item.f)
                        }
                        RowLayout {
                            anchors { fill: parent; leftMargin: 10; rightMargin: 8 }
                            spacing: 12
                            // A small picture for images, else an icon.
                            Item {
                                width: 36; height: 36
                                Image {
                                    anchors.fill: parent
                                    visible: !item.isFolder && page.isImage(item.f)
                                    source: visible ? page.src(item.f) : ""
                                    sourceSize: Qt.size(72, 72)
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                }
                                Icon {
                                    anchors.centerIn: parent
                                    visible: item.isFolder || !page.isImage(item.f)
                                    name: item.isFolder ? "folder" : page.kindIcon(item.f); size: 16
                                    color: item.isFolder ? Theme.accent : Theme.muted
                                }
                            }
                            Text { Layout.fillWidth: true; text: item.f.name; color: Theme.fg; elide: Text.ElideMiddle; font.family: Theme.mono; font.pixelSize: 15 }
                            Text {
                                text: item.isFolder ? item.f.items + (item.f.items === 1 ? " item" : " items")
                                    : page.size(item.f.size) + "  ·  " + Util.shortDate(Util.dayOf(item.f.updated_at)) + " " + Util.clock(item.f.updated_at)
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                            }
                            Btn { id: more; compact: true; kind: "subtle"; text: "⋯"; tip: "More"; onClicked: page.openMenu(item.modelData, more, 0, more.height) }
                        }
                    }
                }
                Text {
                    visible: page.drive.files.length > 0
                    text: "Click a picture or video to preview it, anything else opens in its app. Edits you save there are uploaded again by themselves."
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
                }
            }
        }
    }

    // Drop files anywhere on the page to upload them here.
    DropArea {
        id: drop
        anchors.fill: parent
        z: 5
        onEntered: d => { if (d.hasUrls) d.accept(Qt.CopyAction); }
        onDropped: d => { if (!d.hasUrls) return; d.accept(Qt.CopyAction); page.upload(d.urls); }
    }
    Rectangle {
        anchors.fill: parent
        z: 6
        visible: drop.containsDrag
        color: Theme.alpha(Theme.accent, 0.12)
        border.width: 2
        border.color: Theme.accent
        Text { anchors.centerIn: parent; text: "Drop to upload here"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
    }

    // Preview: pictures and videos, over the page. Esc or click outside closes.
    Rectangle {
        id: preview
        property var f: null
        readonly property bool video: !!(f && page.isVideo(f))
        anchors.fill: parent
        visible: f !== null
        color: Qt.rgba(0, 0, 0, 0.88)
        z: 10
        function show(file) { f = file; if (video) { player.source = page.src(file); player.play(); } forceActiveFocus(); }
        function hide() { player.stop(); player.source = ""; f = null; }
        Keys.onEscapePressed: hide()
        Keys.onSpacePressed: if (video) player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play()
        MouseArea { anchors.fill: parent; onClicked: preview.hide() }

        Image {
            anchors { fill: parent; margins: 60; bottomMargin: 90 }
            visible: !!preview.f && !preview.video
            source: visible ? page.src(preview.f) : ""
            fillMode: Image.PreserveAspectFit
            asynchronous: true
            MouseArea { anchors.centerIn: parent; width: parent.paintedWidth; height: parent.paintedHeight } // clicks on the picture keep it open
        }
        MediaPlayer {
            id: player
            videoOutput: vo
            audioOutput: AudioOutput {}
        }
        VideoOutput {
            id: vo
            anchors { fill: parent; margins: 60; bottomMargin: 120 }
            visible: preview.video
            MouseArea { anchors.fill: parent; onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play() }
        }
        // Video controls
        RowLayout {
            visible: preview.video
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 60; bottomMargin: 76 }
            spacing: 14
            Btn { compact: true; icon: player.playbackState === MediaPlayer.PlayingState ? "pause" : "play"; onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play() }
            Slider {
                Layout.fillWidth: true
                from: 0; to: Math.max(1, player.duration)
                value: player.position
                onMoved: player.position = value
            }
            Text {
                text: Util.countdown(player.position / 1000) + " / " + Util.countdown(player.duration / 1000)
                color: "white"; font.family: Theme.mono; font.pixelSize: 13
            }
        }
        RowLayout {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 24 }
            spacing: 10
            Text { Layout.fillWidth: true; text: preview.f ? preview.f.name + "   " + page.size(preview.f.size) : ""; color: "white"; elide: Text.ElideMiddle; font.family: Theme.mono; font.pixelSize: 15 }
            Btn { text: "Open in its app"; icon: "folder-open"; onClicked: { const f = preview.f; preview.hide(); page.openFile(f); } }
            Btn { text: "Close"; icon: "close"; onClicked: preview.hide() }
        }
    }
}
