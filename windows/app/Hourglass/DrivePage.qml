import QtCore
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
// Nothing is downloaded until it is opened: the list shows small previews
// made on the server. Opened files stay on this computer and are watched:
// save an edit in its app (Illustrator, Photoshop, Word...) and it is
// uploaded again. "Download…" saves a copy wherever you choose.
//
// Drag a file or folder onto a folder (or onto a name in the path above, or
// onto a course) to move it there; "Move to…" in its menu does the same.
// "Share…" makes a link anyone can open: view only, or view and download.
Item {
    id: page
    property var app
    property string folder: "" // "" = the top
    property string course: "" // a course's folder
    property var drive: ({ path: [], folders: [], files: [], courses: [] })
    property var usage: null
    property string busy: ""
    property string problem: ""
    property var info: null // { file_base, thumb_base, key } for previews
    property var shares: ({}) // file or folder id -> its link
    property var allFolders: [] // every folder, for "Move to…"
    property var syncFolders: [] // folders synced between this PC and Drive
    property alias driveFolderPicker: driveFolderPicker
    property alias stopSyncDlg: stopSyncDlg
    property alias localFolderPicker: localFolderPicker
    property var syncCommands: ({})
    property var expandedSyncErrors: ({})
    property bool loadingSyncFolders: false
    readonly property bool syncVisible: visible && Util.shown(app)

    function loadSyncFolders() {
        if (!syncVisible || loadingSyncFolders) return;
        loadingSyncFolders = true;
        Api.request("GET", "/api/syncfolders", null, (list, err) => {
            loadingSyncFolders = false;
            if (!list) return;
            page.syncFolders = list;
            const commands = Object.assign({}, syncCommands);
            for (const id of Object.keys(commands)) {
                const pair = list.find(p => p.id === id);
                if (!pair || (commands[id] === "waiting" && pair.state !== "paused")) delete commands[id];
            }
            syncCommands = commands;
        }, true);
    }
    function isFolderSynced(folderId) {
        if (!folderId || !page.syncFolders) return false;
        return page.syncFolders.some(p => p.folder_id === folderId);
    }
    function formatSyncTime(ms) {
        if (!ms) return "Never";
        const sec = Math.floor((Date.now() - ms) / 1000);
        if (sec < 10) return "just now";
        if (sec < 60) return sec + "s ago";
        const min = Math.floor(sec / 60);
        if (min < 60) return min + "m ago";
        return Util.shortDate(Util.dayOf(ms)) + " " + Util.clock(ms);
    }
    function syncCommand(pairId, action) {
        if (syncCommands[pairId]) return;
        syncCommands = Object.assign({}, syncCommands, { [pairId]: "sending" });
        Api.request("POST", "/api/syncfolders/" + pairId + "/" + action, {}, function(pair, err) {
            const commands = Object.assign({}, page.syncCommands);
            // confirm/keep can wait behind a running pass. The visible-page
            // timer keeps checking for as long as the pair remains paused.
            if (!err && (action === "confirm" || action === "keep") && pair.state === "paused") commands[pairId] = "waiting";
            else delete commands[pairId];
            page.syncCommands = commands;
            if (err) page.problem = err;
            page.loadSyncFolders();
        }, true);
    }

    function localPath(url) {
        const raw = url.toString();
        // Decode only URLs: a literal '%' in a Windows path is valid.
        if (!raw.startsWith("file://")) return raw;
        let path = decodeURIComponent(raw.slice(7));
        if (Qt.platform.os === "windows") {
            if (!path.startsWith("/")) path = "//" + path; // UNC host/share
            path = path.replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\");
        }
        return path;
    }
    function localUrl(path) {
        const normalized = path.replace(/\\/g, "/");
        return (normalized.startsWith("//") ? "file:" : normalized.startsWith("/") ? "file://" : "file:///")
            + normalized.split("/").map(part => encodeURIComponent(part).replace(/%3A/gi, ":")).join("/");
    }

    // How the files look, kept on this computer: "icons" (a grid, like
    // Windows), "details" (a list with columns), "gallery" (big pictures).
    // Sorting is the same in every view; folders always come first.
    Settings {
        id: look
        location: "file:///" + StandardPaths.writableLocation(StandardPaths.GenericDataLocation).toString().replace(/^file:\/+/, "") + "/Hourglass/window.ini"
        category: "drive"
        property string view: "details"
        property string sortBy: "name" // name | date | type | size
        property bool sortDesc: false
    }
    function typeOf(f, folder) {
        if (folder) return "Folder";
        if (isImage(f)) return "Picture";
        if (isVideo(f)) return "Video";
        const ext = (/\.([a-z0-9]{1,6})$/i.exec(f.name) || [])[1];
        return ext ? ext.toUpperCase() + " file" : "File";
    }
    function sortOn(key) {
        if (look.sortBy === key) look.sortDesc = !look.sortDesc;
        else { look.sortBy = key; look.sortDesc = key === "date" || key === "size"; }
    }
    readonly property var items: {
        const key = look.sortBy, dir = look.sortDesc ? -1 : 1;
        const val = (f, folder) => key === "size" ? (folder ? f.items || 0 : f.size || 0) : key === "date" ? f.updated_at || 0 : key === "type" ? typeOf(f, folder) : f.name.toLowerCase();
        const by = folder => (a, b) => {
            const x = val(a, folder), y = val(b, folder);
            return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name);
        };
        const folders = drive.folders.slice().sort(by(true)).map(f => ({ table: "folders", row: f }));
        const files = drive.files.slice().sort(by(false)).map(f => ({ table: "files", row: f }));
        // In a grid the files start on a line of their own, under the folders.
        const gap = look.view !== "details" && folders.length && files.length ? [{ table: "break", row: { id: "", name: "", items: 0 } }] : [];
        return folders.concat(gap, files);
    }

    function load() {
        const args = course ? { course_id: course } : folder ? { folder_id: folder } : {};
        Api.action("list_drive", args, d => { if (d) page.drive = d; else { page.folder = ""; page.course = ""; } });
        Api.get("/api/folders", d => { if (d) page.allFolders = d; });
    }
    // Links live on the server only: read when the page opens, after a change
    // here, and with the disk every minute (one made on another device).
    function loadShares() {
        Api.request("GET", "/api/shares", null, (list) => {
            if (!list) return;
            const m = {};
            for (const s of list) if (s.active) m[s.file_id || s.folder_id] = s;
            page.shares = m;
        }, true);
    }
    function loadUsage() { Api.get("/api/drive/usage", d => { if (d) page.usage = d; }); loadShares(); }
    function go(f, c) { page.folder = f || ""; page.course = c || ""; load(); }
    Component.onCompleted: { load(); loadUsage(); loadSyncFolders(); Api.get("/api/drive/info", d => { if (d) page.info = d; }); }
    onVisibleChanged: if (visible) { load(); loadUsage(); loadSyncFolders(); }
    onSyncVisibleChanged: if (syncVisible) loadSyncFolders()
    Connections { target: Api; function onChanged() { if (page.visible) { page.load(); page.loadSyncFolders(); } } }
    // Real time: the list is read again every few seconds while you look (an
    // edited file's new size, files from other devices); the server's disk, which
    // barely moves, every minute and after each upload or delete.
    Timer { interval: 3000; running: page.syncVisible; repeat: true; onTriggered: page.loadSyncFolders() }
    Timer { interval: 5000; running: page.syncVisible; repeat: true; onTriggered: page.load() }
    Timer { interval: 60000; running: page.syncVisible; repeat: true; onTriggered: page.loadUsage() }

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
    // The list's small picture: made on the server, so showing it downloads nothing.
    function thumb(f) { return page.info && page.info.thumb_base ? page.info.thumb_base + f.id + "?k=" + page.info.key + "&v=" + f.updated_at : ""; }

    // "Download…": ask where, then the service saves a copy there.
    function download(f) {
        saver.f = f;
        saver.selectedFile = saver.currentFolder + "/" + f.name;
        saver.open();
    }
    function saveTo(f, url) {
        page.busy = "Downloading " + f.name + "…";
        page.problem = "";
        Api.request("POST", "/api/files/" + f.id + "/save", { path: url.toString() }, (d, err) => {
            page.busy = "";
            if (err) page.problem = err;
            else page.app.showToast("Saved " + f.name);
        }, true);
    }

    // into: a folder id to upload there instead of here. The upload panel
    // (bottom right) shows each file going up; a file lands here once it's there.
    function upload(urls, into) {
        if (!urls.length) return;
        let left = urls.length;
        page.problem = "";
        const folder = into !== undefined ? into : page.folder || null;
        const course = into !== undefined ? null : page.course || null;
        for (const u of urls) {
            Api.request("POST", "/api/files/upload", { path: u.toString(), folder: folder, course: course }, (f, err) => {
                left--;
                page.load();
                if (!left) page.loadUsage();
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
    // A file or folder into a folder ("" = the top of the Drive).
    function moveInto(it, folderId) {
        const target = folderId || null;
        if (it.table === "folders") {
            if (it.row.id === target || (it.row.parent_id || null) === target) return;
            Api.request("POST", "/api/actions/move_folder", { folder_id: it.row.id, parent_id: target }, (d, err) => {
                if (err) page.problem = err; else page.app.showToast("Moved " + it.row.name);
                page.load();
            }, true);
        } else {
            if ((it.row.folder_id || null) === target && !it.row.course_id) return;
            Api.action("move_file", { file_id: it.row.id, folder_id: target }, () => { page.app.showToast("Moved " + it.row.name); page.load(); });
        }
    }
    // Every folder as "Parent / Child" paths, for "Move to…". A folder can't go into itself.
    function folderChoices(it) {
        const all = page.allFolders;
        const byId = {};
        for (const f of all) byId[f.id] = f;
        const pathOf = f => { const names = []; for (let x = f, n = 0; x && n < 20; x = byId[x.parent_id], n++) names.unshift(x.name); return names.join(" / "); };
        const inside = f => { for (let x = f, n = 0; x && n < 20; x = byId[x.parent_id], n++) if (x.id === it.row.id) return true; return false; };
        const here = it.table === "folders" ? it.row.parent_id || null : it.row.folder_id || null;
        const list = all.filter(f => !(it.table === "folders" && inside(f)))
            .map(f => ({ key: "into:" + f.id, label: pathOf(f), checked: here === f.id && !it.row.course_id }))
            .sort((a, b) => a.label.localeCompare(b.label));
        return [{ key: "into:", label: "Top of the Drive", checked: !here && !it.row.course_id }, { separator: true }].concat(list);
    }
    function remove(it) {
        if (it.table === "folders")
            page.app.confirm("Delete " + it.row.name + "?", "The folder and everything in it are deleted from the server.", "Delete",
                () => Api.action("remove_folder", { folder_id: it.row.id }, () => page.loadUsage()));
        else
            page.app.confirm("Delete " + it.row.name + "?", "It is deleted from the server and every device" + (it.row.note_id ? ", and stops showing in its note." : "."), "Delete",
                () => Api.del("/api/files/" + it.row.id, () => page.loadUsage()));
    }

    FileDialog {
        id: saver
        property var f: null
        title: "Download " + (f ? f.name : "")
        fileMode: FileDialog.SaveFile
        currentFolder: StandardPaths.writableLocation(StandardPaths.DownloadLocation)
        onAccepted: if (f) page.saveTo(f, selectedFile)
    }

    FileDialog {
        id: picker
        title: "Upload files"
        fileMode: FileDialog.OpenFiles
        onAccepted: page.upload(selectedFiles)
    }

    FolderDialog {
        id: localFolderPicker
        title: "Choose a folder on this PC to sync"
        currentFolder: StandardPaths.writableLocation(StandardPaths.HomeLocation)
        onAccepted: {
            driveFolderPicker.ask(page.localPath(selectedFolder));
        }
    }

    Modal {
        id: driveFolderPicker
        property string localPath: ""
        property string localDisplay: ""
        property string defaultFolderName: ""
        property string mode: "new" // "new" | "existing"
        property string selectedFolderId: ""
        property string parentFolderId: ""
        property string problem: ""
        property bool submitting: false
        width: Math.min(560, page.width - 32)
        title: "Sync with Hourglass Drive"
        subtitle: "Keep a folder on this PC and a folder on Hourglass Drive in sync."

        readonly property var folderOptions: {
            const all = page.allFolders || [];
            const byId = {};
            for (const f of all) byId[f.id] = f;
            const pathOf = f => {
                const names = [];
                for (let x = f, n = 0; x && n < 20; x = byId[x.parent_id], n++) names.unshift(x.name);
                return names.join(" / ");
            };
            return all.map(f => ({ label: pathOf(f), value: f.id })).sort((a, b) => a.label.localeCompare(b.label));
        }
        readonly property var parentOptions: {
            return [{ label: "Top of Drive (Root)", value: "" }].concat(folderOptions);
        }
        function ask(path) {
            localPath = path;
            localDisplay = path;
            const parts = path.split(/[\\\/]/).filter(Boolean);
            defaultFolderName = parts.length ? parts[parts.length - 1] : "Folder";
            newFolderNameField.text = defaultFolderName;
            selectedFolderId = folderOptions.length ? folderOptions[0].value : "";
            parentFolderId = "";
            mode = folderOptions.length ? "existing" : "new";
            problem = "";
            open();
        }
        function submit() {
            if (submitting) return;
            problem = "";
            var body = { local: localPath };
            if (mode === "new") {
                var name = newFolderNameField.text.trim();
                if (!name) { problem = "Enter a folder name."; return; }
                body.folder_name = name;
                if (parentFolderId) body.parent_id = parentFolderId;
            } else {
                if (!selectedFolderId) { problem = "Choose a Drive folder."; return; }
                body.folder_id = selectedFolderId;
            }
            submitting = true;
            Api.request("POST", "/api/syncfolders", body, function(res, err) {
                driveFolderPicker.submitting = false;
                if (err) {
                    driveFolderPicker.problem = err;
                } else {
                    driveFolderPicker.close();
                    page.loadSyncFolders();
                    page.load();
                    page.app.showToast("Started syncing " + (res.folder_path || res.local));
                }
            }, true);
        }

        Text { text: "LOCAL FOLDER"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1.5 }
        Rectangle {
            Layout.fillWidth: true
            height: 36
            color: Theme.bg
            border.width: 1
            border.color: Theme.border
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 11
                anchors.rightMargin: 11
                Text { Layout.fillWidth: true; text: driveFolderPicker.localDisplay; color: Theme.fg; elide: Text.ElideMiddle; font.family: Theme.mono; font.pixelSize: 13 }
            }
        }

        Text { text: "DESTINATION ON DRIVE"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1.5 }
        RowLayout {
            spacing: 8
            Btn {
                text: "Existing folder"; icon: "folder"; compact: true
                active: driveFolderPicker.mode === "existing"
                onClicked: driveFolderPicker.mode = "existing"
            }
            Btn {
                text: "New folder"; icon: "plus"; compact: true
                active: driveFolderPicker.mode === "new"
                onClicked: driveFolderPicker.mode = "new"
            }
        }

        ColumnLayout {
            visible: driveFolderPicker.mode === "existing"
            Layout.fillWidth: true
            spacing: 8
            Text {
                visible: !driveFolderPicker.folderOptions.length
                text: "No folders on Drive yet. Click New folder above to create one."
                color: Theme.faint
                font.family: Theme.mono
                font.pixelSize: 13
            }
            Picker {
                visible: driveFolderPicker.folderOptions.length > 0
                Layout.fillWidth: true
                options: driveFolderPicker.folderOptions
                value: driveFolderPicker.selectedFolderId
                onPicked: v => driveFolderPicker.selectedFolderId = v
            }
        }

        ColumnLayout {
            visible: driveFolderPicker.mode === "new"
            Layout.fillWidth: true
            spacing: 8
            Field {
                id: newFolderNameField
                Layout.fillWidth: true
                placeholderText: "New folder name"
                onAccepted: driveFolderPicker.submit()
            }
            Text { text: "INSIDE (OPTIONAL)"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1.5 }
            Picker {
                Layout.fillWidth: true
                options: driveFolderPicker.parentOptions
                value: driveFolderPicker.parentFolderId
                onPicked: v => driveFolderPicker.parentFolderId = v
            }
        }

        Text {
            visible: driveFolderPicker.problem !== ""
            text: driveFolderPicker.problem
            color: Theme.accent
            wrapMode: Text.Wrap
            Layout.fillWidth: true
            font.family: Theme.mono
            font.pixelSize: 13
        }

        footer: [
            Item { Layout.fillWidth: true },
            Btn { text: "Cancel"; onClicked: driveFolderPicker.close() },
            Btn { kind: "primary"; icon: "sync"; text: driveFolderPicker.submitting ? "Starting…" : "Start syncing"; enabled: !driveFolderPicker.submitting; onClicked: driveFolderPicker.submit() }
        ]
    }

    ConfirmDialog {
        id: stopSyncDlg
        property string pairId: ""
        function askStop(pair) {
            pairId = pair.id;
            ask("Stop syncing " + (pair.folder_path || "folder") + "?",
                "Syncing will stop. All files will stay on this PC and on Drive.",
                "Stop syncing",
                function() {
                    Api.request("DELETE", "/api/syncfolders/" + pairId, null, function(d, err) {
                        if (err) page.problem = err;
                        else {
                            page.app.showToast("Stopped syncing");
                            page.loadSyncFolders();
                        }
                    }, true);
                }
            );
        }
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
                { key: "share", label: page.shares[f.id] ? "Shared · link…" : "Share…" },
                { key: "move", label: "Move to…", sub: page.folderChoices(it) },
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
            { key: "download", label: "Download…" },
            { key: "reveal", label: "Show in folder" },
            { key: "share", label: page.shares[f.id] ? "Shared · link…" : "Share…" },
            { key: "versions", label: "Versions…" },
            { separator: true },
            { key: "move", label: "Move to…", sub: page.folderChoices(it) },
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
            else if (key === "download") page.download(f);
            else if (key === "reveal") page.reveal(f);
            else if (key.startsWith("course:")) page.moveTo(f, key.slice(7) || null);
            else if (key.startsWith("into:")) page.moveInto(it, key.slice(5));
            else if (key === "share") shareDlg.ask(it);
            else if (key === "versions") versionsDlg.ask(f);
            else if (key === "rename") nameDlg.ask(it);
            else if (key === "delete") page.remove(it);
        }
    }

    VersionsDialog { id: versionsDlg; page: page }

    // QML has no clipboard API: copy through a hidden text field.
    TextEdit { id: clip; visible: false }
    function copy(text) { clip.text = text; clip.selectAll(); clip.copy(); }

    // What is being dragged, under the pointer. The drop point is this item's
    // top-left corner, the pointer itself; the label hangs off to the side.
    Item {
        id: ghost
        property var pending: null // pressed, not dragged yet
        property var item: null // being dragged
        function begin() { item = pending; Drag.active = true; }
        function end() { if (Drag.active) Drag.drop(); Drag.active = false; item = null; }
        // The press was taken away (the window lost focus mid-drag): nothing moves.
        function cancel() { if (Drag.active) Drag.cancel(); Drag.active = false; item = null; pending = null; }
        width: 1; height: 1
        z: 30
        Drag.keys: ["hg-drive"]
        Drag.supportedActions: Qt.MoveAction
        Rectangle {
            visible: ghost.item !== null
            x: 14; y: -6
            width: Math.min(340, ghostRow.implicitWidth + 24); height: 34
            color: Theme.surface2
            border.width: 1
            border.color: Theme.accent
            RowLayout {
                id: ghostRow
                anchors { left: parent.left; leftMargin: 12; verticalCenter: parent.verticalCenter }
                spacing: 8
                Icon { name: ghost.item && ghost.item.table === "folders" ? "folder" : "file"; size: 13; color: Theme.accent }
                Text { text: ghost.item ? "Move " + ghost.item.row.name : ""; color: Theme.fg; elide: Text.ElideMiddle; Layout.maximumWidth: 290; font.family: Theme.mono; font.pixelSize: 13 }
            }
        }
    }

    // A Details column heading: a click sorts by it (again: the other way).
    component Heading: Text {
        id: hd
        property string key: ""
        property string label: ""
        text: label + (look.sortBy === key ? (look.sortDesc ? "  ↓" : "  ↑") : "")
        color: look.sortBy === key ? Theme.fg : Theme.muted
        font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1
        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.sortOn(hd.key) }
    }

    // A folder (or the top, folderId "") that takes dragged files and folders,
    // and files dropped from the computer (uploaded into it).
    component DropTarget: DropArea {
        id: dt
        property string folderId: ""
        property string exclude: "" // a folder can't go into itself
        keys: ["hg-drive", "text/uri-list"]
        onEntered: d => {
            if (d.hasUrls) { d.accept(Qt.CopyAction); return; }
            if (!ghost.item || (ghost.item.table === "folders" && ghost.item.row.id === dt.exclude)) d.accepted = false;
        }
        onDropped: d => {
            if (d.hasUrls) { d.accept(Qt.CopyAction); page.upload(d.urls, dt.folderId || null); return; }
            if (ghost.item) page.moveInto(ghost.item, dt.folderId);
        }
        Rectangle { anchors.fill: parent; visible: dt.containsDrag; color: Theme.alpha(Theme.accent, 0.16); border.width: 2; border.color: Theme.accent }
    }

    // Share…: a link anyone can open in a browser, view only or view and download.
    Modal {
        id: shareDlg
        objectName: "shareDialog"
        property var it: null
        property var link: null // this file's or folder's link, once made
        property string access: "view"
        property int days: 0
        property string note: ""
        width: 600
        title: it ? "Share " + it.row.name : "Share"
        subtitle: "Anyone with the link can open it in a browser, no account needed."
        function ask(x) {
            it = x;
            link = page.shares[x.row.id] || null;
            access = link ? link.access : "view";
            days = 0;
            note = "";
            open();
        }
        function make() {
            const body = it.table === "folders" ? { folder_id: it.row.id } : { file_id: it.row.id };
            body.access = access;
            body.expires_days = days;
            Api.request("POST", "/api/shares", body, (s, err) => {
                if (err) { note = err; return; }
                link = s;
                page.copy(s.url);
                note = "Link copied. Paste it anywhere.";
                page.loadShares();
            }, true);
        }
        function stop() {
            Api.request("DELETE", "/api/shares/" + link.token, null, (d, err) => {
                if (err) { note = err; return; }
                link = null;
                note = "Sharing stopped: the link no longer opens anything.";
                page.loadShares();
            }, true);
        }
        Text { text: "WHO CAN SEE IT"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 2 }
        Flow {
            Layout.fillWidth: true
            spacing: 6
            Btn { text: "Anyone with the link can view"; icon: "eye"; kind: "subtle"; active: shareDlg.access === "view"; onClicked: shareDlg.access = "view" }
            Btn { text: "…can view and download"; icon: "download"; kind: "subtle"; active: shareDlg.access === "download"; onClicked: shareDlg.access = "download" }
        }
        Text { text: "THE LINK STOPS WORKING"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 2 }
        Flow {
            Layout.fillWidth: true
            spacing: 6
            Repeater {
                model: [{ d: 0, t: "Never" }, { d: 1, t: "After 1 day" }, { d: 7, t: "After 7 days" }, { d: 30, t: "After 30 days" }]
                Btn { required property var modelData; text: modelData.t; kind: "subtle"; active: shareDlg.days === modelData.d; onClicked: shareDlg.days = modelData.d }
            }
        }
        RowLayout {
            visible: !!shareDlg.link
            Layout.fillWidth: true
            spacing: 8
            Field { Layout.fillWidth: true; readOnly: true; text: shareDlg.link ? shareDlg.link.url : ""; onActiveFocusChanged: if (activeFocus) selectAll() }
            Btn { icon: "link"; text: "Copy"; onClicked: { page.copy(shareDlg.link.url); shareDlg.note = "Link copied."; } }
        }
        Text {
            visible: !!shareDlg.link
            text: !shareDlg.link ? "" : "Now: anyone with the link can " + (shareDlg.link.access === "download" ? "view and download" : "view")
                + (shareDlg.link.expires_at ? ", until " + Util.shortDate(Util.dayOf(shareDlg.link.expires_at)) + "." : ".")
                + (shareDlg.it && shareDlg.it.table === "folders" ? " Everything in the folder is included." : "")
            color: Theme.muted; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 13
        }
        Text { visible: shareDlg.note !== ""; text: shareDlg.note; color: Theme.accent; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 13 }
        footer: [
            Btn { visible: !!shareDlg.link; kind: "danger"; icon: "close"; text: "Stop sharing"; onClicked: shareDlg.stop() },
            Item { Layout.fillWidth: true },
            Btn { text: "Close"; onClicked: shareDlg.close() },
            Btn { kind: "primary"; icon: "link"; text: shareDlg.link ? "Save and copy link" : "Create and copy link"; onClicked: shareDlg.make() }
        ]
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

                Flow {
                    Layout.fillWidth: true
                    spacing: 8
                    Text { width: Math.max(100, parent.width - viewChoices.width - syncFolderButton.width - (newFolderButton.visible ? newFolderButton.width + 8 : 0) - uploadButton.width - 24); text: "Drive"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold }
                    // How the files look.
                    Row {
                        id: viewChoices
                        spacing: 2
                        Repeater {
                            model: [{ key: "icons", icon: "grid", tip: "Icons" }, { key: "details", icon: "list", tip: "Details" }, { key: "gallery", icon: "gallery", tip: "Gallery" }]
                            Btn { required property var modelData; compact: true; icon: modelData.icon; tip: modelData.tip; active: look.view === modelData.key; onClicked: look.view = modelData.key }
                        }
                    }
                    Btn { id: syncFolderButton; icon: "sync"; text: "Sync a folder…"; onClicked: localFolderPicker.open() }
                    Btn { id: newFolderButton; visible: !page.course; icon: "plus"; text: "New folder"; onClicked: nameDlg.ask(null) }
                    Btn { id: uploadButton; kind: "primary"; icon: "upload"; text: "Upload"; onClicked: picker.open() }
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
                        Layout.fillWidth: true
                        wrapMode: Text.Wrap
                        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                    }
                }

                // Where you are (a deep path wraps onto more lines)
                Flow {
                    Layout.fillWidth: true
                    spacing: 6
                    Text {
                        text: "Drive"
                        color: page.folder || page.course ? Theme.accent : Theme.fg
                        font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.go("", "") }
                        DropTarget { anchors.fill: parent; anchors.margins: -6; folderId: ""; visible: !!(page.folder || page.course) }
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
                                DropTarget { anchors.fill: parent; anchors.margins: -6; folderId: modelData.id; visible: !modelData.course && index < page.drive.path.length - 1 }
                            }
                        }
                    }
                    Item { width: 16 }
                    Text { text: page.busy; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                    Text { text: page.problem; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                }

                // Synced folders on this PC
                ColumnLayout {
                    visible: !page.course && !page.folder && page.syncFolders.length > 0
                    Layout.fillWidth: true
                    spacing: 12
                    Section {
                        text: "SYNCED FOLDERS"
                        detail: page.syncFolders.length + (page.syncFolders.length === 1 ? " pair" : " pairs")
                    }
                    Repeater {
                        model: page.syncFolders
                        Rectangle {
                            id: syncCard
                            required property var modelData
                            required property int index
                            readonly property bool errorsExpanded: !!page.expandedSyncErrors[modelData.id]
                            Layout.fillWidth: true
                            implicitHeight: syncCardCol.implicitHeight + 24
                            color: Theme.surface
                            border.width: 1
                            border.color: Theme.border
                            Rectangle {
                                width: 4
                                height: parent.height
                                color: modelData.state === "error" ? Theme.accent : modelData.state === "paused" ? Theme.gold : modelData.state === "syncing" ? Theme.teal : Theme.border
                            }
                            ColumnLayout {
                                id: syncCardCol
                                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12; leftMargin: 16 }
                                spacing: 10
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 10
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 3
                                        RowLayout {
                                            Layout.fillWidth: true
                                            spacing: 8
                                            Icon { name: "sync"; size: 16; color: Theme.teal }
                                            Text {
                                                Layout.fillWidth: true
                                                text: modelData.local
                                                color: Theme.fg
                                                font.family: Theme.mono
                                                font.pixelSize: 14
                                                font.weight: Font.DemiBold
                                                elide: Text.ElideMiddle
                                                Layout.preferredWidth: 1
                                                ToolTip.visible: localHover.hovered
                                                ToolTip.text: modelData.local
                                                HoverHandler { id: localHover }
                                            }
                                            Icon { name: "right"; size: 10; color: Theme.muted }
                                            Text {
                                                Layout.fillWidth: true
                                                Layout.preferredWidth: 1
                                                ToolTip.visible: driveHover.hovered
                                                ToolTip.text: modelData.folder_path || "Drive"
                                                HoverHandler { id: driveHover }
                                                text: "Drive / " + ((modelData.folder_path || "Folder").replace(/^Drive\s*\/\s*/i, ""))
                                                color: Theme.fg
                                                font.family: Theme.mono
                                                font.pixelSize: 14
                                                font.weight: Font.DemiBold
                                                elide: Text.ElideRight
                                            }
                                        }
                                        Flow {
                                            Layout.fillWidth: true
                                            spacing: 8
                                            Text {
                                                text: {
                                                    if (modelData.state === "paused") {
                                                        if (modelData.reason === "mass_delete") return "PAUSED · Review deleted files";
                                                        if (modelData.reason === "root_unreadable") return "PAUSED · Folder unreadable";
                                                        if (modelData.reason === "drive_folder_missing") return "PAUSED · Drive folder missing";
                                                        if (modelData.reason === "user") return "PAUSED · Paused by you";
                                                        if (modelData.reason) return "PAUSED · " + modelData.reason;
                                                        return "PAUSED";
                                                    }
                                                    return (modelData.state || "idle").toUpperCase();
                                                }
                                                color: modelData.state === "error" ? Theme.accent : modelData.state === "paused" ? Theme.gold : modelData.state === "syncing" ? Theme.teal : Theme.muted
                                                font.family: Theme.mono
                                                font.pixelSize: 12
                                                font.weight: Font.Bold
                                            }
                                            Text { text: "·"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12 }
                                            Text {
                                                text: modelData.last_sync ? "Last synced " + page.formatSyncTime(modelData.last_sync) : "Not synced yet"
                                                color: Theme.muted
                                                font.family: Theme.mono
                                                font.pixelSize: 12
                                            }
                                            Text {
                                                text: "·  " + modelData.pending + " pending"
                                                color: modelData.pending > 0 ? Theme.accent : Theme.muted
                                                font.family: Theme.mono
                                                font.pixelSize: 12
                                            }
                                        }
                                    }
                                    Flow {
                                        Layout.fillWidth: true
                                        spacing: 6
                                        Btn {
                                            compact: true
                                            icon: "sync"
                                            text: "Sync now"
                                            enabled: !page.syncCommands[modelData.id] && modelData.state !== "paused" && modelData.state !== "syncing"
                                            onClicked: page.syncCommand(modelData.id, "now")
                                        }
                                        Btn {
                                            compact: true
                                            icon: modelData.state === "paused" ? "play" : "pause"
                                            text: modelData.state === "paused" ? "Resume" : "Pause"
                                            enabled: !page.syncCommands[modelData.id] && modelData.reason !== "mass_delete"
                                            onClicked: {
                                                var op = modelData.state === "paused" ? "resume" : "pause";
                                                page.syncCommand(modelData.id, op);
                                            }
                                        }
                                        Btn {
                                            compact: true
                                            icon: "folder-open"
                                            text: "Open folder"
                                            tip: "Show in Windows Explorer"
                                            onClicked: Qt.openUrlExternally(page.localUrl(modelData.local))
                                        }
                                        Btn {
                                            compact: true
                                            kind: "danger"
                                            icon: "trash"
                                            text: "Stop syncing"
                                            onClicked: stopSyncDlg.askStop(modelData)
                                        }
                                    }
                                }
                                Rectangle {
                                    visible: modelData.state === "paused" && (modelData.reason === "root_unreadable" || modelData.reason === "drive_folder_missing")
                                    Layout.fillWidth: true
                                    color: Theme.alpha(Theme.gold, 0.12)
                                    border.width: 1
                                    border.color: Theme.gold
                                    implicitHeight: unreadableCol.implicitHeight + 16
                                    ColumnLayout {
                                        id: unreadableCol
                                        anchors { fill: parent; margins: 8; leftMargin: 12; rightMargin: 12 }
                                        RowLayout {
                                            spacing: 8
                                            Icon { name: "alert-triangle"; size: 14; color: Theme.gold }
                                            Text {
                                                text: modelData.reason === "root_unreadable"
                                                    ? "This folder on your PC cannot be found or read. Check that the folder exists and permissions allow access."
                                                    : "The paired Drive folder is missing on the server."
                                                color: Theme.fg
                                                font.family: Theme.mono
                                                font.pixelSize: 13
                                                wrapMode: Text.Wrap
                                                Layout.fillWidth: true
                                            }
                                        }
                                    }
                                }
                                Rectangle {
                                    visible: modelData.state === "paused" && modelData.reason === "mass_delete"
                                    Layout.fillWidth: true
                                    color: Theme.alpha(Theme.accent, 0.12)
                                    border.width: 1
                                    border.color: Theme.accent
                                    implicitHeight: massDelCol.implicitHeight + 20
                                    ColumnLayout {
                                        id: massDelCol
                                        anchors { fill: parent; margins: 10; leftMargin: 12; rightMargin: 12 }
                                        spacing: 8
                                        RowLayout {
                                            spacing: 8
                                            Icon { name: "bell"; size: 14; color: Theme.accent }
                                            Text {
                                                text: modelData.delete_count > 0
                                                    ? modelData.delete_count + " files were deleted from " + modelData.delete_side + ". Delete them on the other side too?"
                                                    : "Folders were deleted from " + modelData.delete_side + ". Delete them on the other side too?"
                                                color: Theme.fg
                                                font.family: Theme.mono
                                                font.pixelSize: 13
                                                font.weight: Font.DemiBold
                                                wrapMode: Text.Wrap
                                                Layout.fillWidth: true
                                            }
                                        }
                                        Text {
                                            visible: page.syncCommands[modelData.id] === "waiting"
                                            text: "Waiting for the current sync to finish?"
                                            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                                        }
                                        RowLayout {
                                            spacing: 8
                                            Btn {
                                                kind: "danger"
                                                compact: true
                                                text: "Delete them"
                                                enabled: !page.syncCommands[modelData.id]
                                                onClicked: page.syncCommand(modelData.id, "confirm")
                                            }
                                            Btn {
                                                kind: "primary"
                                                compact: true
                                                text: "Put them back"
                                                enabled: !page.syncCommands[modelData.id]
                                                onClicked: page.syncCommand(modelData.id, "keep")
                                            }
                                        }
                                    }
                                }
                                ColumnLayout {
                                    visible: !!(modelData.errors && modelData.errors.length)
                                    Layout.fillWidth: true
                                    spacing: 6
                                    RowLayout {
                                        spacing: 6
                                        Btn {
                                            compact: true
                                            kind: "subtle"
                                            icon: syncCard.errorsExpanded ? "up" : "down"
                                            text: (syncCard.errorsExpanded ? "Hide " : "Show ") + modelData.errors.length + (modelData.errors.length === 1 ? " error" : " errors")
                                            onClicked: page.expandedSyncErrors = Object.assign({}, page.expandedSyncErrors, { [syncCard.modelData.id]: !syncCard.errorsExpanded })
                                        }
                                    }
                                    ColumnLayout {
                                        visible: syncCard.errorsExpanded
                                        Layout.fillWidth: true
                                        spacing: 4
                                        Repeater {
                                            model: modelData.errors || []
                                            Rectangle {
                                                required property var modelData
                                                Layout.fillWidth: true
                                                color: Theme.surface2
                                                border.color: Theme.border
                                                implicitHeight: errRow.implicitHeight + 10
                                                RowLayout {
                                                    id: errRow
                                                    anchors { fill: parent; margins: 6; leftMargin: 10; rightMargin: 10 }
                                                    spacing: 8
                                                    Text {
                                                        text: modelData.path
                                                        color: Theme.fg
                                                        font.family: Theme.mono
                                                        font.pixelSize: 12
                                                        elide: Text.ElideMiddle
                                                        Layout.preferredWidth: 260
                                                    }
                                                    Text { text: "·"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12 }
                                                    Text {
                                                        text: modelData.error
                                                        color: Theme.accent
                                                        font.family: Theme.mono
                                                        font.pixelSize: 12
                                                        wrapMode: Text.Wrap
                                                        Layout.fillWidth: true
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
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
                            DropArea {
                                id: courseDrop
                                anchors.fill: parent
                                keys: ["hg-drive"]
                                onEntered: d => { if (!ghost.item || ghost.item.table !== "files") d.accepted = false; }
                                onDropped: d => { if (ghost.item) page.moveTo(ghost.item.row, ct.modelData.id); }
                            }
                            Rectangle { anchors.fill: parent; visible: courseDrop.containsDrag; color: Theme.alpha(ct.modelData.color, 0.18); border.width: 2; border.color: ct.modelData.color }
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

                // Details: column headings; a click sorts by that column (again: the other way).
                RowLayout {
                    visible: look.view === "details" && page.items.length > 0
                    Layout.fillWidth: true
                    Layout.bottomMargin: -12
                    spacing: 12
                    Item { width: 40 }
                    Heading { Layout.fillWidth: true; key: "name"; label: "NAME" }
                    Heading { Layout.preferredWidth: 190; key: "date"; label: "MODIFIED" }
                    Heading { Layout.preferredWidth: 110; key: "type"; label: "TYPE" }
                    Heading { Layout.preferredWidth: 80; key: "size"; label: "SIZE"; horizontalAlignment: Text.AlignRight }
                    Item { width: 34 }
                }
                // Icons and gallery: sort with a menu-less row of choices.
                Row {
                    visible: look.view !== "details" && page.items.length > 1
                    spacing: 14
                    Text { text: "SORT"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1 }
                    Repeater {
                        model: [["name", "Name"], ["date", "Modified"], ["type", "Type"], ["size", "Size"]]
                        Text {
                            required property var modelData
                            text: modelData[1] + (look.sortBy === modelData[0] ? (look.sortDesc ? " ↓" : " ↑") : "")
                            color: look.sortBy === modelData[0] ? Theme.fg : Theme.muted
                            font.family: Theme.mono; font.pixelSize: 12
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.sortOn(parent.modelData[0]) }
                        }
                    }
                }

                // Folders, then files, in the chosen view.
                Flow {
                    id: grid
                    Layout.fillWidth: true
                    spacing: look.view === "details" ? 0 : 12
                    // Gallery: as many columns of about 220 px as fit.
                    readonly property int cols: Math.max(2, Math.floor((width + spacing) / 232))
                    readonly property real cell: (width - (cols - 1) * spacing) / cols
                    Repeater {
                    model: page.items
                    Rectangle {
                        id: item
                        required property var modelData
                        readonly property bool isFolder: modelData.table === "folders"
                        readonly property var f: modelData.row
                        readonly property bool isBreak: modelData.table === "break"
                        readonly property bool media: !isFolder && !isBreak && (page.isImage(f) || page.isVideo(f))
                        clip: isBreak
                        width: isBreak || look.view === "details" ? grid.width : look.view === "icons" ? 132 : grid.cell
                        // In the gallery a folder is a slim tile; files get the pictures.
                        height: isBreak ? 1 : look.view === "details" ? 48 : look.view === "icons" ? 132 : isFolder ? 52 : Math.round(grid.cell * 0.75) + 36
                        color: isBreak ? "transparent" : im.containsMouse ? Theme.surface2 : look.view === "details" ? "transparent" : Theme.surface
                        border.width: isBreak || look.view === "details" ? 0 : 1
                        border.color: im.containsMouse && look.view !== "details" ? Theme.faint : Theme.border
                        Rectangle { visible: look.view === "details"; anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                        MouseArea {
                            id: im
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: drag.active ? Qt.ClosedHandCursor : Qt.PointingHandCursor
                            acceptedButtons: Qt.LeftButton | Qt.RightButton
                            // Drag it onto a folder to move it there.
                            drag.target: ghost
                            drag.threshold: 10
                            property bool dragging: drag.active
                            onPressed: e => { const p = im.mapToItem(page, e.x, e.y); ghost.x = p.x; ghost.y = p.y; ghost.pending = item.modelData; }
                            onDraggingChanged: dragging ? ghost.begin() : ghost.end()
                            onCanceled: ghost.cancel()
                            onClicked: e => {
                                if (e.button === Qt.RightButton) { page.openMenu(item.modelData, im, e.x, e.y); return; }
                                if (item.isFolder) page.go(item.f.id, "");
                                else if (page.isImage(item.f) || page.isVideo(item.f)) preview.show(item.f);
                                else page.openFile(item.f);
                            }
                            onDoubleClicked: if (!item.isFolder) page.openFile(item.f)
                        }
                        readonly property string when: item.f.updated_at ? Util.shortDate(Util.dayOf(item.f.updated_at)) + " " + Util.clock(item.f.updated_at) : ""
                        readonly property string shareTip: "Anyone with the link can " + (page.shares[item.f.id] && page.shares[item.f.id].access === "download" ? "view and download" : "view")

                        // Details: a row with columns.
                        RowLayout {
                            visible: look.view === "details" && !item.isBreak
                            anchors { fill: parent; leftMargin: 6; rightMargin: 4 }
                            spacing: 12
                            // A small picture for images, else an icon.
                            Item {
                                width: 34; height: 34
                                Image {
                                    id: thumbImg
                                    anchors.fill: parent
                                    visible: item.media && look.view === "details"
                                    source: visible ? page.thumb(item.f) : ""
                                    sourceSize: Qt.size(72, 72)
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                }
                                Icon {
                                    anchors.centerIn: parent
                                    visible: item.isFolder || thumbImg.status !== Image.Ready
                                    name: item.isFolder ? "folder" : page.kindIcon(item.f); size: 16
                                    color: item.isFolder ? Theme.accent : Theme.muted
                                }
                            }
                            Text { Layout.fillWidth: true; text: item.f.name; color: Theme.fg; elide: Text.ElideMiddle; font.family: Theme.mono; font.pixelSize: 14 }
                            Icon { visible: item.isFolder && page.isFolderSynced(item.f.id); name: "sync"; size: 13; color: Theme.teal; ToolTip.visible: syncHover.hovered; ToolTip.text: "Synced to this PC"; HoverHandler { id: syncHover } }
                            Icon { visible: !!page.shares[item.f.id]; name: "link"; size: 13; color: Theme.teal; ToolTip.visible: shareHover.hovered; ToolTip.text: item.shareTip; HoverHandler { id: shareHover } }
                            Text { Layout.preferredWidth: 190; text: item.when; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
                            Text { Layout.preferredWidth: 110; text: page.typeOf(item.f, item.isFolder); color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
                            Text {
                                Layout.preferredWidth: 80
                                horizontalAlignment: Text.AlignRight
                                text: item.isFolder ? item.f.items + (item.f.items === 1 ? " item" : " items") : page.size(item.f.size)
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                            }
                            Btn { id: more; compact: true; kind: "subtle"; text: "⋯"; tip: "More"; onClicked: page.openMenu(item.modelData, more, 0, more.height) }
                        }

                        // Icons: a big icon (or the picture) with the name under it, like Windows.
                        Item {
                            visible: look.view === "icons" && !item.isBreak
                            anchors.fill: parent
                            Item {
                                id: iconBox
                                width: 72; height: 72
                                anchors.horizontalCenter: parent.horizontalCenter
                                y: 12
                                Image {
                                    id: iconImg
                                    anchors.fill: parent
                                    visible: item.media && look.view === "icons"
                                    source: visible ? page.thumb(item.f) : ""
                                    sourceSize: Qt.size(144, 144)
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                }
                                Icon {
                                    anchors.centerIn: parent
                                    visible: !iconImg.visible || iconImg.status !== Image.Ready
                                    name: item.isFolder ? "folder" : page.kindIcon(item.f); size: 44
                                    color: item.isFolder ? Theme.accent : Theme.muted
                                }
                                // A video's picture says it plays.
                                Icon { anchors.centerIn: parent; visible: !item.isFolder && page.isVideo(item.f) && iconImg.status === Image.Ready; name: "play"; size: 18; color: "white"; style: Text.Outline; styleColor: "#80000000" }
                            }
                            Text {
                                anchors { left: parent.left; right: parent.right; top: iconBox.bottom; topMargin: 8; leftMargin: 8; rightMargin: 8 }
                                text: item.f.name
                                horizontalAlignment: Text.AlignHCenter
                                wrapMode: Text.WrapAnywhere
                                maximumLineCount: 2
                                elide: Text.ElideRight
                                color: Theme.fg; font.family: Theme.mono; font.pixelSize: 12
                            }
                            Icon { visible: item.isFolder && page.isFolderSynced(item.f.id); anchors { top: parent.top; right: parent.right; margins: 8 } name: "sync"; size: 12; color: Theme.teal }
                            Icon { visible: !!page.shares[item.f.id]; anchors { top: parent.top; left: parent.left; margins: 8 } name: "link"; size: 12; color: Theme.teal }
                        }

                        // Gallery: the picture fills the tile, the name below it.
                        Item {
                            visible: look.view === "gallery" && !item.isBreak
                            anchors.fill: parent
                            anchors.margins: 1
                            Rectangle {
                                id: galleryArt
                                visible: !item.isFolder
                                width: parent.width; height: parent.height - 35
                                color: Theme.bg
                                clip: true
                                // The server's big (480 px) preview: nothing is downloaded.
                                Image {
                                    id: galleryImg
                                    anchors.fill: parent
                                    visible: item.media && look.view === "gallery"
                                    source: visible ? page.thumb(item.f) + "&size=big" : ""
                                    sourceSize: Qt.size(480, 480)
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                    opacity: status === Image.Ready ? 1 : 0
                                    Behavior on opacity { NumberAnimation { duration: 180 } }
                                }
                                Icon {
                                    anchors.centerIn: parent
                                    visible: !galleryImg.visible || galleryImg.status !== Image.Ready
                                    name: item.isFolder ? "folder" : page.kindIcon(item.f); size: 48
                                    color: item.isFolder ? Theme.accent : Theme.faint
                                }
                                Icon { anchors.centerIn: parent; visible: !item.isFolder && page.isVideo(item.f) && galleryImg.status === Image.Ready; name: "play"; size: 28; color: "white"; style: Text.Outline; styleColor: "#80000000" }
                            }
                            RowLayout {
                                anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 10; rightMargin: 4 }
                                height: item.isFolder ? parent.height : 34
                                spacing: 8
                                Icon { visible: item.isFolder; name: "folder"; size: 16; color: Theme.accent }
                                Icon { visible: item.isFolder && page.isFolderSynced(item.f.id); name: "sync"; size: 12; color: Theme.teal; ToolTip.visible: syncHoverG.hovered; ToolTip.text: "Synced to this PC"; HoverHandler { id: syncHoverG } }
                                Icon { visible: !!page.shares[item.f.id]; name: "link"; size: 12; color: Theme.teal }
                                Text { Layout.fillWidth: true; text: item.f.name; elide: Text.ElideMiddle; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13 }
                                Btn { id: moreG; compact: true; kind: "subtle"; text: "⋯"; tip: "More"; onClicked: page.openMenu(item.modelData, moreG, 0, moreG.height) }
                            }
                        }
                        // A folder takes what is dragged onto it, and files dropped from the computer.
                        DropTarget { anchors.fill: parent; folderId: item.f.id; visible: item.isFolder; exclude: item.f.id }
                    }
                }
                }
                Text {
                    visible: page.drive.files.length > 0
                    text: "Click a picture or video to preview it, anything else opens in its app. Edits you save there are uploaded again by themselves."
                    Layout.fillWidth: true
                    wrapMode: Text.Wrap
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
                }
            }
        }
    }

    // Drop files anywhere on the page to upload them here.
    DropArea {
        id: drop
        anchors.fill: parent
        z: -1
        keys: ["text/uri-list"]
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
        function show(file) { player.stop(); player.source = ""; f = file; if (video) { player.source = page.src(file); player.play(); } forceActiveFocus(); }
        function hide() { player.stop(); player.source = ""; f = null; }
        // The pictures and videos here, in the order shown: the arrows go through them.
        readonly property var all: page.items.filter(x => x.table === "files" && (page.isImage(x.row) || page.isVideo(x.row))).map(x => x.row)
        readonly property int at: f ? all.findIndex(x => x.id === f.id) : -1
        function step(by) { if (all.length > 1 && at >= 0) show(all[(at + by + all.length) % all.length]); }
        Keys.onEscapePressed: hide()
        Keys.onLeftPressed: step(-1)
        Keys.onRightPressed: step(1)
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
        // Previous and next (or the Left and Right keys).
        Repeater {
            model: preview.all.length > 1 ? [-1, 1] : []
            Rectangle {
                required property int modelData
                anchors.verticalCenter: parent.verticalCenter
                x: modelData < 0 ? 12 : preview.width - width - 12
                width: 44; height: 64
                color: arrowMouse.containsMouse ? Qt.rgba(1, 1, 1, 0.16) : Qt.rgba(1, 1, 1, 0.06)
                Icon { anchors.centerIn: parent; name: parent.modelData < 0 ? "left" : "right"; size: 18; color: "white" }
                MouseArea { id: arrowMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: preview.step(parent.modelData) }
            }
        }
        RowLayout {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 24 }
            spacing: 10
            Text { Layout.fillWidth: true; text: preview.f ? preview.f.name + "   " + page.size(preview.f.size) + (preview.all.length > 1 ? "   ·   " + (preview.at + 1) + " of " + preview.all.length : "") : ""; color: "white"; elide: Text.ElideMiddle; font.family: Theme.mono; font.pixelSize: 15 }
            Btn { text: "Open in its app"; icon: "folder-open"; onClicked: { const f = preview.f; preview.hide(); page.openFile(f); } }
            Btn { text: "Close"; icon: "close"; onClicked: preview.hide() }
        }
    }
}
