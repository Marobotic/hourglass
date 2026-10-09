import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Modal {
    id: dlg
    property var app
    property var ev: null
    property string repeat: "none" // none | daily | weekly | monthly | yearly
    property var days: []
    property bool forever: true    // false: the series ends on untilF's date
    property var courseId: null
    property string kind: "lecture"
    width: 560
    title: ev ? "Edit event" : "New event"
    subtitle: ev && ev.repeat ? "Changes apply to every session of this series." : ""

    function edit(e, defaults) {
        ev = e;
        const d = defaults || {};
        const today = app.nowData ? app.nowData.now.date : Util.fmt(Date.now());
        titleF.text = e ? e.title : "";
        courseId = e ? e.course_id : (d.course || null);
        kind = e ? e.kind : (courseId ? "lecture" : "event");
        dateF.text = e ? e.start_date : (d.date || today);
        startF.text = Util.t(e ? e.start_time : (d.start || "09:00"));
        endF.text = Util.t(e ? e.end_time : (d.end || "10:00"));
        locF.text = e && e.location ? e.location : "";
        repeat = e ? (e.repeat ? e.repeat.freq : "none") : (d.repeatWeekly ? "weekly" : "none");
        days = e && e.repeat && e.repeat.days ? e.repeat.days.slice() : [Util.isoWeekday(dateF.text)];
        untilF.text = e && e.repeat && e.repeat.until ? e.repeat.until : "";
        forever = untilF.text === "";
        open();
    }

    readonly property bool valid: Util.isDate(dateF.text) && Util.isTime(startF.text) && Util.isTime(endF.text)
        && Util.minutes(endF.text) > Util.minutes(startF.text) && (titleF.text.trim() !== "" || courseId !== null)
        && (repeat === "none" || forever || (Util.isDate(untilF.text) && untilF.text >= dateF.text))
        && (repeat !== "weekly" || days.length > 0)
    // What the series will be, as the schedule lists it: "Yearly on 2 Nov", "Every Tue until ..."
    readonly property string summary: repeat === "none" || !Util.isDate(dateF.text) ? ""
        : Util.repeatText({ start_date: dateF.text, repeat: { freq: repeat, days: repeat === "weekly" ? days : undefined,
                                                               until: !forever && Util.isDate(untilF.text) ? untilF.text : undefined } })

    function save() {
        const args = {
            title: titleF.text.trim(),
            course: courseId,
            kind: kind,
            date: dateF.text,
            start: Util.parseTime(startF.text),
            end: Util.parseTime(endF.text),
            location: locF.text.trim() || undefined,
            repeat: repeat === "none" ? null : { freq: repeat, days: repeat === "weekly" ? days : undefined, until: forever ? undefined : untilF.text }
        };
        // Times are fixed in the event's zone; an old event without one takes the app's.
        if (ev) Api.action("update_event", Object.assign({ event_id: ev.id }, args, ev.tz ? {} : { tz: dlg.app.nowData ? dlg.app.nowData.now.tz : undefined }), r => { if (r) dlg.close(); });
        else {
            if (!args.repeat) delete args.repeat;
            if (!args.course) delete args.course;
            Api.action("add_event", args, r => { if (r) dlg.close(); });
        }
    }

    component Label: Text { color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.letterSpacing: 0.8 }

    GridLayout {
        Layout.fillWidth: true
        columns: 2
        columnSpacing: 12
        rowSpacing: 6

        Label { text: "COURSE" }
        Label { text: "KIND" }
        Picker { Layout.fillWidth: true; options: dlg.app ? dlg.app.courseOptions(true) : []; value: dlg.courseId; onPicked: v => dlg.courseId = v }
        Picker { Layout.fillWidth: true; options: Util.kinds.map(k => ({ label: Util.kindLabel(k), value: k })); value: dlg.kind; onPicked: v => dlg.kind = v }

        Label { Layout.columnSpan: 2; Layout.topMargin: 6; text: dlg.courseId ? "TITLE (OPTIONAL, DEFAULTS TO THE COURSE)" : "TITLE" }
        Field { id: titleF; Layout.columnSpan: 2; Layout.fillWidth: true; placeholderText: dlg.courseId ? "e.g. Lab" : "e.g. Dentist" }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 12
        ColumnLayout { spacing: 6; Label { text: dlg.repeat === "none" ? "DATE" : "FIRST DATE" } Field { id: dateF; Layout.preferredWidth: 140; placeholderText: "YYYY-MM-DD"; invalid: !Util.isDate(text) } }
        ColumnLayout { spacing: 6; Label { text: "START" } Field { id: startF; Layout.preferredWidth: 120; invalid: !Util.isTime(text) } }
        ColumnLayout { spacing: 6; Label { text: "END" } Field { id: endF; Layout.preferredWidth: 120; invalid: !Util.isTime(text) || (Util.isTime(startF.text) && Util.minutes(text) <= Util.minutes(startF.text)) } }
        ColumnLayout { spacing: 6; Layout.fillWidth: true; Label { text: "ROOM" } Field { id: locF; Layout.fillWidth: true; placeholderText: "Optional" } }
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: 8
        Label { text: "REPEAT" }
        RowLayout {
            spacing: 6
            Repeater {
                model: [{ l: "Once", v: "none" }, { l: "Daily", v: "daily" }, { l: "Weekly", v: "weekly" }, { l: "Monthly", v: "monthly" }, { l: "Yearly", v: "yearly" }]
                Btn { required property var modelData; compact: true; kind: "subtle"; text: modelData.l; active: dlg.repeat === modelData.v; onClicked: dlg.repeat = modelData.v }
            }
        }
        DayToggles { visible: dlg.repeat === "weekly"; days: dlg.days; onToggled: d => dlg.days = d }
        RowLayout {
            visible: dlg.repeat !== "none"
            spacing: 6
            Label { text: "ENDS"; Layout.rightMargin: 8 }
            Btn { compact: true; kind: "subtle"; text: "Never"; active: dlg.forever; onClicked: dlg.forever = true }
            Btn {
                compact: true; kind: "subtle"; text: "On a date"; active: !dlg.forever
                onClicked: { dlg.forever = false; untilF.forceActiveFocus(); }
            }
            Field {
                id: untilF
                visible: !dlg.forever
                Layout.leftMargin: 6
                Layout.preferredWidth: 140
                placeholderText: "YYYY-MM-DD"
                invalid: !Util.isDate(text) || (Util.isDate(dateF.text) && text < dateF.text)
            }
        }
        Text {
            visible: dlg.summary !== ""
            text: dlg.summary
            color: Theme.faint
            font.family: Theme.mono
            font.pixelSize: 13
        }
    }

    footer: [
        Btn {
            visible: !!dlg.ev
            icon: "trash"; kind: "danger"; text: dlg.ev && dlg.ev.repeat ? "Delete series" : "Delete"
            onClicked: dlg.app.confirm(dlg.ev.repeat ? "Delete every session?" : "Delete event?",
                dlg.ev.repeat ? "This removes the whole series. To skip one date, open that session and choose Skip." : "This event will be removed from every device.",
                "Delete", () => Api.action("remove_event", { event_id: dlg.ev.id, scope: "series" }, () => dlg.close()))
        },
        Item { Layout.fillWidth: true },
        Btn { text: "Cancel"; onClicked: dlg.close() },
        Btn { kind: "primary"; text: dlg.ev ? "Save" : "Add event"; enabled: dlg.valid; onClicked: dlg.save() }
    ]
}
