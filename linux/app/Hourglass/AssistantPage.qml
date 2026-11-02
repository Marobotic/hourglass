import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs

// Talk to Hourglass: the assistant runs on the server and works on this
// account's notes, schedule, alarms and timers through the same tools any AI
// uses. While it works, each tool it uses shows as a line ("Set an alarm");
// when it is done, the app syncs so the change is already here.
// Common requests (an alarm, a timer, a birthday) come back at once: the
// server answers those itself. Pictures and files attach with the paperclip
// or by dropping them here; they are saved in the Drive's "Assistant" folder.
Item {
    id: page
    property var app
    property var chat: ({ enabled: true, busy: false, messages: [] })
    property string pending: ""      // sent, not in the list yet
    property bool sending: false
    property bool wasBusy: false
    property bool showSteps: false   // thinking details are collapsed until opened
    property var openSteps: ({})     // finished messages whose steps are shown, by id
    property var openTools: ({})
    property string statusWord: "Simmering"
    property string statusTurn: ""
    property var turnWords: ({})
    property string mode: "auto"
    property var driveItems: []
    property string driveFolder: ""
    property string driveCourse: ""
    property string chatJson: ""     // what `chat` was made from: a poll that changed nothing rebuilds nothing
    property var attachments: []     // [{ key, name, mime, id?, error? }] waiting to be sent
    property var info: null          // { thumb_base, key }: previews of attached pictures
    readonly property bool uploading: attachments.some(a => !a.id && !a.error)

    readonly property bool busy: sending || chat.busy || pending !== ""
    // The second "Working 12 s" counts with: the app's clock only moves on the
    // minute unless a timer is running, and this one has to count while it works.
    property double now: Date.now()
    readonly property var messages: {
        const list = (chat.messages || []).slice();
        if (pending !== "" && !list.some(m => m.role === "user" && m.text === pending))
            list.push({ id: "pending", role: "user", text: pending, tools: [] });
        return list;
    }

    // The list shows msgModel, kept in step with `messages` one row at a time:
    // a new message is inserted, a changed one updated in place, so a send or a
    // poll never rebuilds the whole list (which made it jump up and back down).
    // Newest first: the list runs bottom to top.
    ListModel { id: msgModel }
    onMessagesChanged: syncModel()
    property var seen: ({})          // messages already shown once (they don't rise in again)
    property bool ready: false       // the first load is on screen: later messages animate in
    function syncModel() {
        const currentTurn = page.chat.busy && page.chat.messages && page.chat.messages.length ? page.chat.messages[page.chat.messages.length - 1].id : "";
        if (currentTurn && currentTurn !== page.statusTurn) { page.statusTurn = currentTurn; page.pickStatusWord(); const words = Object.assign({}, page.turnWords); words[currentTurn] = page.statusWord; page.turnWords = words; }
        const want = page.messages.slice().reverse();
        const ids = want.map(m => m.id);
        // The message shown while sending becomes the real one when it arrives: same row.
        for (let i = 0; i < msgModel.count; i++) {
            if (msgModel.get(i).mid !== "pending" || ids.indexOf("pending") >= 0) continue;
            const pendingText = JSON.parse(msgModel.get(i).json).text;
            const real = want.find(m => m.role === "user" && m.text === pendingText);
            if (real && !rowOf(real.id)) msgModel.setProperty(i, "mid", real.id);
        }
        for (let i = msgModel.count - 1; i >= 0; i--) if (ids.indexOf(msgModel.get(i).mid) < 0) msgModel.remove(i);
        for (let i = 0; i < want.length; i++) {
            const json = JSON.stringify(want[i]);
            const at = indexOf(want[i].id);
            if (at === i) { if (msgModel.get(i).json !== json) msgModel.setProperty(i, "json", json); continue; }
            if (at > i) { msgModel.move(at, i, 1); if (msgModel.get(i).json !== json) msgModel.setProperty(i, "json", json); continue; }
            msgModel.insert(i, { mid: want[i].id, json: json });
        }
    }
    function indexOf(id) { for (let i = 0; i < msgModel.count; i++) if (msgModel.get(i).mid === id) return i; return -1; }
    function rowOf(id) { return indexOf(id) >= 0; }

    readonly property var statusWords: ["Simmering", "Tinkering", "Brewing", "Noodling", "Untangling", "Percolating", "Sketching", "Whittling", "Stirring", "Kneading", "Shaping", "Plotting", "Puzzling", "Polishing", "Wiring", "Weaving", "Mapping", "Mulling", "Sorting", "Mending", "Carving", "Measuring", "Sifting", "Riffing", "Fiddling", "Spinning", "Folding", "Juggling", "Tuning", "Tracing", "Layering", "Patching", "Marinating", "Hatching", "Shuffling", "Knitting", "Chiseling", "Doodling", "Arranging", "Mosaicking"]
    function pickStatusWord() {
        let i = Math.floor(Math.random() * statusWords.length);
        if (statusWords[i] === statusWord) i = (i + 1) % statusWords.length;
        statusWord = statusWords[i];
    }
    function pastStatusWord(word) {
        const pairs = { Simmering:"Simmered", Tinkering:"Tinkered", Brewing:"Brewed", Noodling:"Noodled", Untangling:"Untangled", Percolating:"Percolated", Sketching:"Sketched", Whittling:"Whittled", Stirring:"Stirred", Kneading:"Kneaded", Shaping:"Shaped", Plotting:"Plotted", Puzzling:"Puzzled", Polishing:"Polished", Wiring:"Wired", Weaving:"Wove", Mapping:"Mapped", Mulling:"Mulled", Sorting:"Sorted", Mending:"Mended", Carving:"Carved", Measuring:"Measured", Sifting:"Sifted", Riffing:"Riffed", Fiddling:"Fiddled", Spinning:"Spun", Folding:"Folded", Juggling:"Juggled", Tuning:"Tuned", Tracing:"Traced", Layering:"Layered", Patching:"Patched", Marinating:"Marinated", Hatching:"Hatched", Shuffling:"Shuffled", Knitting:"Knitted", Chiseling:"Chiseled", Doodling:"Doodled", Arranging:"Arranged", Mosaicking:"Mosaicked" };
        return pairs[word] || word;
    }
    function elapsed(ms) {
        const sec = Math.max(0, Math.floor(ms / 1000));
        return sec >= 60 ? Math.floor(sec / 60) + "m " + (sec % 60) + "s" : sec + "s";
    }
    function thinkingSteps(steps) {
        const thinking = (steps || []).filter(s => /^Thinking:/.test(s.text || ""));
        return thinking.length ? thinking : (steps || []);
    }
    function stepElapsed(steps) {
        if (!steps || steps.length < 2) return "";
        const ms = Math.max(0, steps[steps.length - 1].at - steps[0].at);
        return ms >= 1000 ? " for " + elapsed(ms) : "";
    }
    function toolVerb(tool) {
        const name = String(tool || "").toLowerCase();
        if (/read|get|list/.test(name)) return "Reading";
        if (/search|find/.test(name)) return "Searching";
        if (/edit|write|move|add|update|set|remove|delete|restore/.test(name)) return "Editing";
        return "Running";
    }
    function currentStatus() {
        const list = page.chat.messages || [];
        const current = list.length ? list[list.length - 1] : null;
        const tools = current && current.tools ? current.tools : [];
        const runningTool = [...tools].reverse().find(t => t.status === "running");
        if (runningTool) return page.toolVerb(runningTool.tool) + "…";
        if (current && current.text) return "Writing…";
        return page.statusWord + "…";
    }

    function load() {
        Api.request("GET", "/api/assistant", null, (d, err) => {
            // An older background service has no assistant: it needs a restart.
            if (!d && err === "not found") d = { enabled: false, busy: false, messages: [], reason: "Restart Hourglass to use the assistant: its background service is older than this window." };
            if (!d) return;
            const json = JSON.stringify(d);
            if (json !== page.chatJson) { page.chatJson = json; page.chat = d; }
            if (d.mode && d.mode !== page.mode) page.mode = d.mode;
            if (!page.ready) Qt.callLater(() => page.ready = true);
            if (page.pending !== "" && (d.messages || []).some(m => m.role === "user" && m.text === page.pending)) page.pending = "";
            // Finished: pull what the assistant changed, so every page shows it.
            if (page.wasBusy && !d.busy && page.pending === "") Api.post("/api/sync/now", {});
            page.wasBusy = d.busy || page.pending !== "";
        }, true);
    }

    function sendText(text) {
        const files = page.attachments.filter(a => a.id);
        const kept = page.attachments;
        // With only files, the server says what the message is.
        const t = text.trim() || (files.length ? "(see the attached file" + (files.length > 1 ? "s)" : ")") : "");
        if (!t || page.busy || page.uploading || !page.chat.enabled) return;
        page.pending = t;
        page.sending = true;
        page.wasBusy = true;
        input.text = "";
        page.attachments = [];
        list.stick = true;
        list.positionViewAtBeginning();     // back down to the newest message
        Api.request("POST", "/api/assistant/message", { text: t, files: files.map(a => a.id) }, (d, err) => {
            page.sending = false;
            if (!d) { page.pending = ""; input.text = text; page.attachments = kept; return; }
            page.load();
        }, true);
    }

    // Pictures and files for the next message: uploaded to the Drive's
    // "Assistant" folder now, sent with the message as their ids.
    function attach(urls) {
        if (!urls.length) return;
        const added = [];
        for (const u of urls) {
            const s = u.toString();
            const name = decodeURIComponent(s.split("/").pop());
            const ext = name.split(".").pop().toLowerCase();
            const mime = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) ? "image/" + (ext === "jpg" ? "jpeg" : ext) : "";
            added.push({ key: s + Date.now() + Math.random(), url: s, name: name, mime: mime });
        }
        page.attachments = page.attachments.concat(added);
        Api.request("GET", "/api/assistant/folder", null, (f, err) => {
            for (const a of added) {
                if (!f) { page.setAttachment(a.key, { error: err || "Could not upload" }); continue; }
                Api.request("POST", "/api/files/upload", { path: a.url, folder: f.folder_id }, (row, upErr) => {
                    page.setAttachment(a.key, row ? { id: row.id, mime: row.mime, name: row.name } : { error: upErr || "Could not upload" });
                }, true);
            }
        }, true);
    }
    function loadDrive(folder, course) {
        driveFolder = folder || "";
        driveCourse = course || "";
        const args = driveCourse ? { course_id: driveCourse } : driveFolder ? { folder_id: driveFolder } : {};
        Api.action("list_drive", args, d => {
            if (!d) return;
            driveItems = (d.courses || []).map(c => ({ kind: "course", id: c.id, name: c.name }))
                .concat(d.folders.map(f => ({ kind: "folder", id: f.id, name: f.name })))
                .concat(d.files.map(f => ({ kind: "file", id: f.id, name: f.name, mime: f.mime || "", size: f.size || 0 })));
        });
    }
    function attachDriveFile(file) {
        if (attachments.some(a => a.id === file.id)) return;
        attachments = attachments.concat([{ key: file.id, id: file.id, name: file.name, mime: file.mime || "" }]);
        drivePicker.close();
    }
    function setMode(next) {
        Api.request("POST", "/api/assistant/mode", { mode: next }, d => { if (d) { page.mode = d.mode; modeMenu.close(); page.load(); } }, true);
    }
    function cycleMode() {
        const safe = ["ask", "auto"];
        setMode(safe[(safe.indexOf(page.mode) + 1) % safe.length]);
    }
    function action(id, verb) {
        Api.request("POST", "/api/assistant/actions/" + id + "/" + verb, {}, () => page.load(), true);
    }

    component ActionCard: Rectangle {
        property var info: ({})
        implicitWidth: 340
        implicitHeight: actionCol.implicitHeight + 20
        color: Theme.surface
        border.width: 1
        border.color: info.status === "pending" ? Theme.accent : Theme.border
        ColumnLayout {
            id: actionCol
            anchors { fill: parent; margins: 10 }
            spacing: 6
            Text { Layout.fillWidth: true; text: info.summary || "Action"; color: Theme.fg; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12 }
            RowLayout {
                visible: info.status === "pending"
                Btn { compact: true; kind: "primary"; text: "Apply"; onClicked: page.action(info.id, "apply") }
                Btn { compact: true; kind: "subtle"; text: "Skip"; onClicked: page.action(info.id, "skip") }
            }
            Text { visible: info.status && info.status !== "pending"; text: String(info.status).toUpperCase(); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 10 }
        }
    }

    component FileResultChip: FileChip {
        property var info: ({})
        name: info.label || "Drive file"
        fileId: info.id || ""
        note: (info.state === "read" ? "Read · " : info.state === "created" ? "Created · " : info.state === "deleted" ? "Deleted · " : "Changed · ")
            + (info.size || 0) + " bytes · +" + ((info.diff || {}).added || 0) + " / -" + ((info.diff || {}).removed || 0) + " lines"
        removable: false
        onActivated: if (page.app) page.app.page = 8
    }
    function setAttachment(key, patch) {
        page.attachments = page.attachments.map(a => a.key === key ? Object.assign({}, a, patch) : a);
    }
    function unattach(key) { page.attachments = page.attachments.filter(a => a.key !== key); }

    function stop() { Api.request("POST", "/api/assistant/stop", {}, () => page.load(), true); }
    // "Free · big-pickle", "Claude · Haiku 5.5", "API · gpt-5-mini".
    function engineLabel() {
        const m = String(page.chat.model || "");
        const shortName = m.replace(/^opencode\//, "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^./, c => c.toUpperCase());
        if (page.chat.engine === "anthropic") return "Claude API · " + shortName;
        if (page.chat.engine === "claude") return "Claude plan · " + shortName;
        if (page.chat.engine === "openai") return "API · " + (m || "pick a model");
        return "Free · " + (shortName || "auto");
    }
    function usageCaption(u) {
        if (!u) return "";
        const parts = [];
        if (u.input_tokens !== null || u.output_tokens !== null) parts.push((u.input_tokens || 0) + " in · " + (u.output_tokens || 0) + " out");
        if ((u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) > 0) parts.push(((u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)) + " cached");
        if (u.cost !== null && u.cost !== undefined) parts.push("$" + Number(u.cost).toFixed(4));
        if (u.context_percent !== null && u.context_percent !== undefined) parts.push(Number(u.context_percent).toFixed(1).replace(/\.0$/, "") + "% context");
        return parts.join("  ·  ");
    }
    function newChat() {
        Api.request("POST", "/api/assistant/new", {}, () => { page.pending = ""; page.load(); }, true);
    }

    Component.onCompleted: { load(); Api.get("/api/drive/info", d => { if (d) page.info = d; }); }

    AssistantSettings { id: aiSettings; onSaved: page.load() }

    Popup {
        id: modelMenu
        width: 300; padding: 10
        background: Rectangle { color: Theme.surface; border.color: Theme.border; border.width: 1; radius: 4 }
        ColumnLayout {
            width: parent.width; spacing: 8
            Text { text: "MODEL"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1.2 }
            Text { text: page.engineLabel(); color: Theme.fg; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 13 }
            Btn { Layout.fillWidth: true; text: "Model and provider settings…"; icon: "gear"; onClicked: { modelMenu.close(); aiSettings.open(); } }
        }
    }
    Popup {
        id: modeMenu
        width: 250; padding: 6
        background: Rectangle { color: Theme.surface; border.color: Theme.border; border.width: 1; radius: 4 }
        ColumnLayout {
            width: parent.width; spacing: 2
            Text { Layout.leftMargin: 8; Layout.topMargin: 4; text: "PERMISSIONS · SHIFT+TAB"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
            Repeater {
                model: [{ id: "ask", title: "Ask", note: "Every change waits for approval" }, { id: "auto", title: "Auto", note: "Only risky actions wait" }, { id: "dangerous", title: "Dangerous", note: "Changes apply immediately" }]
                delegate: Rectangle {
                    required property var modelData
                    Layout.fillWidth: true; implicitHeight: 52
                    color: modeHover.containsMouse ? Theme.surface2 : "transparent"
                    Text { anchors { left: parent.left; top: parent.top; leftMargin: 8; topMargin: 5 } text: modelData.title; color: page.mode === modelData.id ? Theme.accent : Theme.fg; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.DemiBold }
                    Text { anchors { left: parent.left; bottom: parent.bottom; leftMargin: 8; bottomMargin: 5 } text: modelData.note; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
                    MouseArea { id: modeHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.setMode(modelData.id) }
                }
            }
        }
    }
    Popup {
        id: drivePicker
        width: Math.min(450, page.width - 40); height: Math.min(520, page.height - 80)
        modal: true; focus: true; closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        onOpened: page.loadDrive("", "")
        background: Rectangle { color: Theme.surface; border.color: Theme.border; border.width: 1 }
        ColumnLayout {
            anchors.fill: parent; anchors.margins: 12; spacing: 8
            RowLayout {
                Layout.fillWidth: true
                Text { Layout.fillWidth: true; text: driveCourse ? "Course Drive" : driveFolder ? "Drive folder" : "Choose a Drive file"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold }
                Btn { compact: true; icon: "close"; onClicked: drivePicker.close() }
            }
            Btn { visible: !!driveFolder || !!driveCourse; text: "← Drive root"; kind: "subtle"; onClicked: page.loadDrive("", "") }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; model: driveItems; spacing: 2
                delegate: Rectangle {
                    required property var modelData
                    width: ListView.view.width; height: 42; color: driveHover.containsMouse ? Theme.surface2 : "transparent"
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: 8; anchors.rightMargin: 8
                        Icon { name: modelData.kind === "folder" || modelData.kind === "course" ? "folder" : "file"; color: Theme.muted }
                        Text { Layout.fillWidth: true; text: modelData.name; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 12 }
                        Text { text: modelData.kind === "file" ? "ATTACH" : "OPEN"; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 10 }
                    }
                    MouseArea { id: driveHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: modelData.kind === "folder" ? page.loadDrive(modelData.id, "") : modelData.kind === "course" ? page.loadDrive("", modelData.id) : page.attachDriveFile(modelData) }
                }
            }
        }
    }

    FileDialog {
        id: attachDialog
        title: "Attach pictures or files"
        fileMode: FileDialog.OpenFiles
        onAccepted: page.attach(selectedFiles)
    }
    // Drop pictures or files anywhere on the page to attach them.
    DropArea {
        id: drop
        anchors.fill: parent
        z: -1
        keys: ["text/uri-list"]
        onEntered: d => { if (d.hasUrls && page.chat.enabled) d.accept(Qt.CopyAction); else d.accepted = false; }
        onDropped: d => { if (!d.hasUrls) return; d.accept(Qt.CopyAction); page.attach(d.urls); }
    }
    Rectangle {
        anchors.fill: parent
        z: 6
        visible: drop.containsDrag
        color: Theme.alpha(Theme.accent, 0.12)
        border.width: 2
        border.color: Theme.accent
        Text { anchors.centerIn: parent; text: "Drop to attach"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
    }

    // A file on a message or waiting to be sent: a small picture or an icon, then its name.
    component FileChip: Rectangle {
        id: chip
        property string name: ""
        property string fileId: ""
        property string mime: ""
        property string note: "" // "Uploading…", an error
        property bool removable: false
        signal remove()
        signal activated()
        readonly property bool picture: /^image\//.test(mime)
        implicitHeight: 40
        implicitWidth: Math.min(280, chipRow.implicitWidth + 16)
        color: Theme.surface2
        border.width: 1
        border.color: note && note !== "Uploading…" ? Theme.accent : Theme.border
        RowLayout {
            id: chipRow
            anchors { left: parent.left; leftMargin: 6; verticalCenter: parent.verticalCenter }
            spacing: 8
            Item {
                width: 28; height: 28
                Image {
                    id: chipThumb
                    anchors.fill: parent
                    visible: chip.picture && chip.fileId !== "" && !!page.info
                    source: visible ? page.info.thumb_base + chip.fileId + "?k=" + page.info.key : ""
                    sourceSize: Qt.size(56, 56)
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                }
                Icon { anchors.centerIn: parent; visible: chipThumb.status !== Image.Ready; name: chip.picture ? "image" : "file"; size: 13; color: Theme.muted }
            }
            ColumnLayout {
                spacing: 0
                Text { text: chip.name; color: Theme.fg; elide: Text.ElideMiddle; Layout.maximumWidth: 190; font.family: Theme.mono; font.pixelSize: 12 }
                Text { visible: chip.note !== ""; text: chip.note; color: chip.note === "Uploading…" ? Theme.muted : Theme.accent; elide: Text.ElideRight; Layout.maximumWidth: 190; font.family: Theme.mono; font.pixelSize: 11 }
            }
            Btn { visible: chip.removable; compact: true; kind: "subtle"; icon: "close"; onClicked: chip.remove() }
        }
        MouseArea { anchors.fill: parent; visible: !!chip.fileId && !chip.removable; cursorShape: Qt.PointingHandCursor; onClicked: chip.activated() }
    }
    onVisibleChanged: if (visible) { load(); input.area.forceActiveFocus(); }
    Timer {
        interval: 900
        running: page.visible && page.busy && Util.shown(page.app)
        repeat: true
        onRunningChanged: if (running) page.now = Date.now()
        onTriggered: { page.now = Date.now(); page.load(); }
    }
    Timer { interval: 15000; running: page.visible && !page.busy && Util.shown(page.app); repeat: true; onTriggered: page.load() }

    ColumnLayout {
        anchors { fill: parent; margins: 28; topMargin: 24 }
        spacing: 14

        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Section { Layout.fillWidth: true; text: "Assistant" }
            Btn { compact: true; icon: "plus"; text: "New chat"; enabled: page.messages.length > 0 && !page.busy; onClicked: page.newChat() }
        }

        // The conversation
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ListView {
                id: list
                anchors.fill: parent
                visible: page.messages.length > 0
                clip: true
                spacing: 14
                // Newest first, laid out from the bottom: the view rests on the latest message by
                // itself. It used to call positionViewAtEnd() whenever the list grew, and once the
                // chat was taller than the window that call never settled (rows get their real
                // height only after they are made, so "the end" kept moving): the window froze and
                // grew to 13 GB.
                model: msgModel
                verticalLayoutDirection: ListView.BottomToTop
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
                // The others glide up to make room for a new message (which rises in by itself, below).
                displaced: Transition { NumberAnimation { properties: "y"; duration: 220; easing.type: Easing.OutCubic } }
                // Stay on the newest message while things are added or grow (the Working line, an
                // answer being written), unless the user has scrolled up to read.
                readonly property real gap: contentY + height - originY - contentHeight
                property bool stick: true
                onMovementEnded: stick = Math.abs(gap) < 6
                onContentHeightChanged: if (stick) Qt.callLater(() => list.positionViewAtBeginning())
                onHeightChanged: if (stick) Qt.callLater(() => list.positionViewAtBeginning())

                delegate: Item {
                    id: row
                    required property string json
                    required property string mid
                    readonly property var modelData: JSON.parse(json)
                    readonly property bool mine: modelData.role === "user"
                    // Parts that only change when they really do, so cards and tool lines are not
                    // remade (and re-animated) on every poll while the answer is being written.
                    readonly property string cardsJson: JSON.stringify(modelData.cards || [])
                    readonly property string toolsJson: JSON.stringify(modelData.tools || [])
                    // Markdown joins lines; the assistant's lines are meant as lines ("Tomorrow:" then one per class).
                    readonly property string shownText: mine ? (modelData.text || "") : String(modelData.text || "").replace(/([^\n])\n(?=[^\n])/g, "$1  \n")
                    // The answer still being worked on, with nothing in it yet: the Working line shows instead.
                    readonly property bool empty: !mine && !modelData.text && !(modelData.tools || []).length && !(modelData.cards || []).length && !modelData.error
                    width: list.width
                    height: empty ? 0 : bubble.height
                    visible: !empty
                    // A message that is new on screen rises in, once (not when scrolled back into view).
                    property real rise: 1
                    opacity: rise
                    transform: Translate { y: (1 - row.rise) * 16 }
                    NumberAnimation on rise { id: riseAnim; running: false; from: 0; to: 1; duration: 300; easing.type: Easing.OutCubic }
                    Component.onCompleted: {
                        if (page.seen[row.mid] || !page.ready) { page.seen[row.mid] = true; return; }
                        page.seen[row.mid] = true;
                        riseAnim.start();
                    }

                    // The bubble hugs short messages. Its width comes from the text measured on one
                    // line, never from the wrapped text inside it: that text wraps to the bubble, so
                    // sizing the bubble from it made a loop that never settled once the chat was
                    // taller than the window (the list kept laying itself out: 13 GB, frozen).
                    Text {
                        id: natural
                        visible: false
                        text: row.shownText
                        textFormat: row.mine ? Text.PlainText : Text.MarkdownText
                        font.family: Theme.mono
                        font.pixelSize: 14
                    }
                    Text { id: naturalError; visible: false; text: row.modelData.error || ""; font.family: Theme.mono; font.pixelSize: 13 }

                    Rectangle {
                        id: bubble
                        anchors.right: row.mine ? parent.right : undefined
                        anchors.left: row.mine ? undefined : parent.left
                        width: Math.min(row.width * (row.mine ? 0.75 : 0.9),
                                        Math.max(row.modelData.text !== "" ? natural.implicitWidth : 0, row.modelData.error ? naturalError.implicitWidth : 0, toolLines.implicitWidth,
                                                 (row.modelData.files || []).length ? 290 : 0,
                                                 (row.modelData.cards || []).length ? ((row.modelData.cards || []).length > 1 ? 688 : 340) : 0,
                                                 page.openSteps[row.modelData.id] ? 620 : 0) + 32)
                        height: body.height + 22
                        color: row.mine ? Theme.surface2 : "transparent"
                        border.width: row.mine ? 1 : 0
                        border.color: Theme.border
                        Rectangle { visible: !row.mine; width: 3; color: Theme.accent; anchors { left: parent.left; top: parent.top; bottom: parent.bottom } }

                        // A plain column, not a layout: its height is always the real height of what
                        // it holds (a layout missed text that wrapped or cards that went to a second
                        // row, and the message then overlapped the next one).
                        Column {
                            id: body
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 11; leftMargin: row.mine ? 14 : 16 }
                            spacing: 6

                            // What was attached to this message.
                            Flow {
                                visible: row.mine && (row.modelData.files || []).length > 0
                                width: body.width
                                spacing: 6
                                Repeater {
                                    model: row.mine ? (row.modelData.files || []) : []
                                    FileChip { required property var modelData; name: modelData.name; fileId: modelData.id; mime: modelData.mime || "" }
                                }
                            }
                            // What the assistant did, one line per tool.
                            ColumnLayout {
                                id: toolLines
                                spacing: 6
                                visible: !row.mine && (row.modelData.tools || []).length > 0
                                Repeater {
                                    model: row.mine ? [] : JSON.parse(row.toolsJson)
                                    RowLayout {
                                        required property var modelData
                                        spacing: 8
                                        property bool expanded: !!page.openTools[row.modelData.id + ":" + modelData.tool]
                                        NumberAnimation on opacity { from: 0; to: 1; duration: 220; easing.type: Easing.OutCubic }
                                        Icon {
                                            name: modelData.status === "completed" ? "check" : modelData.status === "error" ? "close" : "sync"
                                            size: 12
                                            color: modelData.status === "completed" ? Theme.teal : modelData.status === "error" ? Theme.accent : Theme.muted
                                            RotationAnimation on rotation { running: modelData.status !== "completed" && modelData.status !== "error"; from: 0; to: 360; duration: 1200; loops: Animation.Infinite }
                                            // The tick pops in.
                                            NumberAnimation on scale { from: 0.3; to: 1; duration: 340; easing.type: Easing.OutBack; easing.overshoot: 3 }
                                        }
                                        Text { text: modelData.label + (parent.expanded ? " · " + modelData.status : ""); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                                        MouseArea {
                                            anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                            onClicked: { const all = Object.assign({}, page.openTools), key = row.modelData.id + ":" + modelData.tool; if (all[key]) delete all[key]; else all[key] = true; page.openTools = all; }
                                        }
                                    }
                                }
                            }
                            Flow {
                                visible: !row.mine && (row.modelData.cards || []).some(c => c.kind === "action")
                                width: body.width; spacing: 8
                                Repeater {
                                    model: row.mine ? [] : (row.modelData.cards || []).filter(c => c.kind === "action")
                                    ActionCard { required property var modelData; info: modelData; width: Math.min(340, body.width) }
                                }
                            }
                            Flow {
                                visible: !row.mine && (row.modelData.cards || []).some(c => c.kind === "file")
                                width: body.width; spacing: 6
                                Repeater {
                                    model: row.mine ? [] : (row.modelData.cards || []).filter(c => c.kind === "file")
                                    FileResultChip { required property var modelData; info: modelData }
                                }
                            }
                            // What it did, drawn: the alarm's clock, the timer's ring, the birthday's page.
                            Flow {
                                visible: !row.mine && (row.modelData.cards || []).some(c => c.kind !== "action" && c.kind !== "file")
                                width: body.width
                                spacing: 8
                                Repeater {
                                    model: row.mine ? [] : (row.modelData.cards || []).filter(c => c.kind !== "action" && c.kind !== "file")
                                    ResultCard {
                                        required property var modelData
                                        info: modelData
                                        now: page.app ? page.app.clock : Date.now()
                                        width: Math.min(340, body.width)
                                    }
                                }
                            }
                            Text {
                                visible: row.modelData.text !== ""
                                width: body.width
                                text: row.shownText
                                textFormat: row.mine ? Text.PlainText : Text.MarkdownText
                                wrapMode: Text.Wrap
                                color: Theme.fg
                                font.family: Theme.mono
                                font.pixelSize: 14
                                lineHeight: 1.15
                                onLinkActivated: link => Qt.openUrlExternally(link)
                            }
                            RowLayout {
                                visible: !row.mine && !!row.modelData.usage && (row.modelData.usage.input_tokens !== null || row.modelData.usage.output_tokens !== null || row.modelData.usage.cost !== null || row.modelData.usage.context_percent !== null)
                                width: body.width
                                spacing: 8
                                Text { Layout.fillWidth: true; text: page.usageCaption(row.modelData.usage); color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; wrapMode: Text.Wrap }
                                Rectangle {
                                    visible: row.modelData.usage && row.modelData.usage.context_percent !== null && row.modelData.usage.context_percent !== undefined
                                    Layout.preferredWidth: 72; Layout.preferredHeight: 3
                                    color: Theme.surface2
                                    Rectangle { width: parent.width * Math.max(0, Math.min(1, Number(row.modelData.usage.context_percent || 0) / 100)); height: parent.height; color: Theme.accent }
                                }
                            }
                            Text {
                                visible: !!row.modelData.error
                                width: body.width
                                text: row.modelData.error || ""
                                wrapMode: Text.Wrap
                                color: Theme.accent
                                font.family: Theme.mono
                                font.pixelSize: 13
                            }
                            // How it got there: the steps, for an answer that is done.
                            readonly property bool hasSteps: !row.mine && (row.modelData.steps || []).length > 0
                            readonly property bool stepsOpen: !!page.openSteps[row.modelData.id]
                            Text {
                                visible: parent.hasSteps
                                text: (parent.stepsOpen ? "▴ " : "▾ ") + (page.busy && row.modelData.id === page.statusTurn ? page.currentStatus() : page.pastStatusWord(page.turnWords[row.modelData.id] || page.statusWord) + page.stepElapsed(row.modelData.steps))
                                color: stepToggle.containsMouse ? Theme.fg : Theme.faint
                                font.family: Theme.mono
                                font.pixelSize: 11
                                MouseArea {
                                    id: stepToggle
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        const o = Object.assign({}, page.openSteps);
                                        if (o[row.modelData.id]) delete o[row.modelData.id]; else o[row.modelData.id] = true;
                                        page.openSteps = o;
                                    }
                                }
                            }
                            StepList {
                                visible: parent.hasSteps && parent.stepsOpen
                                width: body.width
                                steps: page.thinkingSteps(row.modelData.steps)
                            }
                        }
                    }
                }

                header: Item {      // at the bottom, under the newest message (the list runs bottom to top)
                    id: working
                    width: list.width
                    height: page.busy ? workCol.implicitHeight + 14 : 0
                    Behavior on height { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }
                    visible: height > 1
                    // The message being worked on: its steps, live.
                    readonly property var current: {
                        const m = page.chat.messages || [];
                        const last = m.length ? m[m.length - 1] : null;
                        return last && last.role === "assistant" ? last : null;
                    }
                    ColumnLayout {
                        id: workCol
                        anchors { left: parent.left; leftMargin: 16; right: parent.right; bottom: parent.bottom }
                        spacing: 6
                        RowLayout {
                            spacing: 12
                            Icon {
                                name: "sync"; size: 13; color: Theme.accent
                                RotationAnimation on rotation { running: working.visible; from: 0; to: 360; duration: 1100; loops: Animation.Infinite }
                            }
                            Text {
                                id: dots
                                text: page.currentStatus()
                                color: Theme.accent
                                font.family: Theme.mono
                                font.pixelSize: 13
                            }
                            Text {
                                text: working.current ? page.elapsed(page.now - working.current.time) : ""
                                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11
                            }
                            // "What it's doing": the steps, opened and closed here.
                            Text {
                                visible: !!working.current
                                text: (page.showSteps ? "▴ " : "▾ ") + page.currentStatus()
                                color: stepsHover.containsMouse ? Theme.fg : Theme.faint
                                font.family: Theme.mono
                                font.pixelSize: 12
                                MouseArea { id: stepsHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.showSteps = !page.showSteps }
                            }
                        }
                        StepList {
                            visible: page.showSteps && !!working.current
                            Layout.fillWidth: true
                            Layout.maximumWidth: 720
                            steps: working.current ? page.thinkingSteps(working.current.steps) : []
                        }
                    }
                }
            }

            // Nothing said yet: what it can do, one tap away.
            ColumnLayout {
                anchors.centerIn: parent
                width: Math.min(parent.width, 520)
                visible: page.messages.length === 0
                spacing: 14
                Logo { Layout.alignment: Qt.AlignHCenter; cell: 6 }
                Text {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    text: page.chat.enabled ? "Ask Hourglass to do it for you" : (page.chat.reason || "The assistant is not available.")
                    color: Theme.fg; wrapMode: Text.Wrap
                    font.family: Theme.mono; font.pixelSize: 17; font.weight: Font.DemiBold
                }
                Text {
                    visible: page.chat.enabled
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    text: "It can read and change your notes, schedule, alarms, timers and Drive."
                    color: Theme.muted; wrapMode: Text.Wrap
                    font.family: Theme.mono; font.pixelSize: 13
                }
                Flow {
                    visible: page.chat.enabled
                    Layout.fillWidth: true
                    Layout.topMargin: 6
                    spacing: 8
                    Repeater {
                        model: ["What's on today?", "Set my alarm in 1 hour", "Wake me at 7:30 on weekdays", "Start a 25 minute timer", "Upcoming birthdays", "Tidy up my latest note"]
                        Btn { required property string modelData; compact: true; text: modelData; onClicked: page.sendText(modelData) }
                    }
                }
            }
        }

        // Attached, waiting to be sent
        Flow {
            visible: page.attachments.length > 0
            Layout.fillWidth: true
            spacing: 6
            Repeater {
                model: page.attachments
                FileChip {
                    required property var modelData
                    name: modelData.name
                    fileId: modelData.id || ""
                    mime: modelData.mime || ""
                    note: modelData.error ? modelData.error : modelData.id ? "" : "Uploading…"
                    removable: true
                    onRemove: page.unattach(modelData.key)
                }
            }
        }

        // The message box
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(Math.max(input.area.contentHeight + 22, 48), 160)
            color: Theme.surface
            border.width: 1
            border.color: input.area.activeFocus ? Theme.accent : Theme.border
            opacity: page.chat.enabled ? 1 : 0.5

            RowLayout {
                anchors { fill: parent; leftMargin: 14; rightMargin: 7; topMargin: 7; bottomMargin: 7 }
                spacing: 10
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    kind: "subtle"; icon: "clip"; tip: "Attach pictures or files (or drop them here)"
                    enabled: page.chat.enabled && !page.busy
                    onClicked: attachDialog.open()
                }
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    kind: "subtle"; icon: "drive"; tip: "Attach an existing Drive file"
                    enabled: page.chat.enabled && !page.busy
                    onClicked: drivePicker.open()
                }
                ScrollView {
                    id: input
                    property alias text: field.text
                    readonly property alias area: field
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    enabled: page.chat.enabled
                    ScrollBar.vertical.policy: ScrollBar.AsNeeded
                    TextArea {
                        id: field
                        wrapMode: TextArea.Wrap
                        color: Theme.fg
                        placeholderText: page.busy ? "Working on it…" : "Ask Hourglass…   Enter to send, Shift+Enter for a new line"
                        placeholderTextColor: Theme.faint
                        selectionColor: Theme.alpha(Theme.accent, 0.45)
                        selectedTextColor: Theme.fg
                        font.family: Theme.mono
                        font.pixelSize: 14
                        textFormat: TextEdit.PlainText
                        selectByMouse: true
                        topPadding: 6
                        padding: 0
                        background: null
                        Keys.onReturnPressed: event => {
                            if (event.modifiers & Qt.ShiftModifier) { event.accepted = false; return; }
                            page.sendText(field.text);
                        }
                        Keys.onEnterPressed: event => page.sendText(field.text)
                        Keys.onPressed: event => {
                            if (event.key === Qt.Key_Tab && (event.modifiers & Qt.ShiftModifier)) { event.accepted = true; page.cycleMode(); }
                        }
                    }
                }
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    kind: page.busy ? "ghost" : "primary"
                    icon: page.busy ? "stop" : "send"
                    text: page.busy ? "Stop" : "Send"
                    enabled: page.chat.enabled && (page.busy || ((input.text.trim() !== "" || page.attachments.some(a => a.id)) && !page.uploading))
                    onClicked: page.busy ? page.stop() : page.sendText(input.text)
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Rectangle {
                implicitWidth: Math.min(300, modelChipLabel.implicitWidth + 20); implicitHeight: 30
                color: Theme.surface2; border.width: 1; border.color: modelHover.containsMouse ? Theme.accent : Theme.border
                Text { id: modelChipLabel; anchors.centerIn: parent; text: page.engineLabel() + "  ▾"; color: Theme.fg; elide: Text.ElideRight; width: Math.min(270, implicitWidth); font.family: Theme.mono; font.pixelSize: 11 }
                MouseArea { id: modelHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: modelMenu.open() }
            }
            Rectangle {
                implicitWidth: modeChipLabel.implicitWidth + 22; implicitHeight: 30
                color: page.mode === "dangerous" ? Theme.accent : Theme.surface2
                border.width: 1; border.color: page.mode === "dangerous" ? Theme.accent : modeHoverChip.containsMouse ? Theme.accent : Theme.border
                Text { id: modeChipLabel; anchors.centerIn: parent; text: page.mode.charAt(0).toUpperCase() + page.mode.slice(1) + "  ▾"; color: page.mode === "dangerous" ? Theme.bg : Theme.fg; font.family: Theme.mono; font.pixelSize: 11; font.weight: Font.DemiBold }
                MouseArea { id: modeHoverChip; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: modeMenu.open() }
            }
            Text {
                Layout.fillWidth: true
                visible: page.mode === "dangerous"
                text: "Dangerous: changes and deletions apply without asking"
                color: Theme.accent; wrapMode: Text.Wrap
                font.family: Theme.mono; font.pixelSize: 11
            }
            Item { visible: page.mode !== "dangerous"; Layout.fillWidth: true }
        }
    }
}
