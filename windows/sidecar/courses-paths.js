import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, win32, posix } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WINDOWS_SHELL_FOLDERS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
const WINDOWS_SHELL_FOLDERS_LEGACY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";

function pathApiFor(platform) {
  return platform === "win32" ? win32 : posix;
}

function parsePersonal(output) {
  const line = String(output || "").split(/\r?\n/).find((item) => /^\s*Personal\s+REG_(?:EXPAND_SZ|SZ)\s+/i.test(item));
  return line ? line.replace(/^\s*Personal\s+REG_(?:EXPAND_SZ|SZ)\s+/i, "").trim() : "";
}

function expandWindowsVariables(value, env) {
  return String(value || "").replace(/%([^%]+)%/g, (match, name) => {
    const found = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : match;
  });
}

function linuxDocumentsFromUserDirs(contents, home) {
  const line = String(contents || "").split(/\r?\n/).find((item) => /^\s*XDG_DOCUMENTS_DIR\s*=/.test(item));
  if (!line) return "";
  let value = line.slice(line.indexOf("=") + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  value = value.replace(/\\\$/g, "\u0000")
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, () => home)
    .replace(/\u0000/g, "$")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
  return value.startsWith("/") ? value : "";
}

async function registryDocuments(env) {
  for (const key of [WINDOWS_SHELL_FOLDERS, WINDOWS_SHELL_FOLDERS_LEGACY]) {
    try {
      const { stdout } = await execFileAsync("reg.exe", ["query", key, "/v", "Personal"], {
        windowsHide: true,
        timeout: 1500,
        maxBuffer: 32 * 1024,
      });
      const value = expandWindowsVariables(parsePersonal(stdout), env);
      if (value && !/%[^%]+%/.test(value)) return value;
    } catch {}
  }
  return "";
}

export function legacyCoursesDirectory({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const path = pathApiFor(platform);
  const profile = env.USERPROFILE || env.HOME || home;
  return path.resolve(profile, "Hourglass", "Courses");
}

export async function resolveCoursesDirectory({
  env = process.env,
  home = homedir(),
  platform = process.platform,
  readRegistry = registryDocuments,
  readUserDirs = (profile) => readFile(join(profile, ".config", "user-dirs.dirs"), "utf8"),
} = {}) {
  const path = pathApiFor(platform);
  if (env.HOURGLASS_COURSES_DIR) return path.resolve(env.HOURGLASS_COURSES_DIR);

  let documents = "";
  if (platform === "win32") {
    try { documents = await readRegistry(env); } catch {}
    documents = expandWindowsVariables(documents, env);
    if (/%[^%]+%/.test(documents) || (documents && !win32.isAbsolute(documents))) documents = "";
  } else if (platform === "linux") {
    try { documents = linuxDocumentsFromUserDirs(await readUserDirs(home), home); } catch {}
  }

  if (!documents) documents = path.join(home, "Documents");
  return path.resolve(documents, "Courses");
}

export async function moveCourseDirectory(source, target, {
  renameDirectory = rename,
  copyDirectory = cp,
  removeDirectory = rm,
} = {}) {
  try {
    await renameDirectory(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    try {
      await copyDirectory(source, target, { recursive: true, errorOnExist: true, force: false });
    } catch (copyError) {
      await removeDirectory(target, { recursive: true, force: true }).catch(() => {});
      throw copyError;
    }
    await removeDirectory(source, { recursive: true });
  }
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function migrateLegacyCoursePairs({
  pairs,
  oldRoot,
  newRoot,
  updatePair,
  log = () => {},
  platform = process.platform,
}) {
  const path = pathApiFor(platform);
  const legacyRoot = path.resolve(oldRoot);
  const coursesRoot = path.resolve(newRoot);
  let migrated = 0;

  for (const pair of pairs) {
    if (pair.mode !== "pull") continue;
    const source = path.resolve(pair.local);
    const rel = path.relative(legacyRoot, source);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;

    const target = path.resolve(coursesRoot, rel);
    if (await exists(target)) {
      log("skipped course folder migration; destination already exists", source, target);
      continue;
    }

    try {
      await mkdir(path.dirname(target), { recursive: true });
      if (await exists(source)) await moveCourseDirectory(source, target);
      else await mkdir(target, { recursive: true });
      await updatePair(pair.id, target);
      migrated++;
      log("migrated synced course folder", source, "->", target);
    } catch (error) {
      log("could not migrate synced course folder", source, "->", target, error.message);
    }
  }

  if (legacyRoot !== coursesRoot) {
    try {
      await rmdir(legacyRoot);
      log("removed empty legacy courses folder", legacyRoot);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") {
        log("could not remove legacy courses folder", legacyRoot, error.message);
      }
    }
  }
  return migrated;
}
