import { stripVTControlCharacters } from "node:util";
import { join } from "node:path";

const SAFE_HOST_ENV = ["PATH", "LANG", "LC_ALL", "NO_COLOR", "TZ"];

export function opencodeAccountDirectories(dir) {
  const home = join(dir, "home");
  const local = join(home, ".local");
  return {
    dir, home, work: join(dir, "work"),
    config: join(home, ".config"), data: join(local, "share"), state: join(local, "state"),
    cache: join(home, ".cache"), temp: join(home, ".tmp"), local,
  };
}

export function opencodeAccountOwnedPaths(dirs, configFile) {
  return [...Object.values(dirs), configFile];
}

export function opencodeProfileEnv(dirs, host = process.env) {
  const env = Object.fromEntries(SAFE_HOST_ENV.filter((key) => host[key] !== undefined).map((key) => [key, host[key]]));
  Object.assign(env, {
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
    XDG_CACHE_HOME: dirs.cache,
    TMPDIR: dirs.temp,
    TMP: dirs.temp,
    TEMP: dirs.temp,
    OPENCODE_CONFIG: join(dirs.work, "opencode.json"),
  });
  return env;
}

export function opencodeRunArgs(model, session, attach = []) {
  const args = ["run", "--format", "json", "-m", model];
  if (session) args.push("--session", session);
  for (const file of attach) args.push("-f", file);
  return args;
}

// `opencode models opencode` is the provider-specific catalog. The current
// CLI prints only model IDs (no prices or free flags), so provider membership
// is its free-availability signal; don't infer availability from ID suffixes.
export function parseOpencodeModels(output) {
  const clean = stripVTControlCharacters(String(output || "")).trim();
  if (!clean) return [];
  if (clean.startsWith("[") || clean.startsWith("{")) {
    try {
      const parsed = JSON.parse(clean);
      const rows = Array.isArray(parsed) ? parsed : parsed.models ?? parsed.data ?? [];
      return rows.map((row) => typeof row === "string" ? row : row.id || row.name).filter((id) => typeof id === "string" && id.includes("/"));
    } catch { return []; }
  }
  const models = [];
  for (const line of clean.split(/\r?\n/)) {
    const id = line.trim().split(/\s+/)[0];
    if (/^[\w.-]+\/[\w.-]+$/.test(id || "")) models.push(id);
  }
  return [...new Set(models)];
}
