package dev.marobotic.hourglass.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class StoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun folderDefaultsContainCourseId() {
        val file = tmp.newFile("hourglass.json")
        val store = Store(file)
        val f = store.upsert("folders", mapOf("name" to "Top Folder"))
        val cid = if (f.has("course_id") && !f.isNull("course_id")) f.getString("course_id") else null
        assertNull(cid)

        val cFolder = store.upsert("folders", mapOf("name" to "Course Folder", "course_id" to "c1"))
        assertEquals("c1", cFolder.getString("course_id"))

        // Reload from disk
        val store2 = Store(file)
        val loaded = store2.get("folders", cFolder.getString("id"))
        assertEquals("c1", loaded?.getString("course_id"))

        // Dirty changes include folders with course_id
        val dirty = store2.dirty()
        val dirtyFolders = dirty["folders"] ?: emptyList()
        assertEquals(2, dirtyFolders.size)
    }
}
