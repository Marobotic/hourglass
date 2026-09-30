package dev.marobotic.hourglass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.border
import androidx.compose.ui.graphics.RectangleShape

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material.icons.outlined.HourglassBottom
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.App
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.Occ
import dev.marobotic.hourglass.data.Repo
import kotlinx.coroutines.delay
import org.json.JSONObject

sealed interface Route {
    data class NoteR(val id: String) : Route
    data class CourseR(val id: String) : Route
}

// Sheets and dialogs any screen can open.
class Sheets {
    var event by mutableStateOf<Pair<JSONObject?, Map<String, Any?>>?>(null)
    var course by mutableStateOf<Pair<Boolean, JSONObject?>?>(null)
    var session by mutableStateOf<Occ?>(null)
    var alarm by mutableStateOf(false)
    var settings by mutableStateOf(false)
    var confirm by mutableStateOf<Triple<String, String, () -> Unit>?>(null)
}

class Nav(val repo: Repo) {
    val stack = mutableStateListOf<Route>()
    var tab by mutableStateOf(0)
    val sheets = Sheets()
    fun push(r: Route) { stack.add(r) }
    fun pop() { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    fun openNote(n: JSONObject) = push(Route.NoteR(n.optString("id")))
    fun sessionNote(occ: Occ, existing: List<JSONObject>) {
        if (existing.isNotEmpty()) openNote(existing[0])
        else openNote(repo.addNote(occ.courseId, occ.date, occ.eventId))
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        val repo = App.repo(this)
        setContent { HourglassTheme { HourglassApp(repo) } }
    }

    override fun onResume() {
        super.onResume()
        App.repo(this).syncNow()
    }
}

@Composable
fun HourglassApp(repo: Repo, initialTab: Int = 0, initialRoute: Route? = null) {
    val nav = remember { Nav(repo).apply { tab = initialTab; initialRoute?.let { push(it) } } }
    val version by repo.store.version.collectAsState()
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); clock = System.currentTimeMillis() } }
    val sync by repo.sync.collectAsState()
    // Device preferences drive the shared formatters.
    Dates.h24 = repo.h24
    Dates.firstDay = repo.firstDay

    BackHandler(enabled = nav.stack.isNotEmpty() || nav.tab != 0) { if (nav.stack.isNotEmpty()) nav.pop() else nav.tab = 0 }

    // Read version so signing in (a store change) leaves this page.
    if (version >= 0 && repo.needsSignIn) { LoginScreen(repo); return }

    Box(Modifier.fillMaxSize().background(HColors.bg)) {
        val top = nav.stack.lastOrNull()
        when (top) {
            is Route.NoteR -> NoteScreen(nav, top.id, version)
            is Route.CourseR -> Box(Modifier.statusBarsPadding()) { NotesScreen(nav, version, top.id) }
            null -> Column(Modifier.fillMaxSize()) {
                // Header
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 18.dp, end = 6.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    PixelLogo(3.dp)
                    Spacer(Modifier.width(12.dp))
                    T("Hourglass", 18, bold = true)
                    Grow()
                    IconButton({ nav.sheets.settings = true }) { Icon(Icons.Outlined.Settings, "Settings", tint = HColors.muted) }
                }
                // Alarms can only take over the screen with this permission (Android 14+).
                val ctx = androidx.compose.ui.platform.LocalContext.current
                val fsiOk = remember(clock / 5000) {
                    Build.VERSION.SDK_INT < 34 || ctx.getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent()
                }
                if (!fsiOk) Row(
                    Modifier.fillMaxWidth().background(HColors.accent.copy(alpha = 0.2f)).clickable {
                        ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:" + ctx.packageName)))
                    }.padding(horizontal = 18.dp, vertical = 10.dp),
                ) { T("Allow full-screen alarms so they show over the lock screen  →", 13) }
                Box(Modifier.weight(1f)) {
                    when (nav.tab) {
                        0 -> NowScreen(nav, version, clock)
                        1 -> ScheduleScreen(nav, version, clock)
                        2 -> NotesScreen(nav, version)
                        3 -> TimeScreen(nav, version, clock)
                        4 -> TimersScreen(nav, version, clock)
                        else -> ClockScreen(nav, version, clock)
                    }
                }
                // Square tab bar (Material's has a pill indicator).
                Row(Modifier.fillMaxWidth().background(HColors.surface).navigationBarsPadding()) {
                    val items = listOf("Now" to Icons.Outlined.Schedule, "Schedule" to Icons.Outlined.CalendarMonth, "Notes" to Icons.Outlined.StickyNote2, "Alarms" to Icons.Outlined.Alarm, "Timers" to Icons.Outlined.HourglassEmpty, "Clock" to Icons.Outlined.Public)
                    for ((i, it) in items.withIndex()) {
                        val on = nav.tab == i
                        Column(
                            Modifier.weight(1f).clickable { nav.tab = i }.padding(vertical = 10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(Modifier.width(28.dp).height(2.dp).background(if (on) HColors.accent else androidx.compose.ui.graphics.Color.Transparent))
                            Spacer(Modifier.height(6.dp))
                            Icon(it.second, it.first, tint = if (on) HColors.fg else HColors.muted)
                            T(it.first, 11, if (on) HColors.fg else HColors.muted, bold = on, maxLines = 1)
                        }
                    }
                }
            }
        }
        SheetHost(nav, version)
    }
}

// Signed out, this is the whole app: the Omarchy Music account is the way in,
// same as the music player's sign-in.
@Composable
fun LoginScreen(repo: Repo) {
    var email by remember { mutableStateOf(repo.account ?: "") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun submit() {
        if (busy || "@" !in email || password.isEmpty()) return
        busy = true
        error = null
        repo.signIn(email.trim(), password) { busy = false; error = it }
    }
    Column(
        Modifier.fillMaxSize().background(HColors.bg).statusBarsPadding().navigationBarsPadding().imePadding()
            .verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 24.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        PixelLogo(7.dp)
        Spacer(Modifier.height(6.dp))
        T("Hourglass", 26, bold = true)
        T("Sign in with your Omarchy Music account. Your schedule, notes, alarms and ringtones are shared between your phone and your computer.",
            14, HColors.muted, modifier = Modifier.fillMaxWidth(), align = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Column(Modifier.fillMaxWidth().background(HColors.surface).border(1.dp, HColors.border).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Field(email, { email = it.trim() }, "Email", Modifier.fillMaxWidth())
            Field(password, { password = it }, "Password", Modifier.fillMaxWidth(), password = true)
            error?.let { T(it, 13, HColors.accent) }
            HButton(if (busy) "Signing in…" else "Sign in", Modifier.fillMaxWidth(), primary = true, enabled = !busy && "@" in email && password.isNotEmpty()) { submit() }
        }
        T("No account yet? Create one in Omarchy Music.", 13, HColors.faint)
    }
}
