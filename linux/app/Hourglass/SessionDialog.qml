import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// One occurrence: its notes, and actions scoped to this date.
Modal {
    id: dlg
    property var app
    property var occ: null
    property var notes: []
    width: 560
    title: occ ? occ.title : ""
    subtitle: occ ? Util.long(occ.date) + "  ·  " + occ.start_time + " – " + occ.end_time + (occ.location ? "  ·  " + occ.location : "") : ""

    function show(o) {
        occ = o;
        notes = [];
        load();
        open();
    }
    function load() {
        if (!occ || !occ.course_id) return;
        Api.action("get_notes", { course: occ.course_id, date: occ.date }, d => { if (d) dlg.notes = d; });
    }
    Connections { target: Api; function onChanged() { if (dlg.visible) dlg.load(); } }

    RowLayout {
        spacing: 8
        Chip { text: dlg.occ ? Util.kindLabel(dlg.occ.kind) : ""; tint: dlg.occ ? dlg.occ.color : Theme.muted }
        Chip { visible: !!(dlg.occ && dlg.occ.course_code); text: dlg.occ && dlg.occ.course_code ? dlg.occ.course_code : ""; tint: Theme.muted }
    }

    Repeater {
        model: dlg.occ && dlg.occ.teacher ? dlg.occ.teacher.split(",").map(t => t.trim()).filter(t => t) : []
        RowLayout {
            required property string modelData
            spacing: 10
            Icon { name: "person"; size: 13; color: Theme.muted }
            Text { text: modelData; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14 }
        }
    }

    ColumnLayout {
        visible: !!(dlg.occ && dlg.occ.course_id)
        Layout.fillWidth: true
        spacing: 8
        Section { Layout.fillWidth: true; text: "Notes for this session" }
        Repeater {
            model: dlg.notes
            NoteCard { required property var modelData; Layout.fillWidth: true; note: modelData; onClicked: { dlg.close(); dlg.app.openNote(modelData); } }
        }
        Text { visible: !dlg.notes.length; text: "None yet."; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
        Btn {
            kind: "primary"; icon: "note"
            text: dlg.notes.length ? "Add another note" : "Start a note for this session"
            onClicked: { dlg.close(); dlg.app.newNote({ course: dlg.occ.course_id, date: dlg.occ.date, title: Util.short(dlg.occ.date) + (dlg.notes.length ? " (" + (dlg.notes.length + 1) + ")" : "") }); }
        }
    }

    footer: [
        Btn {
            icon: "close"; kind: "danger"; text: "Skip this date"
            onClicked: dlg.app.confirm("Skip " + Util.short(dlg.occ.date) + "?", "Only this session is removed. The rest of the series stays.", "Skip",
                () => Api.action("remove_event", { event_id: dlg.occ.event_id, scope: "occurrence", date: dlg.occ.date }, () => dlg.close()))
        },
        Item { Layout.fillWidth: true },
        Btn { icon: "edit"; text: "Edit event"; onClicked: Api.get("/api/events/" + dlg.occ.event_id, e => { if (e) { dlg.close(); dlg.app.editEvent(e); } }) },
        Btn { text: "Close"; onClicked: dlg.close() }
    ]
}
