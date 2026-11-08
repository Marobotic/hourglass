package dev.marobotic.hourglass.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatStreamTest {
    private fun chat() = JSONObject().put("busy", false).put("messages", JSONArray().put(JSONObject().put("id", "u1").put("role", "user").put("text", "hi")))

    @Test fun sseEventsAreAssembledAndPingsSkipped() {
        val sse = ChatStream.Sse()
        assertNull(sse.line("event: state"))
        assertNull(sse.line("data: {\"state\":\"busy\",\"busy\":true}"))
        val (name, d) = sse.line("")!!
        assertEquals("state", name)
        assertTrue(d.getBoolean("busy"))
        assertNull(sse.line(": ping"))
        assertNull(sse.line(""))
    }

    @Test fun textGrowsAndToolsUpdateInPlace() {
        val c = chat()
        assertFalse(ChatStream.apply(c, "message_start", JSONObject("""{"message_id":"a1","user_message_id":"u1","at":5,"model":"m"}""")))
        ChatStream.apply(c, "text", JSONObject("""{"message_id":"a1","delta":"Hel","text":"Hel"}"""))
        ChatStream.apply(c, "text", JSONObject("""{"message_id":"a1","delta":"lo","text":"Hello"}"""))
        ChatStream.apply(c, "tool_start", JSONObject("""{"message_id":"a1","id":"t1","tool":"set_alarm","label":"Set an alarm","status":"running","input":"{}"}"""))
        ChatStream.apply(c, "tool_end", JSONObject("""{"message_id":"a1","id":"t1","status":"completed","output":"ok","duration_ms":12}"""))
        val m = ChatStream.message(c, "a1")!!
        assertEquals("Hello", m.getString("text"))
        val tools = m.getJSONArray("tools")
        assertEquals(1, tools.length())
        assertEquals("completed", tools.getJSONObject(0).getString("status"))
        assertEquals("Set an alarm", tools.getJSONObject(0).getString("label"))
        assertEquals(12, tools.getJSONObject(0).getInt("duration_ms"))
    }

    @Test fun unknownUserMessageAsksForTheSnapshot() {
        val c = chat()
        assertTrue(ChatStream.apply(c, "message_start", JSONObject("""{"message_id":"a1","user_message_id":"u9"}""")))
        assertTrue(ChatStream.apply(c, "text", JSONObject("""{"message_id":"nope","text":"x"}""")))
    }

    @Test fun aStartedMessageIsBusyAndLeavesTheQueue() {
        val c = chat().put("queue", JSONArray().put(JSONObject().put("id", "q1").put("text", "next")))
        assertTrue(ChatStream.apply(c, "message_start", JSONObject("""{"message_id":"a1","user_message_id":"u1"}""")))
        assertTrue(c.getBoolean("busy"))
        assertEquals("busy", c.getString("state"))
        assertEquals("a1", ChatStream.message(c, "a1")!!.getString("id"))
    }

    @Test fun usageFeedsTheContextMeterAndQuotaClears() {
        val c = chat()
        ChatStream.apply(c, "message_start", JSONObject("""{"message_id":"a1","user_message_id":"u1"}"""))
        assertNull(ChatStream.context(c))
        ChatStream.apply(c, "usage", JSONObject("""{"message_id":"a1","model":"m","input_tokens":10,"context_percent":1.5}"""))
        assertEquals(1.5, ChatStream.context(c)!!.getDouble("context_percent"), 0.0)
        ChatStream.apply(c, "quota", JSONObject("""{"state":"quota","message":"limit","resets_at":1759903600000}"""))
        assertNotNull(ChatStream.quota(c))
        ChatStream.apply(c, "quota", JSONObject("""{"state":"ok"}"""))
        assertNull(ChatStream.quota(c))
    }

    @Test fun replaceKeepsTheEngineText() {
        val c = chat()
        ChatStream.apply(c, "message_start", JSONObject("""{"message_id":"a1","user_message_id":"u1"}"""))
        ChatStream.apply(c, "text", JSONObject("""{"message_id":"a1","delta":"draft","text":"draft"}"""))
        ChatStream.apply(c, "text", JSONObject("""{"message_id":"a1","delta":"","text":"final","replace":true}"""))
        assertEquals("final", ChatStream.message(c, "a1")!!.getString("text"))
    }

    @Test fun durationsAndJson() {
        assertEquals("12 ms", ChatStream.duration(12))
        assertEquals("1.5 s", ChatStream.duration(1500))
        assertEquals("2m 5s", ChatStream.duration(125_000))
        assertTrue(ChatStream.pretty("{\"a\":1}").contains("\n"))
        assertEquals("plain", ChatStream.pretty("plain"))
    }

    @Test fun chatMdSplitsCodeAndTables() {
        val blocks = ChatMd.blocks("a\n```kotlin\nval x = 1\n```\n| h | i |\n|---|--:|\n| 1 | 2 |")
        assertEquals(3, blocks.size)
        assertEquals("kotlin", (blocks[1] as ChatMd.Block.Code).lang)
        val t = blocks[2] as ChatMd.Block.Table
        assertEquals(listOf("h", "i"), t.header)
        assertEquals(ChatMd.Align.Right, t.aligns[1])
        assertEquals("> a\n> b\n\n", ChatMd.quote("a\nb"))
    }
}
