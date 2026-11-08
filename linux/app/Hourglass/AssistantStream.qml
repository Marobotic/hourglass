import QtQuick

// The assistant's live events (Server-Sent Events, relayed by the background
// service). It reads the response as it grows, hands over each event, and
// reconnects with a growing wait when the connection drops. `connected` turns
// true only once bytes have arrived, so the page keeps polling until the stream
// really delivers (and when this Qt never shows a half-read response).
Item {
    id: s
    property bool active: false
    property bool connected: false
    property int attempt: 0
    property double lastByte: 0
    property var request: null
    property int offset: 0
    property string buffer: ""

    signal received(string name, var data)
    signal opened()        // the first bytes of a connection: take a fresh snapshot
    signal lost()

    onActiveChanged: if (active) connect(); else drop(false)
    Component.onCompleted: if (active) connect()
    Component.onDestruction: drop(false)

    function connect() {
        if (!active || request) return;
        const x = new XMLHttpRequest();
        request = x;
        offset = 0;
        buffer = "";
        x.onreadystatechange = function () {
            if (x !== s.request) return;
            if (x.readyState === XMLHttpRequest.LOADING || x.readyState === XMLHttpRequest.DONE) {
                if (x.status === 200) s.read(x.responseText || "");
            }
            if (x.readyState === XMLHttpRequest.DONE) {
                s.request = null;
                s.drop(true);
            }
        };
        x.open("GET", Api.base + "/api/assistant/stream");
        x.setRequestHeader("Authorization", "Bearer " + Api.token);
        x.setRequestHeader("Accept", "text/event-stream");
        lastByte = Date.now();
        x.send();
    }

    function read(text) {
        if (text.length <= offset) return;
        const fresh = text.substring(offset);
        offset = text.length;
        lastByte = Date.now();
        if (!connected) { connected = true; attempt = 0; opened(); }
        buffer += fresh.replace(/\r\n/g, "\n");
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.substring(0, at);
            buffer = buffer.substring(at + 2);
            let name = "message", data = "";
            for (const line of block.split("\n")) {
                if (line.indexOf("event:") === 0) name = line.substring(6).trim();
                else if (line.indexOf("data:") === 0) data += line.substring(5).trim();
            }
            if (!data) continue;
            let parsed = null;
            try { parsed = JSON.parse(data); } catch (e) { continue; }
            received(name, parsed);
        }
        // The response text only ever grows: start over before it gets large.
        if (offset > 400000) recycle();
    }

    // Closes the connection; `retry` waits and opens another.
    function drop(retry) {
        const x = request;
        request = null;
        if (x) { try { x.abort(); } catch (e) {} }
        const was = connected;
        connected = false;
        if (was) lost();
        if (retry && active) { attempt++; wait.interval = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5))); wait.restart(); }
        else wait.stop();
    }
    function recycle() {
        const x = request;
        request = null;
        if (x) { try { x.abort(); } catch (e) {} }
        connected = false;
        attempt = 0;
        connect();
    }

    Timer { id: wait; onTriggered: s.connect() }
    // The server pings every 15 s: a long silence means the connection is dead.
    Timer {
        interval: 5000; repeat: true; running: s.active
        onTriggered: if (s.request && Date.now() - s.lastByte > 45000) s.drop(true)
    }
}
