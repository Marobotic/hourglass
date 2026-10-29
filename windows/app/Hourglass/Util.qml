pragma Singleton
import QtQuick
import "noteformat.mjs" as NF

QtObject {
    readonly property var weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    readonly property var weekdaysLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    readonly property var months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    readonly property var kinds: ["lecture", "lab", "tutorial", "exam", "event"]
    readonly property var palette: ["#B14242", "#D66E36", "#F0BE66", "#4A8B8B", "#7E6BAF", "#5B8C4A", "#C2587E", "#8A8A8A"]

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    // The window is up and not minimised: the only time animations, polling and
    // the seconds on screen are worth any work. A page with no window over it
    // (a QML test) counts as shown.
    function shown(win) { return !win || (win.visible !== false && win.visibility !== Window.Minimized); }

    // "YYYY-MM-DD" helpers on UTC midnights (no DST drift)
    function parse(d) { const p = d.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function fmt(ms) { const d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
    function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
    function addDays(d, n) { return fmt(parse(d) + n * 86400000); }
    function isoWeekday(d) { return ((new Date(parse(d)).getUTCDay() + 6) % 7) + 1; }
    // First day of the week containing d, per the "week starts on" setting.
    property int weekStartDay: 6
    function weekStart(d) { return addDays(d, -((isoWeekday(d) - weekStartDay + 7) % 7)); }
    function weekdayOf(d) { return weekdays[isoWeekday(d) - 1]; }
    function dayNum(d) { return new Date(parse(d)).getUTCDate(); }
    function monthName(d) { return months[new Date(parse(d)).getUTCMonth()]; }
    function shortDate(d) { return weekdays[isoWeekday(d) - 1] + " " + dayNum(d) + " " + monthName(d).slice(0, 3); }
    function longDate(d) { return weekdaysLong[isoWeekday(d) - 1] + ", " + dayNum(d) + " " + monthName(d); }
    // Accepts "20:30", "8:30 pm", "8pm", "0830"; returns "HH:MM" or "".
    function parseTime(s) {
        const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(s || "");
        if (!m) return "";
        let h = +m[1];
        const min = m[2] ? +m[2] : 0;
        if (min > 59) return "";
        if (m[3]) {
            if (h < 1 || h > 12) return "";
            h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
        } else if (h > 23) return "";
        return pad(h) + ":" + pad(min);
    }
    function minutes(t) { const p = (parseTime(t) || "00:00").split(":"); return +p[0] * 60 + +p[1]; }
    // Display a stored "HH:MM" time in the chosen format.
    property bool h24: false
    function t(hhmm) {
        if (!hhmm) return "";
        const m = minutes(hhmm), h = Math.floor(m / 60);
        if (h24) return pad(h) + ":" + pad(m % 60);
        return ((h + 11) % 12 + 1) + ":" + pad(m % 60) + " " + (h < 12 ? "AM" : "PM");
    }
    function range(a, b) {
        if (h24) return t(a) + " – " + t(b);
        const pa = minutes(a) < 720, pb = minutes(b) < 720;
        return (pa === pb ? t(a).slice(0, -3) : t(a)) + " – " + t(b);
    }
    function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
    function isTime(s) { return parseTime(s) !== ""; }

    // Offset of the Hourglass time zone from UTC, sent by the sidecar. Wall-clock
    // helpers use it instead of the system zone.
    property int offsetMin: -new Date().getTimezoneOffset()
    function wall(ms) { return new Date(ms + offsetMin * 60000); } // read with getUTC*
    function clock(ms) { const d = wall(ms); return t(pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes())); }

    // Back-to-back sessions of one course on one day become one block
    // (lecture 8:30-9:30 + tutorial 9:30-1:30 -> 8:30-1:30). parts keeps the pieces.
    function merge(list) {
        const out = [];
        const sorted = list.slice().sort((a, b) => a.start_ms - b.start_ms);
        for (const o of sorted) {
            const last = out.length ? out[out.length - 1] : null;
            const gap = last ? (o.start_ms - last.end_ms) / 60000 : 999;
            if (last && last.course_id && last.course_id === o.course_id && last.date === o.date && gap >= 0 && gap <= 10) {
                last.end_time = o.end_time;
                last.end_ms = o.end_ms;
                last.parts.push(o);
            } else out.push(Object.assign({}, o, { parts: [o] }));
        }
        return out;
    }
    // "  ✓ attended" etc. after a session's title; "" when not marked.
    function markTag(m) { return m === "attended" ? "  ✓ attended" : m === "absent" ? "  ✗ absent" : m === "off" ? "  – off" : ""; }
    function partsText(m) {
        return m.parts.map(p => kindLabel(p.kind) + " " + t(p.start_time)).join("  ·  ");
    }
    function lead(teacher) { return (teacher || "").split(",")[0].trim(); }
    function dayOf(ms) { return fmt(Date.UTC(wall(ms).getUTCFullYear(), wall(ms).getUTCMonth(), wall(ms).getUTCDate())); }
    // Wall-clock time in a zone that is offMin ahead of UTC.
    function clockAt(ms, offMin) { const d = new Date(ms + offMin * 60000); return t(pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes())); }
    function dateAt(ms, offMin) { const d = new Date(ms + offMin * 60000); return fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
    function diffText(min) {
        if (!min) return "Same time";
        const h = Math.floor(Math.abs(min) / 60), m = Math.abs(min) % 60;
        return (min > 0 ? "+" : "−") + h + (m ? ":" + pad(m) : "") + " h";
    }
    function minutesOf(ms) { const d = wall(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

    function countdown(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
        return (h ? h + ":" + pad(m) : m) + ":" + pad(s);
    }

    // "in 18 min", "in 3 h 5 min", "in 2 d"
    function relative(min) {
        if (min < 1) return "now";
        if (min < 60) return "in " + min + " min";
        if (min < 24 * 60) { const h = Math.floor(min / 60), m = min % 60; return "in " + h + " h" + (m ? " " + m + " min" : ""); }
        const d = Math.round(min / 1440);
        return "in " + d + (d === 1 ? " day" : " days");
    }

    function left(min) {
        if (min < 60) return min + " min left";
        const h = Math.floor(min / 60), m = min % 60;
        return h + " h" + (m ? " " + m + " min" : "") + " left";
    }

    // 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st
    function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

    // "Every Tue, Thu", "Daily", "Monthly on the 15th", "Yearly on 2 Nov", "... until Fri 3 Jul 2027"
    function repeatText(ev) {
        const r = ev.repeat;
        if (!r) return "Once, " + shortDate(ev.start_date);
        const n = r.interval > 1 ? r.interval : 0;
        const d = ev.start_date;
        let s;
        if (r.freq === "daily") s = n ? "Every " + n + " days" : "Daily";
        else if (r.freq === "monthly") s = (n ? "Every " + n + " months" : "Monthly") + " on the " + ordinal(dayNum(d));
        else if (r.freq === "yearly") s = (n ? "Every " + n + " years" : "Yearly") + " on " + dayNum(d) + " " + monthName(d).slice(0, 3);
        else s = (n ? "Every " + n + " weeks on " : "Every ") + (r.days || [isoWeekday(d)]).map(w => weekdays[w - 1]).join(", ");
        if (r.until) s += " until " + shortDate(r.until) + (r.freq === "monthly" || r.freq === "yearly" ? " " + r.until.slice(0, 4) : "");
        return s;
    }

    function kindLabel(k) { return k ? k.charAt(0).toUpperCase() + k.slice(1) : ""; }

    // A note's words, line by line, without Markdown or font tags: for cards.
    function plain(body) { return NF.plainText(body || ""); }
    // The same on one line, for a short preview.
    function preview(body) {
        return NF.plainText(body || "").replace(/\s+/g, " ").trim().slice(0, 140);
    }

    // Numbered lists count 1, 2, 3 again after any edit: each run of "N. " lines
    // at one indent is renumbered from its first number. Deeper lines (sub-items,
    // bullets under an item) and blank lines between items keep the run going;
    // any other line ends it. Returns the new text.
    function renumber(text) {
        const lines = (text || "").split("\n");
        const runs = {}; // indent -> next number, for runs still open
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === "") continue;
            const indent = /^\s*/.exec(line)[0].length;
            // A line closes every run at a deeper indent, and at its own indent
            // unless it is a numbered item there.
            for (const k of Object.keys(runs)) if (+k > indent) delete runs[k];
            const m = /^(\s*)(\d+)\. /.exec(line);
            if (!m) { delete runs[indent]; continue; }
            if (runs[indent] === undefined) runs[indent] = +m[2];
            const n = runs[indent]++;
            lines[i] = m[1] + n + ". " + line.slice(m[0].length);
        }
        return lines.join("\n");
    }

    // A to-do line: "- [ ] buy milk" / "- [x] buy milk".
    readonly property var taskRe: /^(\s*)[-*] \[([ xX])\] ?(.*)$/
}
