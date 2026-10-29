import QtQuick
import QtTest
import Hourglass

TestCase {
    id: test
    name: "FolderSync"
    width: 1000
    height: 700
    visible: true
    when: windowShown
    property var response: null
    property string testBase: "http://127.0.0.1:0" // replaced by test-sync-ui.mjs
    QtObject {
        id: appStub
        property var courses: []
        property bool visible: true
        function showToast(message) {}
    }
    readonly property var page: pageLoader.item
    Loader {
        id: pageLoader
        anchors.fill: parent
        active: false
        sourceComponent: DrivePage { app: appStub; visible: false }
    }

    function request(path, body) {
        response = null;
        Api.request(body ? "POST" : "GET", path, body || null, function(data) { test.response = data; }, true);
        tryVerify(() => response !== null);
        return response;
    }
    function initTestCase() {
        Api.base = testBase;
        pageLoader.active = true;
        tryVerify(() => pageLoader.item !== null);
    }
    function init() {
        page.visible = false;
        appStub.visible = true;
        page.syncCommands = ({});
        page.expandedSyncErrors = ({});
        request("/test/reset", {});
    }
    function cleanup() { page.driveFolderPicker.close(); page.visible = false; }
    function withText(root, text) {
        if (root.text === text) return root;
        for (const child of root.children || []) {
            const found = withText(child, text);
            if (found) return found;
        }
        return null;
    }

    function test_1_paths() {
        compare(page.localPath("file:///C:/Temp/Studio%20%23100%25"), "C:\\Temp\\Studio #100%");
        compare(page.localPath("C:\\Temp\\Studio #100%"), "C:\\Temp\\Studio #100%");
        compare(page.localUrl("C:\\Temp\\Studio #100%"), "file:///C:/Temp/Studio%20%23100%25");
        compare(page.localPath("file://server/share/Studio%20%25"), "\\\\server\\share\\Studio %");
        compare(page.localUrl("\\\\server\\share\\Studio %"), "file://server/share/Studio%20%25");
    }
    function test_2_picker_requests() {
        page.visible = true;
        tryVerify(() => page.allFolders.length > 0);
        page.driveFolderPicker.ask("C:\\Temp\\Studio #100%");
        page.driveFolderPicker.selectedFolderId = "existing";
        page.driveFolderPicker.mode = "existing";
        page.driveFolderPicker.submit();
        page.driveFolderPicker.submit(); // held request must block double clicks
        tryVerify(() => !page.driveFolderPicker.submitting);
        let posted = request("/test/inspect").posted;
        compare(posted.length, 1);
        compare(posted[0].local, "C:\\Temp\\Studio #100%");
        compare(posted[0].folder_id, "existing");
        page.driveFolderPicker.ask("C:\\Temp\\Studio #100%");
        page.driveFolderPicker.mode = "new";
        page.driveFolderPicker.parentFolderId = "parent";
        page.driveFolderPicker.submit();
        tryVerify(() => !page.driveFolderPicker.submitting);
        posted = request("/test/inspect").posted;
        compare(posted.length, 2);
        compare(posted[1].folder_name, "Studio #100%");
        compare(posted[1].parent_id, "parent");
        verify(!posted[1].folder_id);
    }
    function test_3_queued_resolution_and_visibility() {
        page.visible = true;
        tryVerify(() => page.syncFolders.length === 1);
        tryVerify(() => withText(page, "Show 1 error") !== null);
        mouseClick(withText(page, "Show 1 error"));
        tryVerify(() => withText(page, "Test error").visible);
        page.syncCommand("pair", "confirm");
        page.syncCommand("pair", "keep"); // cannot change a queued choice
        tryCompare(page, "syncCommands", { pair: "waiting" });
        appStub.visible = false; // the Drive tab can still be selected in a hidden window
        wait(100); // drain an already issued GET
        const reads = request("/test/inspect").reads;
        wait(3300);
        compare(request("/test/inspect").reads, reads);
        appStub.visible = true;
        wait(17300); // the original 20-second polling limit must not return
        compare(page.syncCommands.pair, "waiting");
        verify(page.expandedSyncErrors.pair);
        verify(withText(page, "Test error").visible);
        tryVerify(() => !page.syncCommands.pair, 7000);
        verify(page.syncFolders[0].state !== "paused");
        const status = request("/test/inspect");
        compare(status.commands.length, 1);
        compare(status.commands[0], "confirm");
        verify(status.reads > reads + 3);
    }
}
