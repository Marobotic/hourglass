package dev.marobotic.hourglass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
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
import androidx.compose.material.icons.outlined.Folder
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
    // The page inside a grouped tab: Schedule (Week, Attendance) and Time
    // (Alarms, Timers, Clock).
    var scheduleSub by mutableStateOf(0)
    var timeSub by mutableStateOf(0)
    val sheets = Sheets()
    fun push(r: Route) { stack.add(r) }
    fun pop() { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    fun openNote(n: JSONObject) = push(Route.NoteR(n.optString("id")))
    fun sessionNote(occ: Occ, existing: List<JSONObject>) {
        if (existing.isNotEmpty()) openNote(existing[0])
        else openNote(repo.addNote(occ.courseId, occ.session, occ.eventId))
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
                    Build.VERSION.SDK_INT < 34 || runCatching { ctx.getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent() }.getOrDefault(true)
                }
                if (!fsiOk) Row(
                    Modifier.fillMaxWidth().background(HColors.accent.copy(alpha = 0.2f)).clickable {
                        ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:" + ctx.packageName)))
                    }.padding(horizontal = 18.dp, vertical = 10.dp),
                ) { T("Allow full-screen alarms so they show over the lock screen  →", 13) }
                Box(Modifier.weight(1f)) {
                    when (nav.tab) {
                        0 -> NowScreen(nav, version, clock)
                        1 -> Column(Modifier.fillMaxSize()) {
                            SubTabs(listOf("Week", "Attendance"), nav.scheduleSub) { nav.scheduleSub = it }
                            Box(Modifier.weight(1f)) {
                                if (nav.scheduleSub == 0) ScheduleScreen(nav, version, clock) else AttendanceScreen(nav, version, clock)
                            }
                        }
                        2 -> NotesScreen(nav, version)
                        3 -> DriveScreen(nav, version)
                        else -> Column(Modifier.fillMaxSize()) {
                            SubTabs(listOf("Alarms", "Timers", "Clock"), nav.timeSub) { nav.timeSub = it }
                            Box(Modifier.weight(1f)) {
                                when (nav.timeSub) {
                                    0 -> TimeScreen(nav, version, clock)
                                    1 -> TimersScreen(nav, version, clock)
                                    else -> ClockScreen(nav, version, clock)
                                }
                            }
                        }
                    }
                }
                // Square tab bar (Material's has a pill indicator).
                Row(Modifier.fillMaxWidth().background(HColors.surface).navigationBarsPadding()) {
                    // Five: more did not fit a phone. Related pages share a tab
                    // and a switcher at its top.
                    val items = listOf("Now" to Icons.Outlined.Schedule, "Schedule" to Icons.Outlined.CalendarMonth, "Notes" to Icons.Outlined.StickyNote2, "Drive" to Icons.Outlined.Folder, "Time" to Icons.Outlined.Alarm)
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

// Signed out, this is the whole app: sign in or create an account. Same page
// as the Omarchy Music phone app's (one account for both), in Hourglass colours.
private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

@Composable
fun LoginScreen(repo: Repo) {
    var creating by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf(repo.account ?: "") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    // Checked here first, so the common mistakes never make a round trip.
    fun submit() {
        if (busy) return
        val e = email.trim()
        problem = when {
            !EMAIL.matches(e) -> "Enter a valid email address."
            password.length < 8 -> "The password needs at least 8 characters."
            creating && confirm != password -> "The passwords do not match."
            else -> null
        }
        if (problem != null) return
        busy = true
        val done: (String?) -> Unit = { busy = false; problem = it }
        if (creating) repo.register(e, password, done) else repo.signIn(e, password, done)
    }

    Box(
        Modifier.fillMaxSize().background(HColors.bg).statusBarsPadding().navigationBarsPadding().imePadding()
            .verticalScroll(androidx.compose.foundation.rememberScrollState()),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            PixelLogo(7.dp)
            Spacer(Modifier.height(16.dp))
            LoginText("Hourglass", 22.sp, HColors.fg, bold = true)
            Spacer(Modifier.height(6.dp))
            LoginText("Your schedule and notes, on every device", 14.sp, HColors.muted)
            Spacer(Modifier.height(28.dp))

            ModeSwitch(creating) { creating = it; problem = null }
            Spacer(Modifier.height(22.dp))

            LoginField("Email", email, { email = it; problem = null }, keyboard = KeyboardType.Email)
            Spacer(Modifier.height(14.dp))
            LoginField(
                "Password", password, { password = it; problem = null },
                keyboard = KeyboardType.Password, hidden = !showPassword,
                trailing = if (showPassword) "Hide" else "Show", onTrailing = { showPassword = !showPassword },
                last = !creating, onDone = ::submit,
            )
            if (creating) {
                Spacer(Modifier.height(14.dp))
                LoginField("Confirm password", confirm, { confirm = it; problem = null }, keyboard = KeyboardType.Password, hidden = !showPassword, last = true, onDone = ::submit)
            }
            Spacer(Modifier.height(8.dp))
            LoginText(
                if (creating) "At least 8 characters." else "The same account as Omarchy Music. Your other devices use it too.",
                12.sp, HColors.muted, modifier = Modifier.fillMaxWidth(), align = TextAlign.Start,
            )
            problem?.let {
                Spacer(Modifier.height(14.dp))
                LoginText(it, 13.sp, HColors.accent, modifier = Modifier.fillMaxWidth(), align = TextAlign.Start)
            }
            Spacer(Modifier.height(22.dp))
            PrimaryButton(
                text = when {
                    busy && creating -> "Creating account…"
                    busy -> "Signing in…"
                    creating -> "Create account"
                    else -> "Sign in"
                },
                enabled = !busy, onClick = ::submit,
            )
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                LoginText(if (creating) "Already have an account? " else "New here? ", 14.sp, HColors.muted)
                LoginText(
                    if (creating) "Sign in" else "Create an account", 14.sp, HColors.accent, bold = true,
                    modifier = Modifier.clickable { creating = !creating; problem = null },
                )
            }
        }
    }
}

@Composable
private fun LoginText(text: String, size: TextUnit, color: Color, bold: Boolean = false, modifier: Modifier = Modifier, align: TextAlign = TextAlign.Center) {
    Text(text = text, color = color, fontFamily = Mono, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, fontSize = size, textAlign = align, modifier = modifier)
}

/** The two-way Sign in / Create account switch. */
@Composable
private fun ModeSwitch(creating: Boolean, onChange: (Boolean) -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Row(Modifier.fillMaxWidth().height(44.dp).clip(shape).background(HColors.surface).border(1.dp, HColors.border, shape).padding(4.dp)) {
        for ((label, value) in listOf("Sign in" to false, "Create account" to true)) {
            val on = creating == value
            Box(
                Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(7.dp)).background(if (on) HColors.surface2 else Color.Transparent).clickable { onChange(value) },
                contentAlignment = Alignment.Center,
            ) { LoginText(label, 14.sp, if (on) HColors.fg else HColors.muted, bold = on) }
        }
    }
}

@Composable
private fun LoginField(
    label: String, value: String, onChange: (String) -> Unit, keyboard: KeyboardType,
    hidden: Boolean = false, trailing: String? = null, onTrailing: () -> Unit = {}, last: Boolean = false, onDone: () -> Unit = {},
) {
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.fillMaxWidth()) {
        LoginText(label, 13.sp, HColors.fg, modifier = Modifier.padding(start = 2.dp, bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().height(52.dp).clip(shape).background(HColors.surface).border(1.dp, HColors.border, shape).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = value, onValueChange = onChange, singleLine = true,
                textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontSize = 16.sp),
                cursorBrush = SolidColor(HColors.accent),
                visualTransformation = if (hidden) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                    keyboardType = keyboard, imeAction = if (last) ImeAction.Done else ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(onDone = { onDone() }),
                modifier = Modifier.weight(1f),
            )
            if (trailing != null) {
                Spacer(Modifier.width(10.dp))
                LoginText(trailing, 13.sp, HColors.muted, modifier = Modifier.clickable(onClick = onTrailing))
            }
        }
    }
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier.fillMaxWidth().height(52.dp).clip(shape).background(if (enabled) HColors.accent else HColors.accent.copy(alpha = 0.45f)).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!enabled) androidx.compose.material3.CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
            LoginText(text, 16.sp, Color.White, bold = true)
        }
    }
}

// The pages of a grouped tab, as an underlined row like the tab bar's.
@Composable
fun SubTabs(items: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp)) {
        for ((i, label) in items.withIndex()) {
            val on = i == selected
            Column(Modifier.weight(1f).clickable { onSelect(i) }.padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                T(label, 13, if (on) HColors.fg else HColors.muted, bold = on, maxLines = 1)
                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth().height(2.dp).background(if (on) HColors.accent else HColors.border))
            }
        }
    }
}
