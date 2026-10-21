import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs

// A Drive file's versions: every time its contents were replaced (an edit
// saved on a device, a restore) the old copy was kept, with who and which
// device and when. Each one can be compared with the file as it is now (a
// line-by-line diff for text, side by side for pictures), saved somewhere as
// a copy, or put back (what is there now is kept as a version too).
Modal {
    id: dlg
    property var page          // the Drive page: sizes, the file links
    property var f: null       // the file
    property var data: null    // the server's { current, versions, text, picture }
    property string problem: ""
    property string openDiff: "" // the version whose changes are showing
    property var diff: null
    width: Math.min(760, (parent ? parent.width : 760) - 48)
    title: f ? "Versions of " + f.name : "Versions"
    subtitle: "Each time it's saved, the copy before is kept (the last 20)."

    function ask(file) {
        f = file;
        data = null;
        problem = "";
        openDiff = "";
        diff = null;
        load();
        open();
    }
    function load() {
        Api.request("GET", "/api/files/" + f.id + "/versions", null, (d, err) => {
            if (err) { problem = err; return; }
            data = d;
        }, true);
    }
    function when(ms) { return ms ? Util.shortDate(Util.dayOf(ms)) + "  " + Util.clock(ms) : ""; }
    function who(v) { return [v.device, v.by].filter(x => !!x).join(" · ") || "unknown device"; }
    function showDiff(v) {
        if (openDiff === v.id) { openDiff = ""; return; }
        openDiff = v.id;
        diff = null;
        if (data.picture) return; // pictures: side by side, no request
        Api.request("GET", "/api/files/" + f.id + "/versions/" + v.id + "/diff", null, (d, err) => { diff = d || { kind: "error", error: err }; }, true);
    }
    function restore(v) {
        Api.request("POST", "/api/files/" + f.id + "/versions/" + v.id + "/restore", {}, (row, err) => {
            if (err) { problem = err; return; }
            page.app.showToast("Put back the version from " + when(v.at));
            openDiff = "";
            load();
            page.load();
        });
    }
    FileDialog {
        id: saver
        property var v: null
        title: "Save this version"
        fileMode: FileDialog.SaveFile
        onAccepted: Api.request("POST", "/api/files/" + dlg.f.id + "/versions/" + v.id + "/save", { path: selectedFile.toString() }, (d, err) => {
            if (err) dlg.problem = err; else dlg.page.app.showToast("Saved a copy of the version from " + dlg.when(v.at));
        }, true)
    }

    Text {
        visible: dlg.problem !== ""
        text: dlg.problem
        color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13
        Layout.fillWidth: true; wrapMode: Text.Wrap
    }
    Text {
        visible: !dlg.data && dlg.problem === ""
        text: "Reading the versions…"
        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
    }

    ScrollView {
        visible: !!dlg.data
        Layout.fillWidth: true
        Layout.preferredHeight: Math.min(480, list.implicitHeight)
        contentWidth: availableWidth
        clip: true
        ColumnLayout {
            id: list
            width: parent.width
            spacing: 0

            // Now
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: 8
                spacing: 12
                Rectangle {
                    implicitWidth: nowTag.implicitWidth + 14; implicitHeight: 22
                    color: Theme.alpha(Theme.teal, 0.18)
                    Text { id: nowTag; anchors.centerIn: parent; text: "NOW"; color: Theme.teal; font.family: Theme.mono; font.pixelSize: 11; font.weight: Font.Bold; font.letterSpacing: 1 }
                }
                Text {
                    Layout.fillWidth: true
                    text: dlg.data ? dlg.when(dlg.data.current.at) + "   " + dlg.page.size(dlg.data.current.size) + "   " + dlg.who(dlg.data.current)
                                     + (dlg.data.current.restored_from ? "   (put back from an older version)" : "") : ""
                    color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                }
            }
            Text {
                visible: !!dlg.data && dlg.data.versions.length === 0
                Layout.fillWidth: true
                wrapMode: Text.Wrap
                text: "No older versions yet. When this file is edited and saved again, the copy before is kept here."
                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
            }

            Repeater {
                model: dlg.data ? dlg.data.versions : []
                ColumnLayout {
                    id: vrow
                    required property var modelData
                    readonly property var v: modelData
                    readonly property bool showing: dlg.openDiff === v.id
                    Layout.fillWidth: true
                    spacing: 0
                    Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: 8
                        Layout.bottomMargin: 8
                        spacing: 8
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text { text: dlg.when(vrow.v.at) + "   " + dlg.page.size(vrow.v.size); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13 }
                            Text { Layout.fillWidth: true; text: dlg.who(vrow.v) + (vrow.v.restored_from ? "  ·  put back from an older version" : ""); color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 12 }
                        }
                        Btn { compact: true; kind: "subtle"; text: vrow.showing ? "Hide changes" : "What changed"; onClicked: dlg.showDiff(vrow.v) }
                        Btn { compact: true; kind: "subtle"; icon: "download"; tip: "Save a copy of this version"; onClicked: { saver.v = vrow.v; saver.selectedFile = saver.currentFolder + "/" + dlg.f.name; saver.open(); } }
                        Btn { compact: true; icon: "back"; text: "Restore"; tip: "Put this version back (what's there now is kept as a version)"; onClicked: dlg.restore(vrow.v) }
                    }

                    // What changed between this version and now.
                    Loader {
                        Layout.fillWidth: true
                        Layout.bottomMargin: 10
                        active: vrow.showing
                        visible: active
                        sourceComponent: dlg.data && dlg.data.picture ? pictures : changes
                        Component {
                            id: pictures
                            RowLayout {
                                spacing: 12
                                Repeater {
                                    model: [{ label: "THEN", src: dlg.page.info ? dlg.page.info.file_base + dlg.f.id + "?k=" + dlg.page.info.key + "&version=" + vrow.v.id : "" },
                                            { label: "NOW", src: dlg.page.src(dlg.f) }]
                                    ColumnLayout {
                                        required property var modelData
                                        Layout.fillWidth: true
                                        spacing: 4
                                        Text { text: parent.modelData.label; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11; font.weight: Font.Bold; font.letterSpacing: 1 }
                                        Rectangle {
                                            Layout.fillWidth: true
                                            Layout.preferredHeight: 220
                                            color: Theme.bg
                                            Image { anchors.fill: parent; anchors.margins: 4; source: parent.parent.modelData.src; fillMode: Image.PreserveAspectFit; asynchronous: true; sourceSize: Qt.size(640, 640) }
                                        }
                                    }
                                }
                            }
                        }
                        Component {
                            id: changes
                            Rectangle {
                                implicitHeight: Math.min(320, body.implicitHeight + 16)
                                color: Theme.bg
                                border.color: Theme.border
                                ScrollView {
                                    anchors.fill: parent
                                    anchors.margins: 8
                                    contentWidth: availableWidth
                                    clip: true
                                    ColumnLayout {
                                        id: body
                                        width: parent.width
                                        spacing: 0
                                        Text {
                                            visible: !dlg.diff || dlg.diff.kind !== "text" || dlg.diff.tooBig
                                            Layout.fillWidth: true
                                            wrapMode: Text.Wrap
                                            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12
                                            text: !dlg.diff ? "Comparing…"
                                                : dlg.diff.kind === "error" ? (dlg.diff.error || "Could not compare them.")
                                                : dlg.diff.kind === "binary" ? "This kind of file can't be compared line by line. Then: " + dlg.page.size(dlg.diff.before) + ", now: " + dlg.page.size(dlg.diff.after) + ". Save a copy to open it side by side."
                                                : "Too many changes to show here (" + dlg.diff.added + " lines in, " + dlg.diff.removed + " out)."
                                        }
                                        Text {
                                            visible: !!dlg.diff && dlg.diff.kind === "text" && !dlg.diff.tooBig
                                            text: dlg.diff && dlg.diff.kind === "text" ? "+" + dlg.diff.added + " lines   −" + dlg.diff.removed + " lines   (red: only then, green: only now)" : ""
                                            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11
                                            Layout.bottomMargin: 6
                                        }
                                        Repeater {
                                            model: dlg.diff && dlg.diff.kind === "text" && !dlg.diff.tooBig ? dlg.diff.lines : []
                                            Rectangle {
                                                required property var modelData
                                                Layout.fillWidth: true
                                                implicitHeight: line.implicitHeight + 2
                                                color: modelData.op === "add" ? Theme.alpha(Theme.teal, 0.20) : modelData.op === "del" ? Theme.alpha(Theme.accent, 0.20) : "transparent"
                                                Text {
                                                    id: line
                                                    width: parent.width - 8
                                                    x: 4
                                                    wrapMode: Text.WrapAnywhere
                                                    textFormat: Text.PlainText
                                                    text: parent.modelData.op === "skip" ? "⋯ " + parent.modelData.count + " lines the same" : (parent.modelData.op === "add" ? "+ " : parent.modelData.op === "del" ? "− " : "  ") + parent.modelData.text
                                                    color: parent.modelData.op === "skip" ? Theme.faint : Theme.fg
                                                    font.family: Theme.mono; font.pixelSize: 12
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
