package dev.marobotic.hourglass.ui

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.data.Repo
import dev.marobotic.hourglass.data.Slot
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.app.ActivityOptionsCompat
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

// Screenshots of every screen with a demo week built around "now" so a lecture is live.
// Record: ./gradlew recordPaparazziDebug   (images land in src/test/snapshots)
class Shots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_6.copy(softButtons = false), theme = "android:Theme.Material.NoActionBar", maxPercentDifference = 100.0)

    private fun demo(): Repo {
        File(paparazzi.context.filesDir, "hourglass.json").delete()
        val repo = Repo(paparazzi.context, autoConfigure = false)
        val today = LocalDate.now()
        val h = LocalTime.now().hour
        val live = Slot(Dates.iso(today), "%02d:00".format(maxOf(0, h - 1)), "%02d:00".format(minOf(23, h + 1)))
        val algo = repo.addCourse("Algorithms", "CS201", "#B14242", "Room 4.12", "Dr. Okafor", listOf(live, Slot(4, "14:00", "15:00", "lab")), "2026-12-11")
        repo.addCourse("Linear Algebra", "MA210", "#D66E36", "Hall 2", null, listOf(Slot(1, "10:00", "12:00"), Slot(Dates.iso(today), "08:00", "09:00", "tutorial")), null)
        repo.addCourse("Operating Systems", "CS230", "#F0BE66", "Room 1.05", null, listOf(Slot(2, "13:00", "15:00"), Slot(5, "09:00", "11:00")), null)
        repo.addNote(algo.id, null, null, "Syllabus & grading", "# Grading\n- Problem sets 30%\n- Midterm 30%\n- Final 40%", pinned = true)
        repo.addNote(algo.id, today, null, "Dynamic programming", "Memoisation vs tabulation. Knapsack table: rows items, columns capacity.")
        repo.addNote(algo.id, today.minusDays(7), null, "Divide and conquer", "Master theorem. Merge sort is Θ(n log n).")
        repo.addAlarm("Wake up", "07:15", listOf(1, 2, 3, 4, 5), null, null, null)
        repo.startTimer(25 * 60, "Problem set 3")
        return repo
    }

    @Composable
    private fun WithPickers(content: @Composable () -> Unit) {
        val owner = object : ActivityResultRegistryOwner {
            override val activityResultRegistry = object : ActivityResultRegistry() {
                override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {}
            }
        }
        CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner, content = content)
    }

    @Test fun now() = paparazzi.snapshot { HourglassTheme { HourglassApp(demo(), 0) } }
    @Test fun week() = paparazzi.snapshot { HourglassTheme { HourglassApp(demo(), 1) } }
    @Test fun notes() = paparazzi.snapshot { HourglassTheme { HourglassApp(demo(), 2) } }
    @Test fun time() = paparazzi.snapshot { HourglassTheme { HourglassApp(demo(), 4) } }
    @Test fun login() = paparazzi.snapshot { HourglassTheme { LoginScreen(demo()) } }
    @Test fun dayOff() {
        File(paparazzi.context.filesDir, "hourglass.json").delete()
        val repo = Repo(paparazzi.context, autoConfigure = false)
        repo.addCourse("Typography (1)", "GD 471", "#B14242", "B729", null, listOf(Slot(Dates.iso(LocalDate.now().plusDays(2)), "08:30", "13:30")), null)
        paparazzi.snapshot { HourglassTheme { HourglassApp(repo, 0) } }
    }
    @Test fun course() {
        val repo = demo()
        paparazzi.snapshot { HourglassTheme { HourglassApp(repo, 2, Route.CourseR(repo.courses().first().id)) } }
    }
    @Test fun note() {
        val repo = demo()
        val n = repo.notes().first { it.optString("title") == "Dynamic programming" }
        paparazzi.snapshot { HourglassTheme { WithPickers { HourglassApp(repo, 0, Route.NoteR(n.id)) } } }
    }
    // Written as it reads: numbers, to-dos with boxes, a font and a size.
    @Test fun noteChecklist() {
        val repo = demo()
        val body = listOf("# Shopping", "1. eggs", "1. milk", "1. bread", "", "Steps:", "1. Open the kit", "2. Measure twice", "   - use the ruler", "3. Cut once", "", "## To do", "- [ ] call mom", "- [x] buy milk", "- [ ] finish **lab report**", "<span style=\"font-family: Caveat; font-size: 24px\">Handwritten in Caveat</span>").joinToString(NL)
        val n = repo.addNote(null, null, null, "Lab day", body)
        paparazzi.snapshot { HourglassTheme { WithPickers { HourglassApp(repo, 0, Route.NoteR(n.id)) } } }
    }
    // An empty note opens for writing, with the toolbar.
    @Test fun noteEditing() {
        val repo = demo()
        val n = repo.addNote(null, null, null, "New note", "")
        paparazzi.snapshot { HourglassTheme { WithPickers { HourglassApp(repo, 0, Route.NoteR(n.id)) } } }
    }
    @Test fun assistant() = paparazzi.snapshot { HourglassTheme { WithPickers { HourglassApp(demo(), 0, Route.AssistantR) } } }
}

private val NL = 10.toChar().toString()
