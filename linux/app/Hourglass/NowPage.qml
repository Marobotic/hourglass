import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: page
    property var app
    readonly property var d: app.nowData
    readonly property var sess: d ? d.focus : null
    readonly property var notes: d ? d.notes : null
    readonly property bool wide: width > 900

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        GridLayout {
            width: parent.width
            columns: page.wide ? 2 : 1
            columnSpacing: 28
            rowSpacing: page.wide ? 28 : 22

            // ---------------- left: header, hero, notes ----------------
            ColumnLayout {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignTop
                Layout.margins: 32
                Layout.rightMargin: page.wide ? 0 : 32
                Layout.bottomMargin: page.wide ? 32 : 0
                spacing: 22

                // Header
                RowLayout {
                    Layout.fillWidth: true
                    ColumnLayout {
                        spacing: 2
                        Text { text: page.d ? Util.long(page.d.now.date) : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                        Text { text: Util.clock(page.app.clock); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 38; font.weight: Font.Bold }
                    }
                    Item { Layout.fillWidth: true }
                    Btn { icon: "note"; text: "New note"; onClicked: page.app.newNote({}) }
                }

                // Hero: the session in focus
                Card {
                    id: hero
                    visible: !!page.sess
                    Layout.fillWidth: true
                    implicitHeight: heroCol.implicitHeight + 44
                    stripe: page.sess ? page.sess.color : "transparent"
                    readonly property var f: page.sess
                    readonly property bool live: f && f.state === "live"
                    readonly property real progress: f ? Math.min(1, Math.max(0, (page.app.clock - f.start_ms) / (f.end_ms - f.start_ms))) : 0
                    readonly property int leftMin: f ? Math.max(0, Math.ceil((f.end_ms - page.app.clock) / 60000)) : 0
                    readonly property int inMin: f ? Math.max(0, Math.ceil((f.start_ms - page.app.clock) / 60000)) : 0

                    ColumnLayout {
                        id: heroCol
                        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 22; leftMargin: 26 }
                        spacing: 10

                        RowLayout {
                            spacing: 8
                            Rectangle {
                                visible: hero.live
                                width: 8; height: 8; radius: 4; color: Theme.accent
                                SequentialAnimation on opacity { running: hero.live; loops: Animation.Infinite; NumberAnimation { to: 0.25; duration: 900 } NumberAnimation { to: 1; duration: 900 } }
                            }
                            Text {
                                text: !hero.f ? "" : hero.live ? "LIVE NOW" : hero.f.state === "ended" ? "JUST ENDED" : "UP NEXT"
                                color: hero.live ? Theme.accent : Theme.muted
                                font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 1.6
                            }
                            Chip { text: hero.f ? Util.kindLabel(hero.f.kind) : ""; tint: hero.f ? hero.f.color : Theme.muted }
                            Item { Layout.fillWidth: true }
                            Text { text: hero.f ? hero.f.start_time + " – " + hero.f.end_time : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                        }

                        Text {
                            Layout.fillWidth: true
                            text: hero.f ? hero.f.title : ""
                            color: Theme.fg
                            wrapMode: Text.Wrap
                            font.family: Theme.mono; font.pixelSize: 30; font.weight: Font.Bold
                        }

                        RowLayout {
                            spacing: 16
                            RowLayout {
                                visible: !!(hero.f && hero.f.location)
                                spacing: 6
                                Icon { name: "place"; size: 13; color: Theme.muted }
                                Text { text: hero.f && hero.f.location ? hero.f.location : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                            }
                            Text { visible: !!(hero.f && hero.f.course_code); text: hero.f && hero.f.course_code ? hero.f.course_code : ""; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14 }
                        }
                        RowLayout {
                            visible: !!(hero.f && hero.f.teacher)
                            spacing: 6
                            Icon { name: "person"; size: 13; color: Theme.muted }
                            Text { Layout.fillWidth: true; text: hero.f && hero.f.teacher ? hero.f.teacher : ""; color: Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 14 }
                        }

                        // progress
                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.topMargin: 6
                            spacing: 6
                            Rectangle {
                                Layout.fillWidth: true
                                height: 6; radius: 3
                                color: Theme.surface2
                                Rectangle {
                                    width: parent.width * (hero.live ? hero.progress : 0)
                                    height: parent.height; radius: 3
                                    color: hero.f ? hero.f.color : Theme.accent
                                    Behavior on width { NumberAnimation { duration: 400 } }
                                }
                            }
                            Text {
                                text: !hero.f ? "" : hero.live ? Util.left(hero.leftMin) : hero.f.state === "ended" ? "Ended " + hero.f.end_time + ". Good time to tidy your notes." : "Starts " + Util.relative(hero.inMin)
                                color: Theme.muted
                                font.family: Theme.mono; font.pixelSize: 13
                            }
                        }

                        RowLayout {
                            Layout.topMargin: 6
                            spacing: 8
                            Btn {
                                kind: "primary"
                                icon: "note"
                                text: page.notes && page.notes.session.length ? "Open today's note" : "Start today's note"
                                onClicked: page.app.sessionNote(hero.f, page.notes.session)
                            }
                            Btn { icon: "timer"; text: "Timer"; onClicked: page.app.go(3) }
                            Btn { icon: "folder-open"; text: "Session"; onClicked: page.app.openSession(hero.f) }
                        }
                    }
                }

                // Free time / next up / empty
                Card {
                    visible: !page.sess
                    Layout.fillWidth: true
                    implicitHeight: freeCol.implicitHeight + 44
                    readonly property var nx: page.d ? page.d.next : null
                    ColumnLayout {
                        id: freeCol
                        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 22 }
                        spacing: 10
                        Text {
                            text: page.app.courses.length ? "Nothing on right now" : "Welcome to Hourglass"
                            color: Theme.fg; font.family: Theme.mono; font.pixelSize: 22; font.weight: Font.Bold
                        }
                        Text {
                            Layout.fillWidth: true
                            wrapMode: Text.Wrap
                            text: parent.parent.nx
                                ? "Next: " + parent.parent.nx.title + ", " + Util.short(parent.parent.nx.date) + " at " + parent.parent.nx.start_time + " (" + Util.relative(Math.ceil((parent.parent.nx.start_ms - page.app.clock) / 60000)) + ")"
                                : page.app.courses.length ? "Nothing scheduled in the next 7 days." : "Add your courses and their weekly times. During each lecture, its notes open right here."
                            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
                        }
                        RowLayout {
                            Layout.topMargin: 4
                            spacing: 8
                            Btn { visible: !page.app.courses.length; kind: "primary"; icon: "plus"; text: "Add a course"; onClicked: page.app.editCourse(null) }
                            Btn { visible: !!parent.parent.parent.nx; icon: "folder-open"; text: "Open next session"; onClicked: page.app.openSession(parent.parent.parent.nx) }
                            Btn { icon: "calendar-plus"; text: "Add event"; onClicked: page.app.editEvent(null) }
                        }
                    }
                }

                // Surfaced notes
                ColumnLayout {
                    visible: !!page.sess
                    Layout.fillWidth: true
                    spacing: 10
                    Section { Layout.fillWidth: true; text: "This session"; detail: page.sess ? Util.short(page.sess.date) : "" }
                    Repeater {
                        model: page.notes ? page.notes.session : []
                        NoteCard { required property var modelData; Layout.fillWidth: true; note: modelData; onClicked: page.app.openNote(modelData) }
                    }
                    Text {
                        visible: page.notes && !page.notes.session.length
                        text: "No notes yet for this session. Press n to start one."
                        color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
                    }
                }
                ColumnLayout {
                    visible: !!(page.notes && page.notes.pinned.length)
                    Layout.fillWidth: true
                    spacing: 10
                    Section { Layout.fillWidth: true; text: "Pinned" }
                    Repeater {
                        model: page.notes ? page.notes.pinned : []
                        NoteCard { required property var modelData; Layout.fillWidth: true; note: modelData; onClicked: page.app.openNote(modelData) }
                    }
                }
                ColumnLayout {
                    visible: !!(page.notes && page.notes.last.length)
                    Layout.fillWidth: true
                    spacing: 10
                    Section { Layout.fillWidth: true; text: "Last time"; detail: page.notes && page.notes.last_date ? Util.short(page.notes.last_date) : "" }
                    Repeater {
                        model: page.notes ? page.notes.last : []
                        NoteCard { required property var modelData; Layout.fillWidth: true; note: modelData; onClicked: page.app.openNote(modelData) }
                    }
                }
            }

            // ---------------- right: today, timers, alarms ----------------
            ColumnLayout {
                Layout.alignment: Qt.AlignTop
                Layout.preferredWidth: page.wide ? 330 : -1
                Layout.fillWidth: !page.wide
                Layout.topMargin: page.wide ? 32 : 0
                Layout.rightMargin: 32
                Layout.leftMargin: page.wide ? 0 : 32
                Layout.bottomMargin: 32
                spacing: 14

                Section { Layout.fillWidth: true; text: "Today" }
                Text {
                    visible: page.d && !page.d.today.length
                    text: "Nothing scheduled today."
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
                }
                Repeater {
                    model: page.d ? page.d.today : []
                    Rectangle {
                        required property var modelData
                        readonly property bool past: page.app.clock >= modelData.end_ms
                        readonly property bool live: page.app.clock >= modelData.start_ms && !past
                        Layout.fillWidth: true
                        height: 52
                        radius: Theme.radius
                        color: live ? Theme.alpha(modelData.color, 0.13) : rowMouse.containsMouse ? Theme.surface : "transparent"
                        opacity: past ? 0.5 : 1
                        RowLayout {
                            anchors { fill: parent; leftMargin: 10; rightMargin: 10 }
                            spacing: 12
                            ColumnLayout {
                                spacing: 0
                                Text { text: modelData.start_time; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14; font.weight: Font.DemiBold }
                                Text { text: modelData.end_time; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
                            }
                            Rectangle { width: 3; Layout.fillHeight: true; Layout.topMargin: 9; Layout.bottomMargin: 9; radius: 2; color: modelData.color }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 1
                                Text { Layout.fillWidth: true; text: modelData.title; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                                Text { Layout.fillWidth: true; text: Util.kindLabel(modelData.kind) + (modelData.location ? " · " + modelData.location : ""); color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
                            }
                            Text { visible: parent.parent.live; text: "●"; color: Theme.accent; font.pixelSize: 12 }
                        }
                        MouseArea { id: rowMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openSession(modelData) }
                    }
                }

                Section { Layout.fillWidth: true; Layout.topMargin: 12; text: "Timers" }
                Repeater {
                    model: page.d ? page.d.timers : []
                    Card {
                        required property var modelData
                        readonly property int remain: modelData.state === "running" ? Math.max(0, Math.ceil((modelData.ends_at - page.app.clock) / 1000)) : (modelData.remaining_s || 0)
                        Layout.fillWidth: true
                        implicitHeight: 56
                        RowLayout {
                            anchors { fill: parent; leftMargin: 14; rightMargin: 8 }
                            spacing: 10
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 0
                                Text { text: Util.countdown(parent.parent.parent.remain); color: modelData.state === "paused" ? Theme.muted : Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
                                Text { Layout.fillWidth: true; text: modelData.label; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
                            }
                            Btn { compact: true; kind: "subtle"; icon: modelData.state === "running" ? "pause" : "play"; onClicked: Api.action("update_timer", { timer_id: modelData.id, action: modelData.state === "running" ? "pause" : "resume" }) }
                            Btn { compact: true; kind: "subtle"; icon: "close"; onClicked: Api.action("update_timer", { timer_id: modelData.id, action: "stop" }) }
                        }
                    }
                }
                Flow {
                    Layout.fillWidth: true
                    spacing: 6
                    Repeater {
                        model: [5, 10, 25, 50]
                        Btn { required property int modelData; compact: true; text: modelData + " min"; onClicked: page.app.startTimer(modelData, page.sess && page.sess.state === "live" ? page.sess.title : "") }
                    }
                }

                Section { Layout.fillWidth: true; Layout.topMargin: 12; text: "Alarms" }
                Text {
                    visible: page.d && !page.d.alarms.length
                    text: "No alarms set."
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
                }
                Repeater {
                    model: page.d ? page.d.alarms : []
                    RowLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        spacing: 10
                        Icon { name: "bell"; size: 13; color: Theme.gold }
                        Text { text: Util.clock(modelData.next_at); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14; font.weight: Font.DemiBold }
                        Text { Layout.fillWidth: true; text: modelData.label; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
                        Text { text: Util.short(Util.dayOf(modelData.next_at)).slice(0, 3); color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
                    }
                }
            }
        }
    }
}
