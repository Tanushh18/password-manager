package com.tanush.stashr.cast.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.tanush.stashr.cast.BuildConfig
import com.tanush.stashr.cast.core.Api
import com.tanush.stashr.cast.core.Prefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Updates from the Stashr server, which serves the APK built by GitHub Actions. A check only records that an update
 * exists; the download (checked against the release's SHA-256 and size) and the install happen when the person taps
 * "Install update" on the main screen. Android then asks for one tap.
 */
object Updater {
    @Volatile var waiting = false
    @Volatile var lastError = ""

    /** Asks the server whether a newer build exists and remembers the answer. Returns the new version or "". */
    suspend fun check(ctx: Context): String = withContext(Dispatchers.IO) {
        val app = ctx.applicationContext
        val prefs = Prefs(app)
        try {
            val info = Api(app).latest(BuildConfig.VERSION_CODE)
            prefs.updateCheckedAt = System.currentTimeMillis()
            prefs.updateVersion = if (info.optBoolean("updateAvailable")) info.optString("version") else ""
            prefs.updateVersion
        } catch (e: Exception) { lastError = e.message ?: "Update check failed"; "" }
    }

    /** Downloads and installs the newer build. Returns a short message for the screen. */
    suspend fun install(ctx: Context): String = withContext(Dispatchers.IO) {
        val app = ctx.applicationContext
        try {
            val info = Api(app).latest(BuildConfig.VERSION_CODE)
            if (!info.optBoolean("updateAvailable")) { Prefs(app).updateVersion = ""; return@withContext "Up to date (${BuildConfig.VERSION_NAME})" }
            if (!app.packageManager.canRequestPackageInstalls()) {
                app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return@withContext "Allow installs from Stashr Cast, then tap Install update again"
            }
            val apk = File(app.cacheDir, "stashr-cast-update.apk")
            Api(app).download(info.getString("downloadUrl"), apk)
            val size = info.optLong("sizeBytes")
            if ((size > 0 && apk.length() != size) || !sha256(apk).equals(info.optString("sha256"), true)) {
                apk.delete()
                return@withContext "The downloaded update did not match its checksum"
            }
            commit(app, apk)
            "Installing ${info.optString("version")}…"
        } catch (e: Exception) { lastError = e.message ?: "Update failed"; lastError }
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input -> val buf = ByteArray(64 * 1024); while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun commit(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("stashr-cast.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; session.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallResultReceiver::class.java).setPackage(ctx.packageName), flags)
            session.commit(pi.intentSender)
        }
    }
}
