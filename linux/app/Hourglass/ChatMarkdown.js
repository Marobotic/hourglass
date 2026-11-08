.pragma library

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Tokenize before escaping so markup cannot turn into executable rich text.
function highlight(code, accent, stringColor, muted) {
    const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|#[^\n]*)|\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|fn|pub|mut|struct|impl|use|def|try|catch|throw|true|false|null|None|True|False)\b|\b(\d+(?:\.\d+)?)\b/g;
    let out = "", at = 0, m;
    while ((m = re.exec(code)) !== null) {
        out += escapeHtml(code.slice(at, m.index));
        const color = m[1] ? stringColor : m[2] ? muted : accent;
        out += '<font color="' + color + '">' + escapeHtml(m[0]) + '</font>';
        at = re.lastIndex;
    }
    return '<pre style="white-space:pre; margin:0">' + out + escapeHtml(code.slice(at)) + '</pre>';
}

function cells(line) {
    const body = line.trim().replace(/^\|/, "").replace(/\|$/, ""), out = [];
    let cell = "";
    for (let i = 0; i < body.length; i++) {
        if (body[i] === "\\" && body[i + 1] === "|") { cell += "|"; i++; }
        else if (body[i] === "|") { out.push(cell.trim()); cell = ""; }
        else cell += body[i];
    }
    out.push(cell.trim());
    return out;
}

function blocks(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const out = [], prose = [];
    function flush() { if (prose.length) { out.push({ kind: "text", text: prose.join("\n"), language: "", rows: [] }); prose.length = 0; } }
    for (let i = 0; i < lines.length; i++) {
        const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
        if (fence) {
            flush();
            const code = [], marker = fence[1][0], count = fence[1].length;
            for (i++; i < lines.length; i++) {
                const close = /^\s{0,3}(`+|~+)\s*$/.exec(lines[i]);
                if (close && close[1][0] === marker && close[1].length >= count) break;
                code.push(lines[i]);
            }
            out.push({ kind: "code", text: code.join("\n"), language: fence[2].trim(), rows: [] });
        } else if (i + 1 < lines.length && lines[i].includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
            flush();
            const rows = [cells(lines[i])];
            i += 2;
            for (; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(cells(lines[i]));
            i--;
            out.push({ kind: "table", text: "", language: "", rows: rows });
        } else prose.push(lines[i]);
    }
    flush();
    return out;
}
