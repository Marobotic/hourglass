package dev.marobotic.hourglass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

// The model chip's sheet: models of the engine in use, searchable, refreshable.
// Picking one saves it for the assistant, the same call the AI settings make.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ModelSheet(
    engine: String, selected: String, choices: List<JSONObject>, loading: Boolean, problem: String, saving: Boolean,
    efforts: List<String>, effort: String, onEffort: (String) -> Unit,
    onRefresh: () -> Unit, onPick: (JSONObject) -> Unit, onChangeAi: () -> Unit, onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val shown = choices.filter { c -> query.isBlank() || (c.optString("name") + " " + c.optString("id")).contains(query.trim(), ignoreCase = true) }
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = HColors.surface, dragHandle = null) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { T("Model", 20, bold = true); T(engine, 12, HColors.muted, maxLines = 1) }
                IconButton(onRefresh, enabled = !loading && !saving) { Icon(Icons.Outlined.Sync, "Refresh models", tint = HColors.muted) }
                IconButton(onDismiss) { Icon(Icons.Outlined.Close, "Close", tint = HColors.muted) }
            }
            BasicTextField(
                query, { query = it }, Modifier.fillMaxWidth().border(1.dp, HColors.border).background(HColors.bg).padding(horizontal = 12.dp, vertical = 11.dp),
                singleLine = true, textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontSize = 15.sp), cursorBrush = SolidColor(HColors.accent),
                decorationBox = { inner -> if (query.isEmpty()) T("Search models", 15, HColors.faint); inner() },
            )
            // How hard it thinks, for models that take it (low / medium / high).
            if (efforts.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                T("EFFORT", 10, HColors.muted, bold = true, spacing = 1.2)
                for (e in efforts) {
                    val on = e == effort
                    Box(
                        Modifier.border(1.dp, if (on) HColors.accent else HColors.border).background(if (on) HColors.accent else HColors.surface2)
                            .clickable(enabled = !saving) { onEffort(e) }.padding(horizontal = 12.dp, vertical = 7.dp),
                    ) { T(e.replaceFirstChar { it.uppercase() }, 12, if (on) HColors.bg else HColors.fg, bold = on) }
                }
            }
            if (loading) T("Loading models…", 13, HColors.muted)
            if (problem.isNotBlank()) T(problem, 13, HColors.accent)
            if (!loading && problem.isBlank() && shown.isEmpty()) T(if (choices.isEmpty()) "This AI has no models to pick from." else "No model matches “$query”.", 13, HColors.muted)
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(shown, key = { it.optString("id") }) { c ->
                    val id = c.optString("id")
                    val on = id == selected
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !saving) { onPick(c) }.padding(vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            T(c.optString("name").ifBlank { id }, 14, if (on) HColors.fg else HColors.muted, bold = on, maxLines = 1)
                            if (c.optString("name").isNotBlank() && c.optString("name") != id) T(id, 11, HColors.faint, maxLines = 1)
                        }
                        Spacer(Modifier.width(8.dp))
                        if (on) Icon(Icons.Outlined.Check, "Selected", tint = HColors.accent, modifier = Modifier.size(18.dp))
                    }
                }
            }
            HButton("Change AI…", Modifier.fillMaxWidth(), onClick = onChangeAi)
        }
    }
}
