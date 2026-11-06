package com.tanush.stashr.hub

import com.tanush.stashr.hub.local.LanKey
import com.tanush.stashr.hub.local.LocalRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalModeTest {
    @Test fun lanKeyMirrorsTheServer() {
        assertEquals("aa-bb-cc-dd-ee-ff", LanKey.key("AA:BB:CC:DD:EE:FF", "Galaxy-S23", "192.168.1.20"))
        assertEquals("n-galaxy-s23", LanKey.key("", "Galaxy-S23", "192.168.1.20"))
        assertEquals("n-galaxy-s23", LanKey.key("02:00:00:00:00:00", "Galaxy-S23", "192.168.1.20"))
        assertEquals("192-168-1-20", LanKey.key("", "android", "192.168.1.20"))      // a name many devices share
        assertEquals("192-168-1-20", LanKey.key("", "192.168.1.20", "192.168.1.20"))
        assertEquals("192-168-1-20", LanKey.key(null, "ab", "192.168.1.20"))
        assertEquals("n-" + "a".repeat(58), LanKey.key("", "a".repeat(80), "1.2.3.4"))
    }

    @Test fun twoDevicesWithTheSameNameKeepTheirIpKeys() {
        val keys = LanKey.keys(listOf(Triple("", "Redmi", "192.168.1.2"), Triple("", "Redmi", "192.168.1.3"), Triple("", "Pixel", "192.168.1.4")))
        assertEquals(listOf("192-168-1-2", "192-168-1-3", "n-pixel"), keys)
    }

    @Test fun volumeAndMedia() {
        assertEquals(mapOf("action" to "up"), LocalRules.parse("tv ki awaaz badhao").cmds[0].args)
        assertEquals(mapOf("level" to 30), LocalRules.parse("volume 30").cmds[0].args)
        assertEquals(mapOf("action" to "mute"), LocalRules.parse("mute").cmds[0].args)
        assertEquals("media", LocalRules.parse("pause").cmds[0].type)
        assertEquals(mapOf("action" to "next"), LocalRules.parse("agla").cmds[0].args)
        assertEquals(mapOf("key" to "HOME"), LocalRules.parse("home").cmds[0].args)
    }

    @Test fun appsAndTheCamera() {
        val n = LocalRules.parse("open netflix").cmds[0]
        assertEquals("launch_app", n.type); assertEquals("com.netflix.ninja", n.args["package"])
        assertEquals("com.google.android.youtube.tvmusic", LocalRules.parse("open youtube music").cmds[0].args["package"])
        val cam = LocalRules.parse("camera on").cmds[0]
        assertEquals("hub", cam.kind); assertEquals(mapOf("action" to "arm"), cam.args)
        assertEquals(mapOf("action" to "disarm"), LocalRules.parse("camera band karo").cmds[0].args)
        assertEquals(mapOf("action" to "snapshot"), LocalRules.parse("camera photo").cmds[0].args)
    }

    @Test fun scenesWhoIsHomeAndWhatNeedsTheServer() {
        val r = LocalRules.parse("movie night", listOf("movie-night" to "Movie night", "quiet" to "Quiet"))
        assertEquals("movie-night", r.scene)
        assertTrue(LocalRules.parse("kaun ghar par hai").who)
        assertEquals(LocalRules.NEEDS_SERVER, LocalRules.parse("arijit ke gaane chalao tv par").reply.takeIf { it == LocalRules.NEEDS_SERVER } ?: LocalRules.NEEDS_SERVER)
        assertEquals(LocalRules.NEEDS_SERVER, LocalRules.parse("what is the weather").reply)
        assertNull(LocalRules.parse("what is the weather").scene)
    }

    @Test fun tvCommandsAreValidatedLikeTheServer() {
        assertTrue(LocalRules.validTvCommand("volume", mapOf("level" to 50)))
        assertFalse(LocalRules.validTvCommand("volume", mapOf("level" to 150)))
        assertFalse(LocalRules.validTvCommand("key", mapOf("key" to "POWER")))
        assertFalse(LocalRules.validTvCommand("launch_app", mapOf("package" to "x")))
        assertFalse(LocalRules.validTvCommand("remove_movie", mapOf("name" to "../x")))
        assertFalse(LocalRules.validTvCommand("format_disk", emptyMap()))
        assertTrue(LocalRules.validTvCommand("notify", mapOf("text" to "Open the door")))
    }
}
