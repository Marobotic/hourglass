import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs
import QtCore
import "ChatMarkdown.js" as Markdown

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
    property var modelSettings: null
    property var modelChoices: []
    property string modelError: ""
    property bool modelsLoading: false
    readonly property bool uploading: attachments.some(a => !a.id && !a.error)
    property string editing: ""      // id of the user message being edited ("" when none)
    property var streamQueue: []     // live events waiting for the next redraw
    readonly property var ctx: lastUsage()
    readonly property real ctxPercent: ctx && ctx.context_percent !== null && ctx.context_percent !== undefined ? Number(ctx.context_percent) : -1
    readonly property bool canSteer: chat.engine === "anthropic" || chat.engine === "openai"
    readonly property bool hasDraft: input.text.trim() !== "" || attachments.some(a => a.id)
    readonly property string lastAssistant: { const l = chat.messages || []; for (let i = l.length - 1; i >= 0; i--) if (l[i].role === "assistant") return String(l[i].id); return ""; }
    // The newest assistant message that changed a Drive file and was not undone yet: that is what Undo restores.
    readonly property string undoTarget: { const l = chat.messages || []; for (let i = l.length - 1; i >= 0; i--) if (l[i].role === "assistant" && changedFile(l[i])) return String(l[i].id); return ""; }

    readonly property bool busy: sending || chat.busy || pending !== "" || (chat.queue || []).length > 0
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
            page.restoreDraft();
            if (!page.ready) Qt.callLater(() => page.ready = true);
            if (page.pending !== "" && (d.messages || []).some(m => m.role === "user" && m.text === page.pending)) page.pending = "";
            // Finished: pull what the assistant changed, so every page shows it.
            if (page.wasBusy && !d.busy && page.pending === "") Api.post("/api/sync/now", {});
            page.wasBusy = d.busy || page.pending !== "";
        }, true);
    }

    // A message sent while a reply is running waits in the queue (greyed, with a cancel);
    // with `steer` (engines that take it) it goes into the running reply instead.
    function sendText(text, steer) {
        const files = page.attachments.filter(a => a.id);
        const kept = page.attachments;
        // With only files, the server says what the message is.
        const t = text.trim() || (files.length ? "(see the attached file" + (files.length > 1 ? "s)" : ")") : "");
        if (!t || page.sending || page.uploading || !page.chat.enabled) return;
        if (page.editing !== "") { page.sendEdit(t, files, kept, text); return; }
        const running = !!page.chat.busy;
        if (!running) page.pending = t;
        page.sending = true;
        page.wasBusy = true;
        input.text = "";
        page.attachments = [];
        list.stick = true;
        list.positionViewAtBeginning();     // back down to the newest message
        const body = { text: t, files: files.map(a => a.id) };
        if (steer && running && page.canSteer) body.steer = true;
        Api.request("POST", "/api/assistant/message", body, (d, err) => {
            page.sending = false;
            if (!d) { if (!running) page.pending = ""; input.text = text; page.attachments = kept; return; }
            if (d.queued) page.queueAdd(d.id, t, files.length);
            page.load();
        }, true);
    }
    function queueAdd(id, text, files) {
        const c = Object.assign({}, page.chat);
        c.queue = (c.queue || []).concat([{ id: id, at: Date.now(), text: text, files: files }]);
        page.chat = c;
        page.chatJson = "";
    }
    function cancelQueued(id) {
        const c = Object.assign({}, page.chat);
        c.queue = (c.queue || []).filter(q => q.id !== id);
        page.chat = c;
        page.chatJson = "";
        Api.request("DELETE", "/api/assistant/queue/" + id, null, () => page.load(), true);
    }

    // Edit: the message goes back into the box; sending replaces it and everything after it.
    function beginEdit(m) {
        page.editing = String(m.id);
        input.text = m.text || "";
        input.area.cursorPosition = input.text.length;
        focusComposer();
    }
    function cancelEdit() { page.editing = ""; input.text = ""; }
    function sendEdit(t, files, kept, raw) {
        const id = page.editing;
        page.sending = true;
        page.wasBusy = true;
        input.text = "";
        page.attachments = [];
        page.editing = "";
        const body = { message_id: id, text: t };
        if (files.length) body.files = files.map(a => a.id);
        Api.request("POST", "/api/assistant/edit", body, (d, err) => {
            page.sending = false;
            if (!d) { input.text = raw; page.attachments = kept; page.editing = id; return; }
            page.load();
        }, true);
    }
    function retry(id) {
        page.wasBusy = true;
        Api.request("POST", "/api/assistant/retry", { message_id: id }, d => { if (d) page.load(); }, true);
    }
    function undo() {
        Api.request("POST", "/api/assistant/undo", {}, d => { if (d) { page.load(); Api.post("/api/sync/now", {}); } }, true);
    }
    function changedFile(m) {
        return (m.cards || []).some(c => c.kind === "file" && (c.state === "changed" || c.state === "created" || c.state === "deleted"));
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
                    if (row && row.files) { // a folder: one attachment per file in it
                        const i = page.attachments.findIndex(x => x.key === a.key);
                        const each = row.files.map(r => ({ key: r.id, id: r.id, mime: r.mime, name: r.name }));
                        if (i >= 0) page.attachments = page.attachments.slice(0, i).concat(each, page.attachments.slice(i + 1));
                        return;
                    }
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
        const safe = ["ask", "auto", "plan"];
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
        note: (info.state === "read" ? "Read · " : info.state === "created" ? "Created · " : info.state === "deleted" ? "Deleted · " : info.state === "undone" ? "Undone · " : "Changed · ")
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
    function engineLabel() { return page.baseLabel() + (page.chat.effort ? " · " + page.chat.effort : ""); }
    function baseLabel() {
        const m = String(page.chat.model || "");
        const shortName = m.replace(/^opencode\//, "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^./, c => c.toUpperCase());
        if (page.chat.engine === "anthropic") return "Claude API · " + shortName;
        if (page.chat.engine === "claude") return "Claude plan · " + shortName;
        if (page.chat.engine === "openai") return (page.chat.engine_name || "API") + " · " + (m || "pick a model");
        return "Free · " + (shortName || "auto");
    }
    function modelLabel(m) {
        let label = m.name || m.id;
        if (m.note) label += "  · " + m.note;
        if (m.supports_tools === false) label += "  · tools unsupported";
        if (m.context_window) label += "  · " + (m.context_window >= 1000000 ? (m.context_window / 1000000).toFixed(1).replace(/\.0$/, "") + "M" : Math.round(m.context_window / 1000) + "k");
        return label;
    }
    function openModelMenu() {
        modelError = ""; modelChoices = []; modelsLoading = true;
        modelSettings = null; modelMenu.open();
        Api.request("GET", "/api/assistant/settings", null, (d, err) => {
            if (!d) { modelError = err || "Could not load models."; modelsLoading = false; return; }
            modelSettings = d;
            if (d.engine === "free") { modelChoices = d.free_models || []; modelsLoading = false; }
            else if (d.engine === "claude" || d.engine === "anthropic") { modelChoices = d.claude_models || []; modelsLoading = false; }
            else Api.request("GET", "/api/assistant/models?base_url=" + encodeURIComponent(d.base_url || ""), null, (m, modelErr) => {
                modelChoices = m && m.models ? m.models : [];
                modelError = m && m.error ? m.error : modelErr || "";
                modelsLoading = false;
            }, true);
        }, true);
    }
    // The effort saved for a model: the one in use, or the one kept for it per engine.
    function effortFor(id) {
        const s = page.modelSettings;
        if (!s) return "";
        if (s.model === id && s.effort) return s.effort;
        for (const slot in (s.efforts || {})) if (s.efforts[slot] && s.efforts[slot][id]) return s.efforts[slot][id];
        return "";
    }
    function selectModel(id, effort) {
        const body = { engine: modelSettings.engine, model: id };
        if (effort) body.effort = effort;
        if (modelSettings.engine === "openai") body.base_url = modelSettings.base_url;
        modelError = "";
        Api.request("POST", "/api/assistant/settings", body, (d, err) => {
            if (!d) { modelError = err || "Could not save the model."; return; }
            modelMenu.close(); page.load();
        }, true);
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
        Api.request("POST", "/api/assistant/new", {}, () => { page.pending = ""; page.editing = ""; page.load(); }, true);
    }
    // The newest answer that knows how full the context is.
    function lastUsage() {
        const l = chat.messages || [];
        for (let i = l.length - 1; i >= 0; i--) {
            const u = l[i].usage;
            if (u && u.context_percent !== null && u.context_percent !== undefined) return u;
        }
        return null;
    }
    function tokens(n) {
        n = Number(n || 0);
        return n >= 1000000 ? (n / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
    }
    function clockAt(ms) {
        const d = new Date(ms);
        return (d.toDateString() === new Date().toDateString() ? "" : d.toLocaleDateString(Qt.locale(), "ddd d MMM") + " ") + d.toLocaleTimeString(Qt.locale(), "HH:mm");
    }
    // "Limit reached, continues at 14:30": quiet, from the quota events.
    readonly property var quota: chat.quota && chat.quota.state !== "ok" ? chat.quota : null
    function quotaLine() {
        const q = page.quota;
        if (!q) return "";
        return "Limit reached" + (q.resets_at ? ", continues at " + clockAt(q.resets_at) : "") + (q.message ? " · " + q.message : "");
    }

    // --- the live stream ---------------------------------------------------------------------

    function onStreamEvent(name, d) {
        page.streamQueue = page.streamQueue.concat([[name, d]]);
        if (!flushTimer.running) flushTimer.start();
    }
    // Events arrive faster than they are worth drawing: they are applied together, a few times a second.
    function flushStream() {
        const events = page.streamQueue;
        page.streamQueue = [];
        if (!events.length) return;
        const c = Object.assign({}, page.chat);
        c.messages = (page.chat.messages || []).slice();
        const copied = {};
        let reload = false;
        const msg = id => {
            const i = c.messages.findIndex(m => m.id === id);
            if (i < 0) return null;
            if (!copied[id]) { c.messages[i] = Object.assign({}, c.messages[i]); copied[id] = true; }
            return c.messages[i];
        };
        for (const ev of events) {
            const name = ev[0], d = ev[1];
            if (name === "ready") {
                Object.assign(c, { enabled: d.enabled, engine: d.engine, model: d.model, effort: d.effort, state: d.state, busy: d.busy, queued: d.queued });
            } else if (name === "state") {
                Object.assign(c, { state: d.state, busy: d.busy, queued: d.queued });
                reload = true;      // the queue and the finished answer's cards come with the snapshot
            } else if (name === "message_start") {
                c.busy = true; c.state = "busy";
                const known = c.messages.some(m => m.id === d.user_message_id);
                if (d.user_message_id && !known) {
                    // The question first, so the answer never lands above it: the box's text, or the next in the queue.
                    const q = (c.queue || [])[0];
                    const text = page.pending !== "" ? page.pending : q ? q.text : null;
                    if (text !== null) {
                        c.messages.push({ id: d.user_message_id, role: "user", time: d.at || Date.now(), text: text, tools: [], files: [], cards: [], steps: [] });
                        if (q && page.pending === "") c.queue = c.queue.slice(1);
                    }
                    reload = true;
                }
                if (!c.messages.some(m => m.id === d.message_id))
                    c.messages.push({ id: d.message_id, role: "assistant", time: d.at || Date.now(), text: "", tools: [], files: [], cards: [], pending_actions: [], steps: [], usage: null, error: null, model: d.model || null, quick: !!d.quick, steer: false });
            } else if (name === "text") {
                const m = msg(d.message_id);
                if (!m) { reload = true; continue; }
                m.text = d.text;
            } else if (name === "tool_start" || name === "tool_update" || name === "tool_end") {
                const m = msg(d.message_id);
                if (!m) { reload = true; continue; }
                const tools = (m.tools || []).slice();
                const at = tools.findIndex(t => t.call_id === d.id);
                const next = { call_id: d.id };
                for (const k of ["tool", "label", "status", "input", "output", "duration_ms", "diff"]) if (d[k] !== undefined) next[k] = d[k];
                if (at >= 0) tools[at] = Object.assign({}, tools[at], next); else tools.push(Object.assign({ tool: "", label: "", status: "running", input: "", output: "", duration_ms: null, diff: null }, next));
                m.tools = tools;
            } else if (name === "usage") {
                const m = msg(d.message_id);
                if (m) m.usage = Object.assign({}, m.usage || {}, d);
            } else if (name === "steer") {
                reload = true;
            } else if (name === "quota") {
                c.quota = d.state === "quota" ? d : null;
            } else if (name === "message_end") {
                const m = msg(d.message_id);
                if (m) {
                    if (d.text !== undefined && d.text !== null) m.text = d.text;
                    m.error = d.error || null; m.error_kind = d.error_kind || null; m.error_resets_at = d.error_resets_at || null;
                    if (d.model) m.model = d.model;
                    if (d.usage) m.usage = d.usage;
                }
                reload = true;
            }
        }
        page.chat = c;
        page.chatJson = "";
        if (!page.ready) Qt.callLater(() => page.ready = true);
        if (reload) page.load();
    }

    // --- pictures, copy and quote, drafts --------------------------------------------

    function focusComposer() { Qt.callLater(() => input.area.forceActiveFocus()); }

    // Every picture in the chat, oldest first, then the ones waiting to be sent.
    function pictures() {
        if (!page.info) return [];
        const out = [], seenIds = {};
        const add = f => {
            if (!f || !f.id || seenIds[f.id] || !/^image\//.test(f.mime || "")) return;
            seenIds[f.id] = true;
            out.push({ id: f.id, name: f.name || "Picture", url: page.info.file_base + f.id + "?k=" + page.info.key });
        };
        for (const m of page.messages) (m.files || []).forEach(add);
        page.attachments.forEach(add);
        return out;
    }
    function openImage(id) {
        const list = pictures();
        const at = list.findIndex(p => p.id === id);
        if (at >= 0) lightbox.show(list, at);
    }

    // QML has no clipboard API: copy through a hidden text field.
    function copy(text) { clip.text = text; clip.selectAll(); clip.copy(); }
    // A message as plain text: the markdown marks go, code and table cells stay as written.
    function plainText(md) {
        const inline = s => s
            .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
            .replace(/^\s{0,3}#{1,6}\s+/gm, "")
            .replace(/(\*\*|__)(.+?)\1/g, "$2")
            .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1$2")
            .replace(/`([^`\n]+)`/g, "$1")
            .replace(/^\s*>\s?/gm, "");
        return Markdown.blocks(md).map(b => b.kind === "code" ? b.text : b.kind === "table" ? b.rows.map(r => r.join("\t")).join("\n") : inline(b.text)).join("\n\n").trim();
    }
    function quote(text) {
        const q = plainText(text).split("\n").map(l => "> " + l).join("\n") + "\n\n";
        input.text = q + input.text;
        input.area.cursorPosition = q.length;
        focusComposer();
    }
    property var menuMessage: null
    function openMessageMenu(message, pos) {
        menuMessage = message;
        const items = [{ key: "copy", label: "Copy" }, { key: "markdown", label: "Copy as Markdown" }, { key: "quote", label: "Quote in reply" }];
        const idle = !page.busy;
        if (message.role === "user" && message.id !== "pending") items.push({ separator: true }, { key: "edit", label: "Edit and resend", disabled: !idle });
        if (message.role === "assistant") {
            const more = [];
            if (String(message.id) === page.lastAssistant) more.push({ key: "retry", label: "Retry", disabled: !idle });
            if (String(message.id) === page.undoTarget) more.push({ key: "undo", label: "Undo file change", disabled: !idle });
            if (more.length) items.push({ separator: true }, ...more);
        }
        msgMenu.show(pos.x, pos.y, message.role === "user" ? "Your message" : "Assistant", items);
    }

    // The picture on the clipboard (the background service reads it: QML can only paste text).
    function pasteImage() {
        Api.request("POST", "/api/clipboard/image", {}, d => { if (d && d.url) page.attach([d.url]); }, true);
    }

    // One draft per chat: the text and the files already uploaded, kept in window.ini so
    // they survive a page switch and a restart. The chat is told apart by its first message.
    readonly property string draftKey: { const m = chat.messages || []; return m.length ? String(m[0].id) : "new"; }
    property string loadedDraft: ""  // the chat whose draft is in the box ("" until the first load)
    property bool restoring: false
    function readDrafts() { try { return JSON.parse(drafts.saved) || {}; } catch (e) { return {}; } }
    function saveDraft() {
        if (restoring || loadedDraft === "") return;
        const all = readDrafts();
        const files = attachments.filter(a => a.id).map(a => ({ key: a.key, id: a.id, name: a.name, mime: a.mime || "" }));
        if (input.text.trim() === "" && !files.length) delete all[loadedDraft];
        else all[loadedDraft] = { text: input.text, files: files };
        const json = JSON.stringify(all);
        if (json !== drafts.saved) drafts.saved = json;
    }
    function restoreDraft() {
        if (draftKey === loadedDraft) return;
        draftTimer.stop();
        saveDraft();
        loadedDraft = draftKey;
        restoring = true;
        const d = readDrafts()[draftKey];
        input.text = d ? d.text : "";
        attachments = d ? d.files : [];
        restoring = false;
    }
    onAttachmentsChanged: if (!restoring) draftTimer.restart()
    Timer { id: draftTimer; interval: 500; onTriggered: page.saveDraft() }

    // Ctrl+K: the things you do around a chat, by name.
    readonly property var commands: [
        { title: "New chat", note: "Ctrl+N", enabled: page.messages.length > 0 && !page.busy, run: () => page.newChat() },
        { title: "Switch model…", note: page.engineLabel(), enabled: true, run: () => page.openModelMenu() },
        { title: "Mode: Ask", note: page.mode === "ask" ? "Current" : "Every change waits for approval", enabled: true, run: () => page.setMode("ask") },
        { title: "Mode: Auto", note: page.mode === "auto" ? "Current" : "Only risky actions wait", enabled: true, run: () => page.setMode("auto") },
        { title: "Mode: Plan", note: page.mode === "plan" ? "Current" : "Read only: nothing is changed", enabled: true, run: () => page.setMode("plan") },
        { title: "Mode: Dangerous", note: page.mode === "dangerous" ? "Current" : "Changes apply immediately", enabled: true, run: () => page.setMode("dangerous") },
        { title: "Usage…", note: "Tokens, cost and limits", enabled: true, run: () => usagePage.open() },
        { title: "Change AI…", note: "Engine and keys", enabled: true, run: () => aiSettings.open() },
        { title: "Open settings", note: "", enabled: !!page.app, run: () => { const i = page.app.pages.findIndex(p => p.name === "Settings"); if (i >= 0) page.app.go(i); } }
    ]
    readonly property bool overlayOpen: lightbox.opened || palette.opened || modelMenu.opened || modeMenu.opened || drivePicker.opened || msgMenu.opened || ctxPop.opened || aiSettings.visible || usagePage.visible

    Component.onCompleted: { load(); Api.get("/api/drive/info", d => { if (d) page.info = d; }); }

    AssistantSettings { id: aiSettings; onSaved: page.load() }
    AssistantUsage { id: usagePage }
    AssistantStream {
        id: stream
        active: page.visible && Util.shown(page.app) && page.chat.enabled !== false
        onOpened: page.load()
        onReceived: (name, data) => page.onStreamEvent(name, data)
    }
    Timer { id: flushTimer; interval: 60; onTriggered: page.flushStream() }
    // The clock on the Working line.
    Timer { interval: 1000; running: page.visible && page.busy; repeat: true; onTriggered: page.now = Date.now() }

    Popup {
        id: modelMenu
        onClosed: page.focusComposer()
        parent: modelChip; x: 0; y: -height - 6   // above the chip
        width: 340; height: Math.min(460, modelMenuList.implicitHeight + 20); padding: 10
        background: Rectangle { color: Theme.surface; border.color: Theme.border; border.width: 1; radius: 4 }
        ScrollView {
            anchors.fill: parent; clip: true
            ColumnLayout {
                id: modelMenuList
                width: modelMenu.width - 20; spacing: 3
                Text { text: "MODEL · " + (page.modelSettings ? page.modelSettings.engine.toUpperCase() : ""); color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1.2 }
                Text { visible: page.modelsLoading; text: "Loading models…"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                Text { visible: !page.modelsLoading && page.modelChoices.length === 0 && page.modelError === ""; text: "No models available."; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                Repeater {
                    model: page.modelChoices
                    delegate: Rectangle {
                        id: choice
                        required property var modelData
                        readonly property var efforts: modelData.efforts || []
                        Layout.fillWidth: true; implicitHeight: efforts.length ? 68 : 42
                        color: modelChoiceHover.containsMouse ? Theme.surface2 : "transparent"
                        Text { y: choice.efforts.length ? 10 : (parent.height - height) / 2; anchors.left: parent.left; anchors.right: parent.right; anchors.leftMargin: 8; anchors.rightMargin: 28; text: page.modelLabel(modelData); color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 12 }
                        Text { y: choice.efforts.length ? 8 : (parent.height - height) / 2; anchors.right: parent.right; anchors.rightMargin: 8; text: "✓"; visible: page.modelSettings && (page.modelSettings.model || (page.modelChoices[0] || {}).id) === modelData.id; color: Theme.accent; font.pixelSize: 15 }
                        MouseArea { id: modelChoiceHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.selectModel(modelData.id) }
                        // How hard it thinks, where the model takes it: choosing one saves it for this model.
                        Row {
                            visible: choice.efforts.length > 0
                            anchors { left: parent.left; leftMargin: 8; bottom: parent.bottom; bottomMargin: 8 }
                            spacing: 4
                            Repeater {
                                model: choice.efforts
                                Rectangle {
                                    required property string modelData
                                    readonly property bool chosen: page.effortFor(choice.modelData.id) === modelData
                                    width: effortLabel.implicitWidth + 16; height: 22
                                    color: chosen ? Theme.accent : "transparent"
                                    border.width: 1; border.color: chosen || effortHover.containsMouse ? Theme.accent : Theme.border
                                    Text { id: effortLabel; anchors.centerIn: parent; text: parent.modelData.charAt(0).toUpperCase() + parent.modelData.slice(1); color: parent.chosen ? Theme.accentInk : Theme.fg; font.family: Theme.mono; font.pixelSize: 11 }
                                    MouseArea { id: effortHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.selectModel(choice.modelData.id, parent.modelData) }
                                }
                            }
                        }
                    }
                }
                Text { visible: page.modelError !== ""; text: page.modelError; color: Theme.accent; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 12 }
                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }
                Btn { Layout.fillWidth: true; text: "Change AI…"; icon: "gear"; onClicked: { modelMenu.close(); aiSettings.open(); } }
            }
        }
    }
    Popup {
        id: modeMenu
        onClosed: page.focusComposer()
        parent: modeChip; x: 0; y: -height - 6
        width: 250; padding: 6
        background: Rectangle { color: Theme.surface; border.color: Theme.border; border.width: 1; radius: 4 }
        ColumnLayout {
            width: parent.width; spacing: 2
            Text { Layout.leftMargin: 8; Layout.topMargin: 4; text: "PERMISSIONS · SHIFT+TAB"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
            Repeater {
                model: [{ id: "ask", title: "Ask", note: "Every change waits for approval" }, { id: "auto", title: "Auto", note: "Only risky actions wait" }, { id: "plan", title: "Plan", note: "Read only: it plans, changes nothing" }, { id: "dangerous", title: "Dangerous", note: "Changes apply immediately" }]
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
        onClosed: page.focusComposer()
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

    TextEdit { id: clip; visible: false }
    Settings {
        id: drafts
        location: "file:///" + StandardPaths.writableLocation(StandardPaths.GenericDataLocation).toString().replace(/^file:\/+/, "") + "/Hourglass/window.ini"
        category: "assistant"
        property string saved: "{}"
    }
    ChatLightbox { id: lightbox; onClosed: page.focusComposer() }
    ContextMenu {
        id: msgMenu
        onPicked: key => {
            const text = page.menuMessage ? page.menuMessage.text || "" : "";
            if (key === "copy") page.copy(page.plainText(text));
            else if (key === "markdown") page.copy(text);
            else if (key === "quote") page.quote(text);
            else if (key === "edit") page.beginEdit(page.menuMessage);
            else if (key === "retry") page.retry(String(page.menuMessage.id));
            else if (key === "undo") page.undo();
        }
        onClosed: page.focusComposer()
    }

    Shortcut { sequence: "Escape"; enabled: page.visible && page.busy && !page.overlayOpen; onActivated: page.stop() }
    Shortcut { sequence: "Escape"; enabled: page.visible && page.editing !== "" && !page.busy && !page.overlayOpen; onActivated: page.cancelEdit() }
    Shortcut { sequence: "Ctrl+N"; enabled: page.visible; onActivated: { if (page.messages.length > 0 && !page.busy) page.newChat(); page.focusComposer(); } }
    Shortcut { sequence: "Ctrl+K"; enabled: page.visible; onActivated: palette.open() }

    // The command palette.
    Popup {
        id: palette
        parent: Overlay.overlay
        x: Math.round((parent.width - width) / 2); y: Math.round(parent.height * 0.16)
        width: Math.min(460, parent.width - 40)
        padding: 0
        modal: true; focus: true
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        property int current: 0
        readonly property var shown: page.commands.filter(c => c.enabled && c.title.toLowerCase().indexOf(paletteField.text.trim().toLowerCase()) >= 0)
        function run(c) {
            if (!c) return;
            close();
            Qt.callLater(c.run);
        }
        onOpened: { paletteField.text = ""; current = 0; paletteField.forceActiveFocus(); }
        onClosed: page.focusComposer()
        enter: Transition {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 120 }
            NumberAnimation { property: "scale"; from: 0.97; to: 1; duration: 200; easing.type: Easing.OutCubic }
        }
        exit: Transition { NumberAnimation { property: "opacity"; to: 0; duration: 80 } }
        Overlay.modal: Rectangle { color: Theme.alpha(Theme.bg, 0.55) }
        background: Rectangle { color: Theme.surface; border.width: 1; border.color: Theme.accent }
        contentItem: Column {
            TextField {
                id: paletteField
                width: parent.width; height: 48
                leftPadding: 16; rightPadding: 16
                placeholderText: "Type a command…"
                placeholderTextColor: Theme.faint
                color: Theme.fg
                selectionColor: Theme.alpha(Theme.accent, 0.45); selectedTextColor: Theme.fg
                font.family: Theme.mono; font.pixelSize: 14
                background: Rectangle { color: "transparent"; Rectangle { anchors { left: parent.left; right: parent.right; bottom: parent.bottom } height: 1; color: Theme.border } }
                onTextChanged: palette.current = 0
                Keys.onDownPressed: palette.current = Math.min(palette.current + 1, palette.shown.length - 1)
                Keys.onUpPressed: palette.current = Math.max(palette.current - 1, 0)
                onAccepted: palette.run(palette.shown[palette.current])
            }
            Repeater {
                model: palette.shown
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    width: palette.width; height: 40
                    color: palette.current === index || cmdHover.containsMouse ? Theme.surface2 : "transparent"
                    Rectangle { visible: palette.current === index; width: 3; height: parent.height; color: Theme.accent }
                    Text { anchors { left: parent.left; leftMargin: 16; verticalCenter: parent.verticalCenter } text: modelData.title; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13 }
                    Text { anchors { right: parent.right; rightMargin: 16; verticalCenter: parent.verticalCenter } text: modelData.note; color: Theme.muted; elide: Text.ElideRight; width: Math.min(implicitWidth, 220); horizontalAlignment: Text.AlignRight; font.family: Theme.mono; font.pixelSize: 11 }
                    MouseArea { id: cmdHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: palette.run(modelData) }
                }
            }
            Text { visible: palette.shown.length === 0; width: parent.width; height: 40; text: "No command matches"; color: Theme.muted; verticalAlignment: Text.AlignVCenter; leftPadding: 16; font.family: Theme.mono; font.pixelSize: 12 }
        }
    }

    component UsageLine: RowLayout {
        property string label: ""
        property string value: ""
        Layout.fillWidth: true
        spacing: 12
        Text { Layout.fillWidth: true; text: parent.label; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11 }
        Text { text: parent.value; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 11 }
    }
    // The numbers behind the meter.
    Popup {
        id: ctxPop
        parent: ctxMeter
        x: ctxMeter.width - width; y: ctxMeter.height + 6
        width: 270; padding: 12
        background: Rectangle { color: Theme.surface; border.color: Theme.border; border.width: 1; radius: 4 }
        contentItem: ColumnLayout {
            spacing: 6
            Text { text: "CONTEXT"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
            UsageLine { label: "Used"; value: page.ctxPercent >= 0 ? Number(page.ctxPercent).toFixed(1).replace(/\.0$/, "") + "%" + (page.ctx && page.ctx.context_window ? " of " + page.tokens(page.ctx.context_window) : "") : "" }
            UsageLine { label: "Model"; value: String(page.chat.model || "").replace(/^opencode\//, "") }
            UsageLine { visible: !!page.ctx && page.ctx.input_tokens !== null && page.ctx.input_tokens !== undefined; label: "Input"; value: page.ctx ? page.tokens(page.ctx.input_tokens) : "" }
            UsageLine { visible: !!page.ctx && page.ctx.output_tokens !== null && page.ctx.output_tokens !== undefined; label: "Output"; value: page.ctx ? page.tokens(page.ctx.output_tokens) : "" }
            UsageLine { visible: !!page.ctx && (page.ctx.cache_read_input_tokens || 0) + (page.ctx.cache_creation_input_tokens || 0) > 0; label: "Cached"; value: page.ctx ? page.tokens((page.ctx.cache_read_input_tokens || 0) + (page.ctx.cache_creation_input_tokens || 0)) : "" }
            UsageLine { visible: !!page.ctx && page.ctx.cost !== null && page.ctx.cost !== undefined; label: "Cost of this answer"; value: page.ctx ? "$" + Number(page.ctx.cost).toFixed(4) : "" }
            Text { visible: page.quota !== null; Layout.fillWidth: true; text: page.quotaLine(); wrapMode: Text.Wrap; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
            Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }
            Btn { Layout.fillWidth: true; compact: true; text: "Usage details…"; onClicked: { ctxPop.close(); usagePage.open(); } }
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
        // Under the row, so the remove button still gets its own click.
        MouseArea { anchors.fill: parent; visible: !!chip.fileId && (!chip.removable || chip.picture); cursorShape: Qt.PointingHandCursor; onClicked: chip.activated() }
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
    }
    onVisibleChanged: if (visible) { load(); input.area.forceActiveFocus(); } else { draftTimer.stop(); saveDraft(); }
    Component.onDestruction: saveDraft()
    Timer {
        interval: 900
        running: page.visible && page.busy && Util.shown(page.app) && !stream.connected
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
            // How full the conversation is, live from the usage events; click for the numbers.
            Rectangle {
                id: ctxMeter
                visible: page.ctxPercent >= 0
                implicitWidth: ctxRow.implicitWidth + 20; implicitHeight: 30
                color: Theme.surface2; border.width: 1; border.color: ctxHover.containsMouse || ctxPop.opened ? Theme.accent : Theme.border
                RowLayout {
                    id: ctxRow
                    anchors.centerIn: parent
                    spacing: 8
                    Rectangle {
                        Layout.preferredWidth: 48; Layout.preferredHeight: 3; color: Theme.border
                        Rectangle {
                            width: parent.width * Math.min(1, Math.max(0, page.ctxPercent / 100)); height: parent.height
                            color: page.ctxPercent >= 85 ? Theme.accent : page.ctxPercent >= 60 ? Theme.gold : Theme.teal
                            Behavior on width { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }
                        }
                    }
                    Text { text: Math.round(page.ctxPercent) + "%"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
                }
                MouseArea { id: ctxHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: ctxPop.opened ? ctxPop.close() : ctxPop.open() }
            }
            Btn { compact: true; kind: "subtle"; text: "Usage"; onClicked: usagePage.open() }
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
                    // Code and tables want the room: the bubble opens to its full width.
                    readonly property bool rich: !mine && /^\s{0,3}(```|~~~)|^\s*\|.*\|\s*$/m.test(modelData.text || "")
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
                                                 page.openSteps[row.modelData.id] ? 620 : 0,
                                                 row.rich ? row.width : 0) + 32)
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
                                    FileChip { required property var modelData; name: modelData.name; fileId: modelData.id; mime: modelData.mime || ""; onActivated: if (picture) page.openImage(fileId) }
                                }
                            }
                            // What the assistant did, one line per tool.
                            ColumnLayout {
                                id: toolLines
                                width: Math.min(implicitWidth, body.width)
                                spacing: 6
                                visible: !row.mine && (row.modelData.tools || []).length > 0
                                Repeater {
                                    model: row.mine ? [] : JSON.parse(row.toolsJson)
                                    ToolRow {
                                        required property var modelData
                                        info: modelData
                                        expanded: !!page.openTools[row.modelData.id + ":" + (modelData.call_id || modelData.tool)]
                                        onToggled: { const all = Object.assign({}, page.openTools), key = row.modelData.id + ":" + (modelData.call_id || modelData.tool); if (all[key]) delete all[key]; else all[key] = true; page.openTools = all; }
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
                            Text { visible: row.mine && !!row.modelData.steer; text: "Steered into the running answer"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10 }
                            ChatMarkdown {
                                visible: row.modelData.text !== ""
                                width: body.width
                                text: row.modelData.text || ""
                                plain: row.mine
                                hardBreaks: !row.mine
                                onCopyRequested: t => page.copy(t)
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
                        // Right-click anywhere on a message: copy, copy as Markdown, quote.
                        MouseArea {
                            anchors.fill: parent
                            acceptedButtons: Qt.RightButton
                            onClicked: mouse => page.openMessageMenu(row.modelData, mapToItem(page, mouse.x, mouse.y))
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
                        // Sent while it was busy: they run next, in this order; ✕ takes one back.
                        Repeater {
                            model: page.chat.queue || []
                            Rectangle {
                                required property var modelData
                                Layout.alignment: Qt.AlignRight
                                Layout.rightMargin: 2
                                Layout.topMargin: 4
                                implicitWidth: Math.min(list.width * 0.75, queuedRow.implicitWidth + 24)
                                implicitHeight: 36
                                color: "transparent"
                                border.width: 1; border.color: Theme.border
                                RowLayout {
                                    id: queuedRow
                                    anchors { fill: parent; leftMargin: 12; rightMargin: 4 }
                                    spacing: 10
                                    Text { text: "QUEUED"; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
                                    Text { Layout.fillWidth: true; text: (modelData.text || "").replace(/\s+/g, " "); textFormat: Text.PlainText; elide: Text.ElideRight; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                                    Btn { compact: true; kind: "subtle"; icon: "close"; tip: "Cancel this message"; onClicked: page.cancelQueued(modelData.id) }
                                }
                            }
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

        // A limit in force: one quiet line.
        Text {
            visible: page.quota !== null
            Layout.fillWidth: true
            text: page.quotaLine()
            elide: Text.ElideRight
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11
        }
        RowLayout {
            visible: page.editing !== ""
            Layout.fillWidth: true
            spacing: 8
            Text { Layout.fillWidth: true; text: "Editing a message: sending replaces it and everything after it"; elide: Text.ElideRight; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 11 }
            Btn { compact: true; kind: "subtle"; text: "Cancel"; onClicked: page.cancelEdit() }
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
                    onActivated: if (picture) page.openImage(fileId)
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
                    enabled: page.chat.enabled
                    onClicked: attachDialog.open()
                }
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    kind: "subtle"; icon: "drive"; tip: "Attach an existing Drive file"
                    enabled: page.chat.enabled
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
                        placeholderText: page.editing !== "" ? "Edit your message…   Enter to resend, Esc to cancel" : page.busy ? (page.canSteer ? "Queue another message…   Ctrl+Enter to steer this answer" : "Queue another message…   it runs next") : "Ask Hourglass…   Enter to send, Shift+Enter for a new line"
                        placeholderTextColor: Theme.faint
                        selectionColor: Theme.alpha(Theme.accent, 0.45)
                        selectedTextColor: Theme.fg
                        font.family: Theme.mono
                        font.pixelSize: 14
                        textFormat: TextEdit.PlainText
                        selectByMouse: true
                        onTextChanged: if (!page.restoring) draftTimer.restart()
                        topPadding: 6
                        padding: 0
                        background: null
                        Keys.onReturnPressed: event => {
                            if (event.modifiers & Qt.ShiftModifier) { event.accepted = false; return; }
                            page.sendText(field.text, !!(event.modifiers & Qt.ControlModifier));
                        }
                        Keys.onEnterPressed: event => page.sendText(field.text, !!(event.modifiers & Qt.ControlModifier))
                        Keys.onPressed: event => {
                            if (event.key === Qt.Key_Tab && (event.modifiers & Qt.ShiftModifier)) { event.accepted = true; page.cycleMode(); }
                            // Nothing to paste as text: it may be a picture (a screenshot).
                            if (event.matches(StandardKey.Paste) && !field.canPaste && page.chat.enabled) { event.accepted = true; page.pasteImage(); }
                        }
                    }
                }
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    visible: page.canSteer && !!page.chat.busy && page.hasDraft && page.editing === ""
                    compact: true; kind: "subtle"; text: "Steer"; tip: "Send into the running answer (Ctrl+Enter)"
                    enabled: page.chat.enabled && !page.uploading
                    onClicked: page.sendText(input.text, true)
                }
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    readonly property bool stops: page.busy && !page.hasDraft
                    kind: stops ? "ghost" : "primary"
                    icon: stops ? "stop" : "send"
                    text: stops ? "Stop" : page.editing !== "" ? "Resend" : page.chat.busy ? "Queue" : "Send"
                    enabled: page.chat.enabled && (stops || (page.hasDraft && !page.uploading))
                    onClicked: stops ? page.stop() : page.sendText(input.text, false)
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Rectangle {
                id: modelChip
                implicitWidth: Math.min(300, modelChipLabel.implicitWidth + 20); implicitHeight: 30
                color: Theme.surface2; border.width: 1; border.color: modelHover.containsMouse ? Theme.accent : Theme.border
                Text { id: modelChipLabel; anchors.centerIn: parent; text: page.engineLabel() + "  ▾"; color: Theme.fg; elide: Text.ElideRight; width: Math.min(270, implicitWidth); font.family: Theme.mono; font.pixelSize: 11 }
                MouseArea { id: modelHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.openModelMenu() }
            }
            Rectangle {
                id: modeChip
                implicitWidth: modeChipLabel.implicitWidth + 22; implicitHeight: 30
                color: page.mode === "dangerous" ? Theme.accent : Theme.surface2
                border.width: 1; border.color: page.mode === "dangerous" ? Theme.accent : page.mode === "plan" ? Theme.teal : modeHoverChip.containsMouse ? Theme.accent : Theme.border
                Text { id: modeChipLabel; anchors.centerIn: parent; text: page.mode.charAt(0).toUpperCase() + page.mode.slice(1) + "  ▾"; color: page.mode === "dangerous" ? Theme.bg : page.mode === "plan" ? Theme.teal : Theme.fg; font.family: Theme.mono; font.pixelSize: 11; font.weight: Font.DemiBold }
                MouseArea { id: modeHoverChip; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: modeMenu.open() }
            }
            Text {
                Layout.fillWidth: true
                visible: page.mode === "dangerous"
                text: "Dangerous: changes and deletions apply without asking"
                color: Theme.accent; wrapMode: Text.Wrap
                font.family: Theme.mono; font.pixelSize: 11
            }
            Text {
                Layout.fillWidth: true
                visible: page.mode === "plan"
                text: "Plan: it reads and plans, nothing is changed"
                color: Theme.teal; wrapMode: Text.Wrap
                font.family: Theme.mono; font.pixelSize: 11
            }
            Item { visible: page.mode !== "dangerous" && page.mode !== "plan"; Layout.fillWidth: true }
        }
    }
}
