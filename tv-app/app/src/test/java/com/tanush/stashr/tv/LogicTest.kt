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
        assertEquals(9, Logic.volumeTarget(JSONObject("""{"action":"up"}"""), 8, 15))
        assertEquals(56, Logic.volumeTarget(JSONObject("""{"action":"up"}"""), 50, 100))
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

    @Test fun tvHomeIsParsed() {
        val j = JSONObject("""{"time":"2026-11-02T03:00:00Z","weather":{"city":"Delhi, Delhi, India","temp":27,"feels":29,"text":"rain \uD83C\uDF27\uFE0F","min":22,"max":29,"rainChance":80},
            "news":[{"title":"Big news","source":"The Hindu","at":1},{"title":"","source":"x"},{"title":"Second","source":"Mint"}],"movieNight":true,
            "coming":[{"person":"Papa","minutes":10,"km":4.2},{"person":"Mom","minutes":0,"km":0.1}]}""")
        val h = Logic.parseTvHome(j)
        assertEquals("Delhi 27°C · rain · 22–29°C · 80% rain", Logic.weatherLine(h.weather!!))
        assertEquals(listOf("Big news", "Second"), h.news.map { it.title })
        assertEquals(true, h.movieNight)
        assertEquals("Papa 10 minute mein aa rahe hain", Logic.comingLine(h.coming[0]))
        assertEquals("Mom bas pahunchne wale hain", Logic.comingLine(h.coming[1]))
        val empty = Logic.parseTvHome(JSONObject("""{"weather":null,"news":[],"movieNight":false,"coming":[]}"""))
        assertNull(empty.weather); assertEquals(0, empty.news.size); assertEquals(false, empty.movieNight)
        assertEquals("Delhi 27°C", Logic.weatherLine(Logic.Weather("Delhi", 27, "", 22, 29, null).copy(min = 22, max = 29)).substringBefore(" · "))
    }

    @Test fun morningPanelOncePerDayBetweenFiveAndEleven() {
        assertEquals(false, Logic.inMorningWindow(4)); assertEquals(true, Logic.inMorningWindow(5)); assertEquals(true, Logic.inMorningWindow(10)); assertEquals(false, Logic.inMorningWindow(11))
        assertEquals(true, Logic.shouldShowMorning(7, "2026-11-02", "2026-11-01"))
        assertEquals(false, Logic.shouldShowMorning(7, "2026-11-02", "2026-11-02"))
        assertEquals(false, Logic.shouldShowMorning(14, "2026-11-02", ""))
    }

    @Test fun commandArgumentsAreChecked() {
        assertEquals("com.google.android.youtube.tv", Logic.youtubePackage("https://youtu.be/abc"))
        assertNull(Logic.volumeTarget(JSONObject("""{}"""), 3, 15))
        assertNull(Logic.volumeTarget(JSONObject("""{"action":"up"}"""), 3, 0))
    }

    @Test fun goesLocalAfter45SecondsOfFailures() {
        assertEquals(false, com.tanush.stashr.tv.core.LocalPolicy.shouldGoLocal(0, 100_000))          // no failure yet
        assertEquals(false, com.tanush.stashr.tv.core.LocalPolicy.shouldGoLocal(10_000, 54_999))
        assertEquals(true, com.tanush.stashr.tv.core.LocalPolicy.shouldGoLocal(10_000, 55_000))
    }

    @Test fun serverIsRetriedEveryMinuteWhileLocal() {
        assertEquals(false, com.tanush.stashr.tv.core.LocalPolicy.shouldRetryServer(100_000, 159_999))
        assertEquals(true, com.tanush.stashr.tv.core.LocalPolicy.shouldRetryServer(100_000, 160_000))
    }

    @Test fun onlyRealFailuresCount() {
        val f = com.tanush.stashr.tv.core.LocalPolicy::isFailure
        assertEquals(true, f(java.io.IOException("timeout")))
        assertEquals(true, f(com.tanush.stashr.tv.core.ApiError(503, "down")))
        assertEquals(false, f(com.tanush.stashr.tv.core.ApiError(401, "no")))
        assertEquals(false, f(com.tanush.stashr.tv.core.ApiError(400, "bad")))
        assertEquals(false, f(IllegalStateException("x")))
    }

    @Test fun cachedHomeScreenLivesOneDay() {
        val p = com.tanush.stashr.tv.core.LocalPolicy
        assertEquals(true, p.homeFresh(1_000, 1_000 + 23 * 3600_000L))
        assertEquals(false, p.homeFresh(1_000, 1_000 + 25 * 3600_000L))
        assertEquals(false, p.homeFresh(0, 5_000))
    }

    @Test fun tabletAddressCache() {
        val p = com.tanush.stashr.tv.core.LocalPolicy
        assertEquals(com.tanush.stashr.tv.core.LocalPolicy.Addr("192.168.1.20", 8765), p.parseAddr("192.168.1.20:8765"))
        assertNull(p.parseAddr("8.8.8.8:8765"))              // not a home address: never used
        assertNull(p.parseAddr("example.com:8765"))
        assertNull(p.parseAddr("192.168.1.20:99999"))
        assertNull(p.parseAddr(""))
        assertEquals(com.tanush.stashr.tv.core.LocalPolicy.Addr("10.0.0.5", 1), p.cachedAddr("10.0.0.5:1", 1_000, 2_000))
        assertNull(p.cachedAddr("10.0.0.5:1", 1_000, 1_000 + 31L * 24 * 3600_000))
        assertNull(p.cachedAddr("10.0.0.5:1", 0, 2_000))
        assertEquals(false, p.mayFindAgain(100_000, 129_999))
        assertEquals(true, p.mayFindAgain(100_000, 130_000))
        assertEquals(true, p.privateHost("172.20.1.1")); assertEquals(false, p.privateHost("172.32.1.1"))
    }

    @Test fun rawHttpReplyIsParsed() {
        val plain = com.tanush.stashr.tv.net.RawHttp.parse("HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}EXTRA".toByteArray())
        assertEquals(200, plain.status); assertEquals("{\"ok\":true}", plain.body)
        val chunked = com.tanush.stashr.tv.net.RawHttp.parse("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n".toByteArray())
        assertEquals("hello world", chunked.body)
        val err = com.tanush.stashr.tv.net.RawHttp.parse("HTTP/1.1 401 Unauthorized\r\n\r\nno".toByteArray())
        assertEquals(401, err.status); assertEquals("no", err.body)
    }
}
