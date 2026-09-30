pragma Singleton
import QtQuick

// Talks to the local sidecar. Every call is async; errors surface through
// the error signal so the UI can show a toast instead of failing silently.
QtObject {
    id: api

    property string base: "http://127.0.0.1:8931"
    property string token: ""
    property int revision: 0 // bumped after every successful mutation

    signal error(string message)
    signal changed()

    function request(method, path, body, cb) {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            let data = null;
            try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {}
            if (xhr.status >= 200 && xhr.status < 300) {
                if (method !== "GET") { api.revision++; api.changed(); }
                if (cb) cb(data);
            } else {
                const msg = data && data.error ? data.error : (xhr.status ? "HTTP " + xhr.status : "Hourglass service is not running");
                if (method !== "GET" || xhr.status) api.error(msg);
                if (cb && cb.length > 1) cb(null, msg);
            }
        };
        xhr.open(method, base + path);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        if (body !== undefined && body !== null) {
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(JSON.stringify(body));
        } else xhr.send();
    }

    function get(path, cb) { request("GET", path, null, cb); }
    function post(path, body, cb) { request("POST", path, body || {}, cb); }
    function put(path, body, cb) { request("PUT", path, body, cb); }
    function del(path, cb) { request("DELETE", path, null, cb); }
    function action(name, args, cb) { request("POST", "/api/actions/" + name, args || {}, cb); }
}
