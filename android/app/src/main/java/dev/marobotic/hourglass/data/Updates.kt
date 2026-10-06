package dev.marobotic.hourglass.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import dev.marobotic.hourglass.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates from marobotic.dev, not a store. The feed (BuildConfig.UPDATE_FEED) says
 * what the newest build is; when its versionCode is higher than this one, the app
 * shows a banner. Install downloads the APK into the cache, checks its SHA-256
 * against the feed, and hands it to Android's installer, which asks the user.
 *
 * Android only installs it over this app when both are signed with the same key,
 * which is why releases are signed with the marobotic release key (build.gradle.kts).
 */
object Updates {
    data class Available(val version: String, val code: Int, val notes: String, val url: String, val sha256: String)
    data class State(val available: Available? = null, val downloading: Boolean = false, val progress: Float = 0f, val error: String? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var checkedAt = 0L

    /** Reads the feed at most every [minIntervalMs]. Never throws: no network just means no banner. */
    suspend fun check(minIntervalMs: Long = 6 * 3600_000L) = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        if (now - checkedAt < minIntervalMs) return@withContext
        checkedAt = now
        runCatching {
            val c = URL(BuildConfig.UPDATE_FEED).openConnection() as HttpURLConnection
            c.connectTimeout = 10_000
            c.readTimeout = 10_000
            c.setRequestProperty("Cache-Control", "no-cache")
            val feed = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            val a = feed.optJSONObject("android") ?: return@runCatching null
            val code = a.optInt("versionCode", 0)
            if (code <= BuildConfig.VERSION_CODE || a.optString("url").isEmpty()) null
            else Available(feed.optString("version"), code, feed.optString("notes"), a.getString("url"), a.optString("sha256"))
        }.onSuccess { found -> _state.value = _state.value.copy(available = found, error = null) }
    }

    /** True when Android lets this app hand an APK to the installer (Android 8+ asks the user once). */
    fun canInstall(ctx: Context) = Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    /** The settings page where the user allows "Install unknown apps" for Hourglass. */
    fun allowInstalls(ctx: Context) {
        ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    suspend fun install(ctx: Context) {
        val a = _state.value.available ?: return
        if (_state.value.downloading) return
        _state.value = _state.value.copy(downloading = true, progress = 0f, error = null)
        val file = runCatching { withContext(Dispatchers.IO) { download(ctx, a) } }
            .getOrElse { e -> _state.value = _state.value.copy(downloading = false, error = e.message ?: "The download failed"); return }
        _state.value = _state.value.copy(downloading = false, progress = 1f)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun download(ctx: Context, a: Available): File {
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() } // only ever the one we are fetching
        val out = File(dir, "Hourglass-${a.version}.apk")
        val c = URL(a.url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000
        c.readTimeout = 60_000
        if (c.responseCode !in 200..299) error("The download failed (${c.responseCode})")
        val total = c.contentLengthLong.takeIf { it > 0 } ?: -1L
        val digest = MessageDigest.getInstance("SHA-256")
        c.inputStream.use { input ->
            out.outputStream().use { output ->
                val buf = ByteArray(64 * 1024)
                var done = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    digest.update(buf, 0, n)
                    done += n
                    if (total > 0) _state.value = _state.value.copy(progress = done.toFloat() / total)
                }
            }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        if (a.sha256.isNotEmpty() && !hash.equals(a.sha256, ignoreCase = true)) {
            out.delete()
            error("The download did not match the release")
        }
        return out
    }
}
