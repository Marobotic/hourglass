import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Modal {
    id: dlg
    property var app
    property var course: null
    property string color: Util.palette[0]
    property var slots: []
    width: 600
    title: course ? "Edit course" : "New course"
    subtitle: course ? "" : "Add its weekly times now; you can change them later."

    function edit(c) {
        course = c;
        nameF.text = c ? c.name : "";
        codeF.text = c && c.code ? c.code : "";
        locF.text = c && c.location ? c.location : "";
        teacherF.text = c && c.teacher ? c.teacher : "";
        const used = app.courses.map(x => x.color);
        color = c ? c.color : (Util.palette.find(p => used.indexOf(p) < 0) || Util.palette[0]);
        slots = c ? [] : [{ day: 2, start: Util.t("09:00"), end: Util.t("11:00"), kind: "lecture" }];
        untilF.text = "";
        open();
        nameF.forceActiveFocus();
    }
    function setSlot(i, key, v) { const s = slots.slice(); s[i] = Object.assign({}, s[i]); s[i][key] = v; slots = s; }

    readonly property bool slotsValid: slots.every(s => Util.isTime(s.start) && Util.isTime(s.end) && Util.minutes(s.end) > Util.minutes(s.start))
    readonly property bool valid: nameF.text.trim() !== "" && slotsValid && (untilF.text === "" || Util.isDate(untilF.text))

    function save() {
        const base = { name: nameF.text.trim(), code: codeF.text.trim() || undefined, location: locF.text.trim() || undefined, teacher: teacherF.text.trim() || undefined, color: color };
        if (course) Api.action("update_course", Object.assign({ course: course.id }, base), r => { if (r) dlg.close(); });
        else Api.action("add_course", Object.assign(base, {
            schedule: slots.map(s => ({ day: s.day, start: Util.parseTime(s.start), end: Util.parseTime(s.end), kind: s.kind })),
            term_end: untilF.text || undefined
        }), r => { if (r) dlg.close(); });
    }

    component Label: Text { color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.letterSpacing: 0.8 }

    GridLayout {
        Layout.fillWidth: true
        columns: 2
        columnSpacing: 12
        rowSpacing: 6
        Label { text: "NAME" }
        Label { text: "CODE" }
        Field { id: nameF; Layout.fillWidth: true; placeholderText: "e.g. Algorithms" }
        Field { id: codeF; Layout.preferredWidth: 150; placeholderText: "CS201" }
        Label { Layout.topMargin: 6; text: "DEFAULT ROOM" }
        Label { Layout.topMargin: 6; text: "LECTURER" }
        Field { id: locF; Layout.fillWidth: true; placeholderText: "Optional" }
        Field { id: teacherF; Layout.preferredWidth: 150; placeholderText: "Optional" }
    }

    ColumnLayout {
        spacing: 8
        Label { text: "COLOUR" }
        RowLayout {
            spacing: 8
            Repeater {
                model: Util.palette
                Rectangle {
                    required property string modelData
                    width: 26; height: 26; radius: 0
                    color: modelData
                    border.width: dlg.color === modelData ? 2 : 0
                    border.color: Theme.fg
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: dlg.color = parent.modelData }
                }
            }
        }
    }

    ColumnLayout {
        visible: !dlg.course
        Layout.fillWidth: true
        spacing: 8
        Label { text: "WEEKLY TIMES" }
        Repeater {
            model: dlg.slots
            RowLayout {
                required property var modelData
                required property int index
                spacing: 8
                Picker { Layout.preferredWidth: 90; options: Util.weekdays.map((w, i) => ({ label: w, value: i + 1 })); value: modelData.day; onPicked: v => dlg.setSlot(index, "day", v) }
                Field { Layout.preferredWidth: 110; text: modelData.start; invalid: !Util.isTime(text); onTextEdited: dlg.setSlot(index, "start", text) }
                Text { text: "–"; color: Theme.muted; font.family: Theme.mono }
                Field { Layout.preferredWidth: 110; text: modelData.end; invalid: !Util.isTime(text) || (Util.isTime(modelData.start) && Util.minutes(text) <= Util.minutes(modelData.start)); onTextEdited: dlg.setSlot(index, "end", text) }
                Picker { Layout.fillWidth: true; options: Util.kinds.slice(0, 4).map(k => ({ label: Util.kindLabel(k), value: k })); value: modelData.kind; onPicked: v => dlg.setSlot(index, "kind", v) }
                Btn { icon: "close"; kind: "subtle"; compact: true; onClicked: { const s = dlg.slots.slice(); s.splice(index, 1); dlg.slots = s; } }
            }
        }
        RowLayout {
            spacing: 10
            Btn { icon: "plus"; text: "Add a time"; compact: true; onClicked: dlg.slots = dlg.slots.concat([{ day: 4, start: Util.t("14:00"), end: Util.t("15:00"), kind: "lab" }]) }
            Item { Layout.fillWidth: true }
            Label { text: "TERM ENDS" }
            Field { id: untilF; Layout.preferredWidth: 140; placeholderText: "YYYY-MM-DD"; invalid: text !== "" && !Util.isDate(text) }
        }
    }

    footer: [
        Btn {
            visible: !!dlg.course
            icon: "trash"; kind: "danger"; text: "Delete course"
            onClicked: dlg.app.confirm("Delete " + dlg.course.name + "?", "Its sessions are removed from the calendar. Notes are kept in the inbox.", "Delete",
                () => Api.action("remove_course", { course: dlg.course.id }, () => dlg.close()))
        },
        Item { Layout.fillWidth: true },
        Btn { text: "Cancel"; onClicked: dlg.close() },
        Btn { kind: "primary"; text: dlg.course ? "Save" : "Add course"; enabled: dlg.valid; onClicked: dlg.save() }
    ]
}
