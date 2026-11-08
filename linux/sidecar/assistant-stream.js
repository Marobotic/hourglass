// Carries the server's assistant event stream (Server-Sent Events) to the window.
// The window's XMLHttpRequest reads it as it grows; the sidecar adds the account's
// session and closes the server side as soon as the window goes away.
export async function relayAssistantStream({ server, headers, res, fetchImpl = fetch }) {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  let up;
  try {
    up = await fetchImpl(`${server}/api/assistant/stream`, { headers: { ...headers, accept: "text/event-stream" }, signal: abort.signal });
  } catch (e) {
    if (!res.headersSent) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Can't reach the Hourglass server." })); }
    return;
  }
  if (!up.ok || !up.body) {
    const out = await up.json().catch(() => ({}));
    res.writeHead(up.status === 404 ? 404 : up.status === 401 ? 401 : 502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: out.error || (up.status === 404 ? "not found" : `server ${up.status}`) }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" });
  res.write(": open\n\n");
  try {
    for await (const chunk of up.body) res.write(chunk);
  } catch {}
  res.end();
}
