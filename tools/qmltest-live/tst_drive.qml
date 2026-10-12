// The desktop Drive page against a running dev stack (never the real service):
// drag a file onto a folder, a folder into a folder, make a share link.
// Needs devstack.js next to it (not committed):
//   .pragma library
//   var base = "http://127.0.0.1:<dev sidecar port>"; var token = "<its token>";
//   windows/qt/bin/qmltestrunner.exe -import windows/app -input tools/qmltest-live
import QtQuick
import QtTest
import Hourglass
import "devstack.js" as Dev

Item {
    id: root
    width: 1100; height: 760
    QtObject {
        id: fakeApp
        property var courses: []
        property var toasts: []
        function showToast(m) { toasts.push(m); }
        function confirm(a, b, c, f) { f(); }
    }
    Component { id: pageC; DrivePage { app: fakeApp; anchors.fill: parent } }
    property var page: null

    function find(item, text) {
        if (!item) return null;
        if (item.text === text && item.visible) return item;
        for (let i = 0; i < item.children.length; i++) { const f = find(item.children[i], text); if (f) return f; }
        if (item.contentItem && item.contentItem !== item) { const f = find(item.contentItem, text); if (f) return f; }
        return null;
    }
    function rowOf(t) { let r = t; while (r && !(r.modelData && r.modelData.row)) r = r.parent; return r; }
    function call(name, args) {
        const x = new XMLHttpRequest();
        x.open("POST", Dev.base + "/api/actions/" + name, false);
        x.setRequestHeader("Authorization", "Bearer " + Dev.token);
        x.setRequestHeader("Content-Type", "application/json");
        x.send(JSON.stringify(args || {}));
        return JSON.parse(x.responseText);
    }

    TestCase {
        name: "Drive"
        when: windowShown
        function initTestCase() {
            Api.base = Dev.base;
            Api.token = Dev.token;
            // Start from the same place every run: everything at the top.
            const all = root.call("search", { query: "readme" }).files;
            for (const f of all) root.call("move_file", { file_id: f.file_id, folder_id: null });
            for (const f of root.call("search", { query: "lab reports" }).folders) root.call("move_folder", { folder_id: f.folder_id, parent_id: null });
            root.page = pageC.createObject(root);
            tryVerify(() => !!root.find(root.page, "readme.txt"), 5000);
        }

        function test_drag_a_file_onto_a_folder() {
            const file = root.rowOf(root.find(root.page, "readme.txt"));
            const folder = root.rowOf(root.find(root.page, "Photos"));
            verify(file && folder, "rows found");
            const a = file.mapToItem(root, 60, file.height / 2);
            const b = folder.mapToItem(root, 120, folder.height / 2);
            mousePress(root, a.x, a.y);
            for (let k = 1; k <= 12; k++) { mouseMove(root, a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12); wait(15); }
            mouseRelease(root, b.x, b.y);
            const photos = root.call("list_drive", {}).folders.find(f => f.name === "Photos");
            tryVerify(() => root.call("list_drive", { folder_id: photos.id }).files.some(f => f.name === "readme.txt"), 3000, "readme.txt moved into Photos");
        }

        function test_drag_a_folder_into_a_folder() {

            wait(200);
            tryVerify(() => !!root.find(root.page, "Lab reports"), 3000);
            const src = root.rowOf(root.find(root.page, "Lab reports"));
            const dst = root.rowOf(root.find(root.page, "Photos"));
            const a = src.mapToItem(root, 60, src.height / 2);
            const b = dst.mapToItem(root, 120, dst.height / 2);
            mousePress(root, a.x, a.y);
            for (let k = 1; k <= 12; k++) { mouseMove(root, a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12); wait(15); }
            mouseRelease(root, b.x, b.y);
            wait(500);
            const photos = root.call("list_drive", {}).folders.find(f => f.name === "Photos");
            tryVerify(() => root.call("list_drive", { folder_id: photos.id }).folders.some(f => f.name === "Lab reports"), 3000, "Lab reports moved into Photos");
        }

        function test_share_dialog_makes_a_link() {
            const photos = root.call("list_drive", {}).folders.find(f => f.name === "Photos");
            const dlg = findChild(root.page, "shareDialog");
            verify(dlg);
            dlg.ask({ table: "folders", row: photos });
            dlg.access = "download";
            dlg.make();
            tryVerify(() => !!dlg.link, 4000, "link made");
            verify(/\/drive\/[A-Za-z0-9_-]{22}$/.test(dlg.link.url), dlg.link.url);
            compare(dlg.link.access, "download");
            wait(300);
            wait(200);
        }
    }
}
