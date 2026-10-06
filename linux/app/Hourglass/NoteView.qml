import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// A note as it reads: Markdown with headings, **bold**, *italic*,
// <u>underline</u> and lists, to-dos with boxes to tick, and its pictures and
// files. An attachment on a
// line of its own is drawn as a picture (scaled to fit) or a file chip;
// "hgfile:<id>" points at a Drive file.
ColumnLayout {
    id: view
    property string text: ""
    property var app
    spacing: 10

    // Ticking a box: the line of the note it is on. The editor rewrites that line.
    signal toggleTask(int line)
    // A double-click on the text: the editor switches to editing.
    signal editRequested()

    // { file_base, key } from the service: how this window loads Drive files.
    property var info: null
    Component.onCompleted: Api.get("/api/drive/info", d => { if (d) view.info = d; })

    readonly property var blocks: {
        const out = [];
        let md = [];
        let tasks = null; // consecutive to-do lines share one block
        const flush = () => {
            if (md.join("").trim()) out.push({ kind: "md", text: md.join("\n") });
            md = [];
            if (tasks) out.push({ kind: "tasks", items: tasks });
            tasks = null;
        };
        const lines = (text || "").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const img = /^\s*!\[([^\]]*)\]\(hgfile:([0-9a-f-]{36})\)\s*$/.exec(line);
            const file = /^\s*\[([^\]]*)\]\(hgfile:([0-9a-f-]{36})\)\s*$/.exec(line);
            const task = Util.taskRe.exec(line);
            if (task) {
                if (md.length) { const keep = tasks; tasks = null; flush(); tasks = keep; }
                tasks = tasks || [];
                tasks.push({ line: i, done: task[2] !== " ", text: task[3], indent: task[1].length });
            }
            else if (img) { flush(); out.push({ kind: "image", name: img[1], id: img[2] }); }
            else if (file) { flush(); out.push({ kind: "file", name: file[1].replace(/^📎\s*/, ""), id: file[2] }); }
            else {
                if (tasks) { const keep = md; md = []; flush(); md = keep; }
                md.push(line);
            }
        }
        flush();
        return out;
    }

    function open(id) {
        Api.get("/api/files/" + id + "/local", d => { if (d) Qt.openUrlExternally(d.url); });
    }

    Repeater {
        model: view.blocks
        Loader {
            required property var modelData
            Layout.fillWidth: true
            sourceComponent: modelData.kind === "md" ? mdC : modelData.kind === "tasks" ? tasksC : modelData.kind === "image" ? imgC : fileC
            property var block: modelData
        }
    }

    Component {
        id: mdC
        Text {
            id: mt
            readonly property var b: parent ? parent.block : ({})
            text: b.text || ""
            textFormat: Text.MarkdownText
            wrapMode: Text.Wrap
            color: Theme.fg
            linkColor: Theme.accent
            font.family: Theme.sans
            font.pixelSize: 15
            lineHeight: 1.25
            onLinkActivated: link => link.startsWith("hgfile:") ? view.open(link.slice(7)) : Qt.openUrlExternally(link)
            HoverHandler { cursorShape: mt.hoveredLink ? Qt.PointingHandCursor : Qt.ArrowCursor }
            TapHandler { onDoubleTapped: view.editRequested() }
        }
    }
    // To-dos: a box to tick, then the item. Done items are struck through.
    Component {
        id: tasksC
        Column {
            readonly property var b: parent ? parent.block : ({ items: [] })
            spacing: 6
            Repeater {
                model: parent ? parent.b.items : []
                Row {
                    id: tr
                    required property var modelData
                    leftPadding: modelData.indent * 8
                    spacing: 10
                    Rectangle {
                        id: box
                        y: (itemText.font.pixelSize * 1.25 - height) / 2 + 1
                        width: 18; height: 18
                        color: tr.modelData.done ? Theme.accent : boxMouse.containsMouse ? Theme.surface2 : "transparent"
                        border.width: tr.modelData.done ? 0 : 1
                        border.color: boxMouse.containsMouse ? Theme.accent : Theme.muted
                        Icon { anchors.centerIn: parent; visible: tr.modelData.done; name: "check"; size: 12; color: Theme.accentInk }
                        MouseArea { id: boxMouse; anchors.fill: parent; anchors.margins: -4; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: view.toggleTask(tr.modelData.line) }
                    }
                    Text {
                        id: itemText
                        width: view.width - tr.leftPadding - box.width - tr.spacing
                        text: tr.modelData.text || " "
                        textFormat: Text.MarkdownText
                        wrapMode: Text.Wrap
                        color: tr.modelData.done ? Theme.muted : Theme.fg
                        font.strikeout: tr.modelData.done
                        font.family: Theme.sans
                        font.pixelSize: 15
                        lineHeight: 1.25
                        TapHandler { onDoubleTapped: view.editRequested() }
                    }
                }
            }
        }
    }
    Component {
        id: imgC
        Item {
            id: ir
            readonly property var b: parent ? parent.block : ({})
            implicitHeight: im.status === Image.Ready ? im.height : 40
            Image {
                id: im
                // As big as it is, at most the column's width and 480 px tall.
                readonly property real k: sourceSize.width > 0 ? Math.min(1, ir.width / sourceSize.width, 480 / sourceSize.height) : 1
                width: sourceSize.width * k
                height: status === Image.Ready ? sourceSize.height * k : 0
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                source: view.info && ir.b.id ? view.info.file_base + ir.b.id + "?k=" + view.info.key : ""
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: view.open(ir.b.id) }
            }
            Text {
                visible: im.status !== Image.Ready
                anchors.verticalCenter: parent.verticalCenter
                text: (im.status === Image.Error ? "Picture not available: " : "Loading ") + (ir.b.name || "picture") + (im.status === Image.Error ? "" : "…")
                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
            }
        }
    }
    Component {
        id: fileC
        Item {
            id: fr
            readonly property var b: parent ? parent.block : ({})
            implicitHeight: 40
            Rectangle {
                width: Math.min(fr.width, chip.implicitWidth + 28)
                height: 40
                color: fm.containsMouse ? Theme.surface2 : Theme.surface
                border.width: 1
                border.color: Theme.border
                RowLayout {
                    id: chip
                    anchors { left: parent.left; leftMargin: 14; verticalCenter: parent.verticalCenter }
                    spacing: 10
                    Icon { name: "clip"; size: 14; color: Theme.muted }
                    Text { text: fr.b.name || "file"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14 }
                }
                MouseArea { id: fm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: view.open(fr.b.id) }
            }
        }
    }
}
