// The assistant's model chip against a local dev server (never the real service):
// the chip lists the current AI's models, one click switches the model and
// keeps the AI, and "Change AI…" opens the provider dialog without a model list.
// Needs devstack.js next to it (not committed), pointing at server/server.js run
// with HOURGLASS_ASSISTANT=on and the fake opencode/claude from server/test:
//   windows/qt/bin/qmltestrunner.exe -import windows/app -input tools/qmltest-live/tst_assistant_models.qml
import QtQuick
import QtTest
import Hourglass
import "devstack.js" as Dev

Item {
    id: root
    width: 1100; height: 760
    QtObject {
        id: fakeApp
        property int page: 0
        property var courses: []
        function showToast(m) {}
        function confirm(a, b, c, f) { f(); }
    }
    Component { id: pageC; AssistantPage { app: fakeApp; anchors.fill: parent } }
    property var page: null

    function find(item, test) {
        if (!item) return null;
        if (item.visible && item.text !== undefined && test(String(item.text))) return item;
        for (let i = 0; i < item.children.length; i++) { const f = find(item.children[i], test); if (f) return f; }
        return null;
    }
    function api(method, path, body) {
        const x = new XMLHttpRequest();
        x.open(method, Dev.base + path, false);
        x.setRequestHeader("Authorization", "Bearer " + Dev.token);
        x.setRequestHeader("Content-Type", "application/json");
        x.send(body ? JSON.stringify(body) : null);
        return JSON.parse(x.responseText);
    }
    function shot(name) {
        const img = tc.grabImage(root.Window.contentItem);
        img.save(Dev.shots + "/" + name + ".png");
    }

    TestCase {
        id: tc
        name: "AssistantModels"
        when: windowShown
        function initTestCase() {
            Api.base = Dev.base;
            Api.token = Dev.token;
            root.api("POST", "/api/assistant/settings", { engine: "claude" });
            root.page = pageC.createObject(root);
            tryVerify(() => root.find(root, t => t.indexOf("Claude plan ·") === 0), 10000, "chip shows the Claude plan");
        }

        function test_1_pick_a_model() {
            const chip = root.find(root, t => t.indexOf("Claude plan ·") === 0);
            mouseClick(chip.parent);
            tryVerify(() => root.page.modelChoices.length > 1, 10000, "the menu lists Claude's models");
            const before = root.api("GET", "/api/assistant/settings");
            const other = root.page.modelChoices.find(m => m.id !== before.model);
            const row = root.find(root.Window.contentItem, t => t.indexOf(other.name || other.id) === 0);
            verify(row, "a row for " + other.id);
            wait(300);
            root.shot("1-model-menu");
            mouseClick(row.parent);
            tryVerify(() => root.api("GET", "/api/assistant/settings").model === other.id, 10000, "the model was saved");
            const after = root.api("GET", "/api/assistant/settings");
            compare(after.engine, "claude", "the AI stayed the same");
            const shortName = other.id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^./, c => c.toUpperCase());
            tryVerify(() => root.find(root, t => t.indexOf("Claude plan · " + shortName) === 0), 10000, "the chip shows " + shortName);
            wait(300);
            root.shot("2-after-pick");
        }

        function test_2_change_ai_opens_provider_dialog() {
            const chip = root.find(root, t => t.indexOf("Claude plan ·") === 0);
            mouseClick(chip.parent);
            tryVerify(() => root.page.modelChoices.length > 1, 10000);
            const change = root.find(root.Window.contentItem, t => t === "Change AI…");
            verify(change, "Change AI… button");
            mouseClick(change);
            tryVerify(() => root.find(root.Window.contentItem, t => t === "Assistant AI"), 5000, "the provider dialog opened");
            wait(500);
            verify(!root.find(root.Window.contentItem, t => t === "MODEL"), "no model list in the provider dialog");
            root.shot("3-change-ai");
        }
    }
}
