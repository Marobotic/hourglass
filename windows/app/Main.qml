import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Qt.labs.platform 1.1
import Hourglass

ApplicationWindow {
    id: app
    width: 1200
    height: 800
    minimumWidth: 720
    minimumHeight: 520
    visible: true
    title: "Hourglass"
    color: Theme.bg

    property int page: 0
    property var nowData: null
    property var appState: ({ ringing: [], sync: { state: "local" } })
    property var courses: []
    // The sidecar's correction for a wrong PC clock (it compares with the server's time).
    property double clockSkew: 0
    // The service's change counter: a jump this window didn't cause is someone
    // else's change (a sync, the assistant, an AI), so the pages reload and glow.
    property int dataRev: -1
    property double clock: Date.now()
    property var editingNote: null
    property bool loaded: false
    property var settings: ({})
    property bool devLogin: false
    property string devLoginMode: "" // dev: --login create | forgot
    property string scheduleMode: "week"
    property string shotPath: "" // dev: render, save a PNG, quit
    property string devOpen: ""  // dev: note | course | event | session

    Timer {
        running: app.devOpen !== "" && app.loaded
        interval: 400
        onTriggered: {
            const f = app.nowData.focus;
            if (app.devOpen === "note") app.sessionNote(f, app.nowData.notes.session);
            if (app.devOpen === "course") app.editCourse(null);
            if (app.devOpen === "event") app.editEvent(null);
            if (app.devOpen === "session") app.openSession(f);
            if (app.devOpen.startsWith("note:")) Api.get("/api/notes/" + app.devOpen.slice(5), n => app.editingNote = n);
            console.log("dev-open", app.devOpen);
        }
    }

    Timer {
        running: app.shotPath !== "" && app.loaded
        interval: 1500
        onTriggered: {
            // popups live on the overlay layer, so grab the open one's content instead
            const open = [eventDialog, courseDialog, sessionDialog].find(d => d.visible);
            (open ? open.contentItem : shell).grabToImage(r => { r.saveToFile(app.shotPath); app.quit(); });
        }
    }
    readonly property bool narrow: width < 980

    // Windows has no JetBrains Mono Nerd Font installed; the package ships it
    // next to the app (fonts/), which also provides the icon glyphs.
    FontLoader { source: Qt.platform.os === "windows" ? Qt.resolvedUrl("fonts/JetBrainsMonoNerdFont-Regular.ttf") : "" }
    FontLoader { source: Qt.platform.os === "windows" ? Qt.resolvedUrl("fonts/JetBrainsMonoNerdFont-Bold.ttf") : "" }
    readonly property var pages: [
        { name: "Now", icon: "now", key: "1" },
        { name: "Schedule", icon: "week", key: "2" },
        { name: "Notes", icon: "note", key: "3" },
        { name: "Alarms", icon: "bell", key: "4" },
        { name: "Timers", icon: "timer", key: "5" },
        { name: "World clock", icon: "globe", key: "6" },
        { name: "Attendance", icon: "check-square", key: "7" },
        { name: "Drive", icon: "drive", key: "8" },
        { name: "Assistant", icon: "chat", key: "9" },
        { name: "Settings", icon: "gear", key: "0" }
    ]

    Component.onCompleted: {
        const a = Qt.application.arguments;
        for (let i = 0; i < a.length - 1; i++) {
            if (a[i] === "--token") Api.token = a[i + 1];
            if (a[i] === "--port") Api.base = "http://127.0.0.1:" + a[i + 1];
            if (a[i] === "--page") app.page = +a[i + 1];
            if (a[i] === "--screenshot") shotPath = a[i + 1];
            if (a[i] === "--open") devOpen = a[i + 1];
            if (a[i] === "--schedule") scheduleMode = a[i + 1];
            if (a[i] === "--login") { app.devLogin = true; app.devLoginMode = a[i + 1]; }
            if (a[i] === "--size") { const wh = a[i + 1].split("x"); app.width = +wh[0]; app.height = +wh[1]; }
        }
        pollState();
        refresh();
    }

    // --- system tray -------------------------------------------------------------
    // The X button hides the window to the system tray instead of quitting,
    // so alarms, timers and the sync engine keep running in the background.
    // The sidecar keeps the alarm sound alive; the UI stays alive too, so the
    // ringing overlay can appear again (see onAppStateChanged below).
    function restoreWindow() {
        app.show();
        app.raise();
        app.requestActivate();
    }

    SystemTrayIcon {
        id: tray
        tooltip: "Hourglass"
        // Always there, not just while the window is hidden: a tray icon Qt
        // creates later (when X hides the window) comes up without its menu.
        visible: tray.available
        icon.source: Qt.resolvedUrl("../hourglass.ico")
        onActivated: reason => {
            if (reason === SystemTrayIcon.Trigger || reason === SystemTrayIcon.DoubleClick)
                app.restoreWindow();
        }
        menu: Menu {
            MenuItem { text: "Show Hourglass"; onTriggered: app.restoreWindow() }
            MenuItem { text: "Quit Hourglass"; onTriggered: app.quitAll() }
        }
    }

    // Quit from the tray ends the service too (it owns this window). If the
    // service is an older one without /api/quit, just close the window.
    function quitAll() {
        Api.request("POST", "/api/quit", {}, () => app.quit(), true);
        quitFallback.start();
    }
    Timer { id: quitFallback; interval: 1500; onTriggered: app.quit() }

    // Qt 6 asks every window to close before quitting, and X only hides this
    // one - so a real quit has to say so, or onClosing cancels it.
    property bool quitting: false
    function quit() { quitting = true; Qt.quit(); }

    // Opening Hourglass from the Start menu while the window sits in the tray:
    // the launcher asks the service, which bumps show_seq, and the window comes
    // back. Quick while hidden, slow while shown.
    property int showSeq: -1
    property bool showPoll: true
    Timer {
        interval: app.visible ? 3000 : 400
        running: app.showPoll && !app.shotPath
        repeat: true
        onTriggered: Api.request("GET", "/api/window", null, (d, err) => {
            if (!d) { app.showPoll = false; return; } // an older service: no window routes
            if (app.showSeq >= 0 && d.show_seq !== app.showSeq) app.restoreWindow();
            app.showSeq = d.show_seq;
        }, true)
    }

    onClosing: close => {
        if (app.quitting) return;
        // Hide to the tray rather than close: the sidecar and any ringing
        // alarms must stay alive. Use the tray icon's "Quit" to exit.
        close.accepted = false;
        app.hide();
    }

    // An alarm or timer started ringing while the window was hidden in the
    // tray: bring the window back so the ringing overlay is visible.
    onAppStateChanged: {
        const r = app.appState ? app.appState.ringing : null;
        if (r && r.length && !app.visible) restoreWindow();
    }

    // --- data --------------------------------------------------------------------

    function refresh() {
        Api.get("/api/now", d => { if (d) { app.nowData = d; app.loaded = true; } });
        Api.get("/api/courses/summary", d => { if (d) app.courses = d; });
    }
    function pollState() {
        Api.get("/api/app", d => {
            if (!d) return;
            Theme.apply(d.theme);
            if (d.settings) {
                Util.h24 = d.settings.time_format === "24h";
                Util.weekStartDay = d.settings.week_start || 6;
                app.settings = d.settings;
            }
            if (d.tz_offset_min !== undefined) Util.offsetMin = d.tz_offset_min;
            if (d.data_rev !== undefined) {
                if (app.dataRev >= 0 && d.data_rev !== app.dataRev) Api.changed();
                app.dataRev = d.data_rev;
            }
            if (d.clock_skew_ms !== undefined && d.clock_skew_ms !== app.clockSkew) {
                app.clockSkew = d.clock_skew_ms;
                app.clock = Date.now() + app.clockSkew;
            }
            // Rebind appState only when it actually changed: pages such as the
            // sign-in form bind their fields to appState, and a fresh API
            // response would clear whatever the user is typing.
            if (JSON.stringify(d) !== JSON.stringify(app.appState)) app.appState = d;
        });
    }
    function courseById(id) { return courses.find(c => c.id === id) || null; }
    function courseColor(id) { const c = courseById(id); return c ? c.color : Theme.teal; }
    function courseOptions(withNone) {
        const o = courses.map(c => ({ label: c.name, value: c.id, color: c.color }));
        return withNone ? [{ label: "No course", value: null }].concat(o) : o;
    }

    Connections { target: Api; function onChanged() { app.refresh(); } }
    // Signed out, the sign-in page shows its own errors; pages loading behind it
    // would only toast "sign in first". Before the first state arrives (boot) too.
    Connections { target: Api; function onError(message) { if (app.appState.account && app.appState.account.signed_in) toast.show(message); } }
    Timer { interval: 1000; running: true; repeat: true; onTriggered: app.clock = Date.now() + app.clockSkew }
    Timer { interval: 15000; running: true; repeat: true; onTriggered: app.refresh() }
    Timer { interval: 2000; running: true; repeat: true; onTriggered: app.pollState() }

    // --- actions shared by pages ---------------------------------------------------

    function openNote(note) { editingNote = note; }
    function newNote(fields) {
        Api.action("add_note", fields || {}, n => { if (n) app.editingNote = n; });
    }
    // Opens today's note for a session, creating it on first use.
    function sessionNote(occ, existing) {
        if (existing && existing.length) return openNote(existing[0]);
        const day = occ.session_date || occ.date;
        newNote({ course: occ.course_id, date: day, title: Util.shortDate(day) });
    }
    function showToast(message) { toast.show(message); }
    function startTimer(minutes, label) { Api.action("start_timer", { minutes: minutes, label: label }); }
    function openSession(occ) { sessionDialog.show(occ); }
    function editEvent(ev, defaults) { eventDialog.edit(ev, defaults); }
    function editCourse(c) { courseDialog.edit(c); }
    function confirm(title, message, confirmText, fn) { confirmDialog.ask(title, message, confirmText, fn); }
    function go(i) { editingNote = null; page = i; }

    // --- keyboard --------------------------------------------------------------------

    Shortcut { sequences: ["1"]; onActivated: app.go(0) }
    Shortcut { sequences: ["2"]; onActivated: app.go(1) }
    Shortcut { sequences: ["3"]; onActivated: app.go(2) }
    Shortcut { sequences: ["4"]; onActivated: app.go(3) }
    Shortcut { sequences: ["5"]; onActivated: app.go(4) }
    Shortcut { sequences: ["6"]; onActivated: app.go(5) }
    Shortcut { sequences: ["7"]; onActivated: app.go(6) }
    Shortcut { sequences: ["8"]; onActivated: app.go(7) }
    Shortcut { sequences: ["9"]; onActivated: app.go(8) }
    Shortcut { sequences: ["0"]; onActivated: app.go(9) }
    Shortcut {
        sequences: ["n", "Ctrl+N"]
        onActivated: {
            const f = app.nowData && app.nowData.focus;
            if (f && f.course_id) app.sessionNote(f, app.nowData.notes.session);
            else app.newNote({});
        }
    }
    Shortcut { sequences: ["a"]; onActivated: app.go(3) }
    Shortcut { sequences: ["t"]; onActivated: app.go(4) }
    Shortcut { sequences: ["w"]; onActivated: app.go(5) }
    Shortcut { sequences: ["Escape"]; enabled: app.editingNote !== null; onActivated: app.editingNote = null }

    // --- layout ----------------------------------------------------------------------

    Rectangle {
        id: shell
        anchors.fill: parent
        color: Theme.bg

        RowLayout {
            anchors.fill: parent
            spacing: 0

            // Sidebar
            Rectangle {
                Layout.fillHeight: true
                Layout.preferredWidth: app.narrow ? 64 : 212
                color: Theme.surface
                Rectangle { anchors { right: parent.right; top: parent.top; bottom: parent.bottom } width: 1; color: Theme.border }

                ColumnLayout {
                    anchors { fill: parent; margins: 12; topMargin: 18 }
                    spacing: 4

                    RowLayout {
                        Layout.leftMargin: app.narrow ? 9 : 8
                        Layout.bottomMargin: 18
                        spacing: 12
                        Logo { cell: 3; alive: true }
                        Text { visible: !app.narrow; text: "Hourglass"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 17; font.weight: Font.Bold }
                    }

                    Repeater {
                        model: app.pages
                        Rectangle {
                            required property var modelData
                            required property int index
                            readonly property bool current: app.page === index && app.editingNote === null
                            Layout.fillWidth: true
                            height: 38
                            radius: 0
                            color: current ? Theme.surface2 : navMouse.containsMouse ? Theme.alpha(Theme.fg, 0.04) : "transparent"
                            Behavior on color { ColorAnimation { duration: 120 } }
                            // The marker grows in on the page you go to.
                            Rectangle {
                                width: 3; radius: 0; color: Theme.accent
                                height: parent.current ? 18 : 0
                                visible: height > 0.5
                                anchors { left: parent.left; verticalCenter: parent.verticalCenter }
                                Behavior on height { NumberAnimation { duration: 260; easing.type: Easing.OutBack; easing.overshoot: 2 } }
                            }
                            RowLayout {
                                anchors { fill: parent; leftMargin: app.narrow ? 0 : 14; rightMargin: 10 }
                                spacing: 12
                                Icon {
                                    Layout.alignment: app.narrow ? Qt.AlignHCenter : Qt.AlignLeft
                                    Layout.fillWidth: app.narrow
                                    name: modelData.icon; size: 15
                                    color: parent.parent.current ? Theme.fg : Theme.muted
                                    transform: Translate { x: navMouse.containsMouse && !parent.parent.current && !app.narrow ? 2 : 0; Behavior on x { NumberAnimation { duration: 140; easing.type: Easing.OutBack } } }
                                }
                                Text { visible: !app.narrow; Layout.fillWidth: true; text: modelData.name; color: parent.parent.current ? Theme.fg : Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
                                }
                            MouseArea { id: navMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: app.go(index) }
                        }
                    }

                    Item { Layout.fillHeight: true }

                    // Now-live mini card
                    Rectangle {
                        visible: !app.narrow && !!(app.nowData && app.nowData.active && app.nowData.active.state === "live")
                        Layout.fillWidth: true
                        Layout.bottomMargin: 10
                        height: 58
                        radius: 0
                        id: liveCard
                        color: Theme.alpha(Theme.accent, 0.12)
                        border.color: Theme.alpha(Theme.accent, 0.35)
                        readonly property var a: app.nowData ? app.nowData.active : null
                        ColumnLayout {
                            anchors { fill: parent; margins: 10 }
                            spacing: 2
                            Text {
                                text: "● LIVE"; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1
                                SequentialAnimation on opacity { running: liveCard.visible; loops: Animation.Infinite; NumberAnimation { to: 0.45; duration: 900; easing.type: Easing.InOutSine } NumberAnimation { to: 1; duration: 900; easing.type: Easing.InOutSine } }
                            }
                            Text { Layout.fillWidth: true; text: parent.parent.a ? parent.parent.a.title : ""; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                        }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: app.go(0) }
                    }

                    // A newer Hourglass is out (the service reads marobotic.dev/apps).
                    Rectangle {
                        id: updateCard
                        readonly property var u: app.appState.update || null
                        property bool asked: false
                        visible: !!u
                        Layout.fillWidth: true
                        Layout.bottomMargin: 10
                        implicitHeight: app.narrow ? 38 : updateCol.implicitHeight + 20
                        color: Theme.alpha(Theme.teal, 0.12)
                        border.color: Theme.alpha(Theme.teal, 0.45)
                        ColumnLayout {
                            id: updateCol
                            visible: !app.narrow
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 10 }
                            spacing: 6
                            Text { text: "UPDATE READY"; color: Theme.teal; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 1 }
                            Text {
                                Layout.fillWidth: true
                                text: updateCard.u ? "Hourglass " + updateCard.u.version : ""
                                color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                            }
                            Text {
                                Layout.fillWidth: true
                                visible: text !== ""
                                text: updateCard.u ? updateCard.u.notes : ""
                                color: Theme.muted; wrapMode: Text.Wrap; maximumLineCount: 3; elide: Text.ElideRight
                                font.family: Theme.sans; font.pixelSize: 12
                            }
                            Btn {
                                Layout.fillWidth: true
                                compact: true
                                kind: "primary"
                                enabled: !(updateCard.asked || (updateCard.u && updateCard.u.installing))
                                text: updateCard.asked || (updateCard.u && updateCard.u.installing) ? "Installing…" : "Install and restart"
                                onClicked: {
                                    updateCard.asked = true;
                                    Api.request("POST", "/api/update/install", {}, (d, err) => { if (!d) updateCard.asked = false; }, true);
                                }
                            }
                        }
                        Icon { visible: app.narrow; anchors.centerIn: parent; name: "download"; color: Theme.teal }
                        MouseArea { visible: app.narrow; anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: app.width = Math.max(app.width, 1000) }
                    }

                    // Who is signed in, and which Hourglass this is
                    ColumnLayout {
                        visible: !app.narrow
                        Layout.leftMargin: 8
                        Layout.rightMargin: 4
                        Layout.bottomMargin: 2
                        spacing: 2
                        Text {
                            Layout.fillWidth: true
                            visible: !!(app.appState.account && app.appState.account.email)
                            text: app.appState.account ? app.appState.account.email || "" : ""
                            color: Theme.fg
                            elide: Text.ElideMiddle
                            font.family: Theme.mono
                            font.pixelSize: 13
                        }
                        Text {
                            text: "Hourglass " + (app.appState.version || "")
                            color: Theme.faint
                            font.family: Theme.mono
                            font.pixelSize: 12
                        }
                    }

                    // Sync + clock
                    RowLayout {
                        Layout.leftMargin: app.narrow ? 12 : 8
                        spacing: 8
                        readonly property string st: app.appState.sync ? app.appState.sync.state : "local"
                        Rectangle {
                            id: syncDot
                            width: 7; height: 7; radius: 0
                            color: parent.st === "synced" ? Theme.teal : parent.st === "offline" ? Theme.orange : Theme.faint
                            // Synced: a ring ripples out now and then. Offline: the dot blinks.
                            Rectangle {
                                id: ripple
                                anchors.centerIn: parent
                                width: 7; height: 7
                                color: "transparent"; border.width: 1; border.color: syncDot.color
                                opacity: 0
                                SequentialAnimation {
                                    running: syncDot.parent.st === "synced"
                                    loops: Animation.Infinite
                                    ParallelAnimation {
                                        NumberAnimation { target: ripple; property: "scale"; from: 1; to: 2.8; duration: 1100; easing.type: Easing.OutCubic }
                                        NumberAnimation { target: ripple; property: "opacity"; from: 0.8; to: 0; duration: 1100 }
                                    }
                                    PauseAnimation { duration: 1800 }
                                }
                            }
                            SequentialAnimation on opacity {
                                running: syncDot.parent.st === "offline"
                                loops: Animation.Infinite
                                NumberAnimation { to: 0.3; duration: 500 } NumberAnimation { to: 1; duration: 500 }
                            }
                        }
                        Text {
                            visible: !app.narrow
                            text: parent.st === "synced" ? "Synced" : parent.st === "offline" ? "Offline, saved here" : "On this computer"
                            color: Theme.muted
                            font.family: Theme.mono
                            font.pixelSize: 13
                        }
                    }
                }
            }

            // Content
            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true

                StackLayout {
                    id: stack
                    anchors.fill: parent
                    currentIndex: app.page
                    visible: app.editingNote === null
                    // The page you go to rises in.
                    transform: Translate { id: pageShift }
                    onCurrentIndexChanged: pageIn.restart()
                    onVisibleChanged: if (visible) pageIn.restart()
                    ParallelAnimation {
                        id: pageIn
                        NumberAnimation { target: stack; property: "opacity"; from: 0; to: 1; duration: 200; easing.type: Easing.OutQuad }
                        NumberAnimation { target: pageShift; property: "y"; from: 16; to: 0; duration: 340; easing.type: Easing.OutCubic }
                    }
                    NowPage { app: app }
                    SchedulePage { app: app }
                    NotesPage { app: app }
                    TimePage { app: app }
                    TimersPage { app: app }
                    WorldClockPage { app: app }
                    AttendancePage { app: app }
                    DrivePage { id: drivePage; app: app }
                    AssistantPage { app: app }
                    SettingsPage { app: app }
                }

                // Files dropped on any other page are uploaded to the Drive.
                DropArea {
                    id: anyDrop
                    anchors.fill: parent
                    enabled: app.editingNote === null && app.page !== 7
                    onEntered: d => { if (d.hasUrls) d.accept(Qt.CopyAction); }
                    onDropped: d => { if (!d.hasUrls) return; d.accept(Qt.CopyAction); app.go(7); drivePage.upload(d.urls); }
                }
                Rectangle {
                    anchors.fill: parent
                    z: 20
                    visible: anyDrop.containsDrag
                    color: Theme.alpha(Theme.accent, 0.12)
                    border.width: 2
                    border.color: Theme.accent
                    Text { anchors.centerIn: parent; text: "Drop to upload to your Drive"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
                }

                NoteEditor {
                    id: noteEditor
                    anchors.fill: parent
                    visible: app.editingNote !== null
                    app: app
                    note: app.editingNote
                    // Opens with the same rise as a page.
                    transform: Translate { id: editorShift }
                    onVisibleChanged: if (visible) editorIn.restart()
                    ParallelAnimation {
                        id: editorIn
                        NumberAnimation { target: noteEditor; property: "opacity"; from: 0; to: 1; duration: 200 }
                        NumberAnimation { target: editorShift; property: "y"; from: 16; to: 0; duration: 340; easing.type: Easing.OutCubic }
                    }
                }

                // Service down
                Rectangle {
                    anchors.fill: parent
                    visible: !app.loaded
                    color: Theme.bg
                    ColumnLayout {
                        anchors.centerIn: parent
                        spacing: 14
                        Logo {
                            Layout.alignment: Qt.AlignHCenter; cell: 6; alive: true
                            SequentialAnimation on y { running: !app.loaded; loops: Animation.Infinite; NumberAnimation { to: -5; duration: 900; easing.type: Easing.InOutSine } NumberAnimation { to: 0; duration: 900; easing.type: Easing.InOutSine } }
                        }
                        Text { Layout.alignment: Qt.AlignHCenter; text: "Starting Hourglass…"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
                    }
                }
            }
        }

        // Signed out: the sign-in page is all there is.
        LoginPage {
            anchors.fill: parent
            app: app
            visible: app.loaded && (app.devLogin || (!!app.appState.account && !app.appState.account.signed_in))
        }
    }

    // --- overlays ------------------------------------------------------------------------

    EventDialog { id: eventDialog; app: app }
    CourseDialog { id: courseDialog; app: app }
    SessionDialog { id: sessionDialog; app: app }
    ConfirmDialog { id: confirmDialog }

    // Ringing alarm / timer
    Rectangle {
        id: ringOverlay
        anchors.fill: parent
        visible: app.appState.ringing && app.appState.ringing.length > 0
        color: Theme.alpha("#000000", 0.6)
        z: 100
        readonly property var item: visible ? app.appState.ringing[0] : null
        MouseArea { anchors.fill: parent }
        Rectangle {
            id: ringCard
            anchors.centerIn: parent
            width: 380
            height: ringCol.implicitHeight + 56
            NumberAnimation on scale { running: ringOverlay.visible; from: 0.8; to: 1; duration: 420; easing.type: Easing.OutBack; easing.overshoot: 2 }
            radius: 0
            color: Theme.surface
            border.color: Theme.accent
            border.width: 2
            ColumnLayout {
                id: ringCol
                anchors { fill: parent; margins: 28 }
                spacing: 12
                Logo {
                    Layout.alignment: Qt.AlignHCenter
                    cell: 7
                    SequentialAnimation on rotation { running: ringOverlay.visible; loops: Animation.Infinite; NumberAnimation { from: -8; to: 8; duration: 180 } NumberAnimation { from: 8; to: -8; duration: 180 } }
                }
                Text { Layout.alignment: Qt.AlignHCenter; text: ringOverlay.item && ringOverlay.item.kind === "timer" ? "TIME'S UP" : "ALARM"; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2 }
                Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: ringOverlay.item ? ringOverlay.item.label : ""; color: Theme.fg; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 22; font.weight: Font.DemiBold }
                Text { Layout.alignment: Qt.AlignHCenter; text: Util.clock(app.clock); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
                // A click snoozes; turning it off takes a 2-second hold, which a
                // half-asleep click does not do.
                Btn { Layout.topMargin: 8; Layout.fillWidth: true; Layout.preferredHeight: 48; text: "Snooze 5 min"; kind: "primary"; onClicked: Api.post("/api/ring/snooze?id=" + ringOverlay.item.id + "&minutes=5&via=" + encodeURIComponent("clicked Snooze in the window"), {}, () => app.pollState()) }
                Rectangle {
                    id: hold
                    Layout.fillWidth: true
                    Layout.preferredHeight: 38
                    color: "transparent"
                    border.color: Theme.border
                    border.width: 1
                    property real progress: 0
                    property bool hint: false
                    Rectangle { anchors { left: parent.left; top: parent.top; bottom: parent.bottom } width: parent.width * hold.progress; color: Theme.alpha(Theme.accent, 0.35) }
                    Text { anchors.centerIn: parent; text: hold.hint ? "Keep holding to dismiss" : "Hold to dismiss"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13 }
                    NumberAnimation on progress { id: fill; running: false; from: 0; to: 1; duration: 2000; onFinished: if (hold.progress >= 1) Api.post("/api/ring/stop?id=" + ringOverlay.item.id + "&via=" + encodeURIComponent("held Dismiss in the window"), {}, () => app.pollState()) }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onPressed: { hold.hint = false; fill.restart() }
                        onReleased: { if (hold.progress < 1) { fill.stop(); hold.progress = 0; hold.hint = true } }
                        onCanceled: { fill.stop(); hold.progress = 0 }
                    }
                    Connections { target: ringOverlay; function onItemChanged() { fill.stop(); hold.progress = 0; hold.hint = false } }
                }
            }
        }
    }

    // Wake check: rings again in 5 minutes unless "I'm up".
    Rectangle {
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
        height: 52
        z: 99
        visible: !!app.appState.wake_check && !ringOverlay.visible
        color: Theme.surface
        border.color: Theme.accent
        border.width: 1
        RowLayout {
            anchors { fill: parent; leftMargin: 18; rightMargin: 10 }
            Text { Layout.fillWidth: true; text: app.appState.wake_check ? "Wake check: " + app.appState.wake_check.label + " rings again at " + Util.clock(app.appState.wake_check.at) : ""; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
            Btn { text: "I'm up"; kind: "primary"; onClicked: Api.post("/api/ring/awake", {}, () => app.pollState()) }
        }
    }

    // Pixel bursts for finishing things (Motion.burstAt from any page).
    Item {
        id: fx
        anchors.fill: parent
        z: 150
        Connections {
            target: Motion
            function onBurst(x, y) { for (let i = 0; i < 16; i++) particle.createObject(fx, { x0: x, y0: y, i: i }); }
        }
        Component {
            id: particle
            Rectangle {
                id: px
                property real x0
                property real y0
                property int i
                readonly property real a: Math.PI * 2 * i / 16 + Math.random() * 0.5
                readonly property real v: 40 + Math.random() * 70
                width: 3 + Math.round(Math.random() * 4)
                height: width
                color: [Theme.gold, Theme.accent, Theme.fg, Theme.teal][i % 4]
                x: x0; y: y0
                ParallelAnimation {
                    running: true
                    onFinished: px.destroy()
                    NumberAnimation { target: px; property: "x"; to: px.x0 + Math.cos(px.a) * px.v * 1.15; duration: 850; easing.type: Easing.OutCubic }
                    SequentialAnimation {
                        NumberAnimation { target: px; property: "y"; to: px.y0 + Math.sin(px.a) * px.v - 30; duration: 380; easing.type: Easing.OutCubic }
                        NumberAnimation { target: px; property: "y"; to: px.y0 + Math.sin(px.a) * px.v + 40; duration: 470; easing.type: Easing.InQuad }
                    }
                    SequentialAnimation {
                        PauseAnimation { duration: 450 }
                        NumberAnimation { target: px; property: "opacity"; to: 0; duration: 400 }
                    }
                }
            }
        }
    }

    // Toast
    Rectangle {
        id: toast
        property string message: ""
        function show(m) { message = m; opacity = 1; toastTimer.restart(); }
        anchors { horizontalCenter: parent.horizontalCenter; bottom: parent.bottom; bottomMargin: 24 }
        width: Math.min(toastText.implicitWidth + 32, app.width - 48)
        height: toastText.implicitHeight + 20
        radius: 0
        color: Theme.surface2
        border.color: Theme.accent
        opacity: 0
        visible: opacity > 0
        z: 200
        Behavior on opacity { NumberAnimation { duration: 180 } }
        transform: Translate { y: (1 - toast.opacity) * 14 }
        Text { id: toastText; anchors.centerIn: parent; width: Math.min(implicitWidth, app.width - 80); text: toast.message; color: Theme.fg; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 14 }
        Timer { id: toastTimer; interval: 3500; onTriggered: toast.opacity = 0 }
    }
}
