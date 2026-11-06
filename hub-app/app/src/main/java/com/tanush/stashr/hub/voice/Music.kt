package com.tanush.stashr.hub.voice

import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import java.net.URLEncoder

/**
 * Songs on this tablet, through YouTube Music, where the YouTube Premium account is signed in (no ads, keeps playing
 * with the screen off). Uses Android's "play from search", which YouTube Music answers by starting to play.
 */
object Music {
    private const val YT_MUSIC = "com.google.android.apps.youtube.music"
    private const val YOUTUBE = "com.google.android.youtube"

    /** Plays songs for a search on this tablet with YouTube Music (YouTube Premium account). Returns a message. */
    fun play(ctx: Context, query: String): String {
        val q = query.trim().ifEmpty { "top hindi songs" }
        val search = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).apply {
            putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
            putExtra(SearchManager.QUERY, q)
            setPackage(YT_MUSIC)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try { ctx.startActivity(search); return "Playing “$q” with YouTube Music" } catch (e: ActivityNotFoundException) { /* not installed */ } catch (e: SecurityException) { /* refused */ }

        val enc = URLEncoder.encode(q, "UTF-8")
        val web = Intent(Intent.ACTION_VIEW, Uri.parse("https://music.youtube.com/search?q=$enc")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(Intent(web).setPackage(YT_MUSIC)); return "Opened YouTube Music for “$q”" } catch (e: Exception) { /* next */ }
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=$enc")).setPackage(YOUTUBE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return "YouTube Music is not installed; opened YouTube for “$q”"
        } catch (e: Exception) { /* next */ }
        return try { ctx.startActivity(web); "Opened music.youtube.com for “$q” in the browser" }
        catch (e: Exception) { throw IllegalStateException("Install YouTube Music on the tablet to play songs") }
    }
}
