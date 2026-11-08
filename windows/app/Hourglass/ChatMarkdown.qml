import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "ChatMarkdown.js" as Markdown

Column {
    id: rendered
    property string text: ""
    property bool plain: false
    property bool hardBreaks: false // the assistant's lines are meant as lines
    signal copyRequested(string text)
    spacing: 8
    Repeater {
        model: rendered.plain ? [{ kind: "plain", text: rendered.text, rows: [], language: "" }] : Markdown.blocks(rendered.text)
        delegate: Column {
            id: block
            required property var modelData
            width: rendered.width
            TextEdit {
                width: parent.width
                visible: block.modelData.kind === "text" || block.modelData.kind === "plain"
                height: visible ? implicitHeight : 0
                readOnly: true; selectByMouse: true
                text: rendered.hardBreaks && !rendered.plain ? block.modelData.text.replace(/([^\n])\n(?=[^\n])/g, "$1  \n") : block.modelData.text
                textFormat: rendered.plain ? TextEdit.PlainText : TextEdit.MarkdownText
                wrapMode: TextEdit.Wrap
                color: Theme.fg; selectedTextColor: Theme.fg; selectionColor: Theme.alpha(Theme.accent, 0.45)
                font.family: Theme.mono; font.pixelSize: 14
                onLinkActivated: link => Qt.openUrlExternally(link)
            }
            Rectangle {
                width: parent.width
                visible: block.modelData.kind === "code"
                height: visible ? codeColumn.height + 20 : 0
                color: Theme.surface; border.width: 1; border.color: Theme.border
                Column {
                    id: codeColumn
                    x: 10; y: 10; width: parent.width - 20; spacing: 8
                    RowLayout {
                        width: parent.width
                        Text { Layout.fillWidth: true; text: block.modelData.language || "Code"; elide: Text.ElideRight; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
                        Btn {
                            id: copyBtn
                            property bool done: false
                            compact: true; icon: done ? "check" : ""; text: done ? "Copied" : "Copy"
                            onClicked: { rendered.copyRequested(block.modelData.text); done = true; doneTimer.restart(); }
                            Timer { id: doneTimer; interval: 1400; onTriggered: copyBtn.done = false }
                        }
                    }
                    Flickable {
                        width: parent.width; height: codeText.implicitHeight + (contentWidth > width ? 12 : 0)
                        contentWidth: Math.max(width, codeText.implicitWidth); contentHeight: height
                        clip: true; flickableDirection: Flickable.HorizontalFlick
                        ScrollBar.horizontal: ScrollBar { policy: parent.contentWidth > parent.width ? ScrollBar.AlwaysOn : ScrollBar.AlwaysOff }
                        TextEdit {
                            id: codeText
                            readOnly: true; selectByMouse: true
                            text: Markdown.highlight(block.modelData.text, Theme.accent.toString(), Theme.teal.toString(), Theme.muted.toString())
                            textFormat: TextEdit.RichText; wrapMode: TextEdit.NoWrap
                            color: Theme.fg; selectedTextColor: Theme.fg; selectionColor: Theme.alpha(Theme.accent, 0.45)
                            font.family: Theme.mono; font.pixelSize: 13
                        }
                    }
                }
            }
            Flickable {
                id: table
                width: parent.width
                visible: block.modelData.kind === "table"
                height: visible ? tableRows.height + (contentWidth > width ? 12 : 0) : 0
                contentWidth: Math.max(width, (block.modelData.rows[0] || []).length * 130)
                contentHeight: height; clip: true; flickableDirection: Flickable.HorizontalFlick
                ScrollBar.horizontal: ScrollBar { policy: parent.contentWidth > parent.width ? ScrollBar.AlwaysOn : ScrollBar.AlwaysOff }
                Column {
                    id: tableRows
                    width: table.contentWidth
                    Repeater {
                        model: block.modelData.rows
                        delegate: Row {
                            id: tableRow
                            required property var modelData
                            required property int index
                            width: tableRows.width
                            height: Math.max(34, ...Array.from({ length: children.length }, (_, i) => children[i].implicitHeight))
                            Repeater {
                                model: (block.modelData.rows[0] || []).length
                                delegate: Rectangle {
                                    required property int index
                                    width: tableRows.width / Math.max(1, (block.modelData.rows[0] || []).length)
                                    height: tableRow.height; implicitHeight: cell.implicitHeight + 16
                                    color: tableRow.index % 2 === 0 ? Theme.surface2 : Theme.surface
                                    border.width: 1; border.color: Theme.border
                                    Text {
                                        id: cell
                                        x: 8; y: 8; width: parent.width - 16
                                        text: tableRow.modelData[parent.index] || ""
                                        textFormat: Text.MarkdownText; wrapMode: Text.Wrap
                                        color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13; font.bold: tableRow.index === 0
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
