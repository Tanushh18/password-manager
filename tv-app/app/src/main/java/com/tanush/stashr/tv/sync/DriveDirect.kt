package com.tanush.stashr.tv.sync

import com.tanush.stashr.tv.core.ApiError
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** One movie file in the Drive folder. */
data class DriveFile(val id: String, val name: String, val size: Long)

/**
 * Talks to Google Drive directly, with the saved connection (refresh token + Google client) from the server's grant.
 * The access token is renewed here, so the TV needs the server only to hand the grant out once.
 */
class DriveDirect(private val grant: JSONObject) {
    private var token = ""
    private var expiresAt = 0L
    private val api get() = grant.optString("api").ifEmpty { "https://www.googleapis.com" }.trimEnd('/')

    companion object {
        private val VIDEO = setOf("mp4", "mkv", "avi", "mov", "m4v", "webm", "ts", "mpg", "mpeg", "wmv", "flv", "3gp", "srt", "vtt", "ass")
        /** Only videos and subtitles are copied, as the server always did. */
        fun wanted(name: String) = name.substringAfterLast('.', "").lowercase() in VIDEO
        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    }

    /** A fresh access token from the refresh token; cached until a minute before it runs out. */
    @Synchronized private fun accessToken(force: Boolean = false): String {
        if (!force && token.isNotEmpty() && System.currentTimeMillis() < expiresAt - 60_000) return token
        val form = "client_id=${enc(grant.optString("clientId"))}&client_secret=${enc(grant.optString("clientSecret"))}" +
            "&refresh_token=${enc(grant.optString("refreshToken"))}&grant_type=refresh_token"
        val c = URL("https://oauth2.googleapis.com/token").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.connectTimeout = 20000; c.readTimeout = 20000; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            c.outputStream.use { it.write(form.toByteArray()) }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw ApiError(code, "Google refused the saved Drive connection (HTTP $code). Connect Google again in Smart home.")
            val j = JSONObject(text)
            token = j.getString("access_token")
            expiresAt = System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000
            return token
        } finally { c.disconnect() }
    }

    /** Every video and subtitle in the folder, newest first (as Drive lists them). */
    fun list(): List<DriveFile> {
        val out = mutableListOf<DriveFile>()
        var pageToken = ""
        do {
            val q = "'${grant.optString("folderId")}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
            var url = "$api/drive/v3/files?q=${enc(q)}&fields=${enc("nextPageToken,files(id,name,size)")}&pageSize=1000" +
                "&orderBy=${enc("modifiedTime desc")}&supportsAllDrives=true&includeItemsFromAllDrives=true"
            if (pageToken.isNotEmpty()) url += "&pageToken=${enc(pageToken)}"
            val j = JSONObject(getText(url))
            val files = j.optJSONArray("files") ?: JSONArray()
            for (i in 0 until files.length()) {
                val f = files.getJSONObject(i)
                val name = f.optString("name")
                val size = f.optString("size").toLongOrNull() ?: 0L
                if (size > 0 && wanted(name)) out.add(DriveFile(f.getString("id"), name, size))
            }
            pageToken = j.optString("nextPageToken")
        } while (pageToken.isNotEmpty())
        return out
    }

    /** The movie itself from byte [from] (a resume), straight from Google. The caller reads it and disconnects. */
    fun open(fileId: String, from: Long): HttpURLConnection {
        val url = "$api/drive/v3/files/${enc(fileId)}?alt=media&supportsAllDrives=true"
        val c = authed(url, from, accessToken())
        if (c.responseCode == 401) { c.disconnect(); return authed(url, from, accessToken(force = true)) }
        return c
    }

    private fun authed(url: String, from: Long, bearer: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 30000; c.readTimeout = 60000
        c.setRequestProperty("Authorization", "Bearer $bearer")
        if (from > 0) c.setRequestProperty("Range", "bytes=$from-")
        return c
    }

    private fun getText(url: String): String {
        var c = authed(url, 0, accessToken())
        if (c.responseCode == 401) { c.disconnect(); c = authed(url, 0, accessToken(force = true)) }
        try {
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw ApiError(code, "Google Drive answered HTTP $code.")
            return text
        } finally { c.disconnect() }
    }
}
