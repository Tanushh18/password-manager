package com.tanush.stashr.tv

import com.tanush.stashr.tv.core.Logic
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LogicTest {
    @Test fun namesAreMadeSafe() {
        assertEquals("passwd", Logic.safeName("../../etc/passwd"))
        assertEquals("a.mp4", Logic.safeName("movies\\a.mp4"))
        assertEquals("Movie_ 1.mkv", Logic.safeName("Movie: 1.mkv".replace(":", "_")))
        assertEquals("hidden.mp4", Logic.safeName("..hidden.mp4"))
        assertNull(Logic.safeName(".."))
        assertNull(Logic.safeName("   "))
        assertNull(Logic.safeName(null))
        assertEquals(150, Logic.safeName("x".repeat(400))!!.length)
    }

    @Test fun resumeMath() {
        assertEquals(0L, Logic.resumeFrom(0, 1000))
        assertEquals(400L, Logic.resumeFrom(400, 1000))
        assertEquals(-1L, Logic.resumeFrom(1000, 1000))
        assertEquals(0L, Logic.resumeFrom(1500, 1000))   // longer than the movie: start again
    }

    @Test fun onlyMissingOrWrongSizeIsDownloaded() {
        val manifest = listOf("a.mp4" to 10L, "b.mp4" to 20L, "c.mp4" to 30L)
        assertEquals(listOf("b.mp4" to 20L, "c.mp4" to 30L), Logic.missing(manifest, mapOf("a.mp4" to 10L, "b.mp4" to 5L)))
    }

    @Test fun mirrorDeletesOnlyWhatWeDownloadedAndDriveLost() {
        val ours = setOf("a.mp4", "b.mp4")
        assertEquals(listOf("b.mp4"), Logic.mirrorDeletes("mirror", ours, setOf("a.mp4", "z.mp4")))
        assertEquals(emptyList<String>(), Logic.mirrorDeletes("move", ours, emptySet()))
        assertEquals(emptyList<String>(), Logic.mirrorDeletes("mirror", emptySet(), setOf("a.mp4")))   // never touches what we did not download
    }

    @Test fun volumeCommands() {
        assertEquals(10, Logic.volumeTarget(JSONObject("""{"action":"up"}"""), 8, 15))
        assertEquals(15, Logic.volumeTarget(JSONObject("""{"action":"up"}"""), 15, 15))
        assertEquals(0, Logic.volumeTarget(JSONObject("""{"action":"down"}"""), 0, 15))
        assertEquals(8, Logic.volumeTarget(JSONObject("""{"level":50}"""), 3, 15))
        assertNull(Logic.volumeTarget(JSONObject("""{"level":150}"""), 3, 15))
        assertNull(Logic.volumeTarget(JSONObject("""{"action":"mute"}"""), 3, 15))
        assertEquals(true, Logic.isMute(JSONObject("""{"action":"mute"}""")))
    }

    @Test fun titlesSizesAndOrder() {
        assertEquals("The Movie 2024", Logic.title("The_Movie.2024.mkv"))
        assertEquals("1.5 GB", Logic.size(1_610_612_736L))
        assertEquals("700 MB", Logic.size(734_003_200L))
        val order = Logic.sortApps(listOf("com.zzz" to "Zebra", "com.google.android.youtube.tv" to "YouTube", "com.netflix.ninja" to "Netflix", "com.aaa" to "Alpha"), { it.first }, { it.second }).map { it.second }
        assertEquals(listOf("Netflix", "YouTube", "Alpha", "Zebra"), order)
        assertEquals("com.google.android.youtube.tvmusic", Logic.youtubePackage("https://music.youtube.com/watch?v=1"))
        assertEquals("com.google.android.youtube.tv", Logic.youtubePackage("https://www.youtube.com/watch?v=1"))
        assertEquals("Good morning", Logic.greeting(8)); assertEquals("Good night", Logic.greeting(2))
    }
}
