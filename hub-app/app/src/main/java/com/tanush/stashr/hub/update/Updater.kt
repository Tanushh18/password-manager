package com.tanush.stashr.hub.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.tanush.stashr.hub.BuildConfig
import com.tanush.stashr.hub.core.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Updates from the Stashr server, which serves the APK built by GitHub Actions. The download is checked against the
 * release's SHA-256 and size before Android installs it. Android asks someone to tap "Update" unless it allows this
 * app to update itself silently (Android 12+ for an app updating itself).
 */
object Updater {
    @Volatile var waiting = false
    @Volatile var lastError = ""
    @Volatile var lastMessage = ""

    suspend fun check(ctx: Context, manual: Boolean): String = withContext(Dispatchers.IO) {
        val app = ctx.applicationContext
        try {
            val info = Api(app).hubLatest(BuildConfig.VERSION_CODE)
            if (!info.optBoolean("updateAvailable")) { waiting = false; return@withContext done("Up to date (${BuildConfig.VERSION_NAME})") }
            val version = info.optString("version")
            if (!app.packageManager.canRequestPackageInstalls()) {
                waiting = true
                if (manual) app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return@withContext done("Update $version ready: allow installs from Stashr Hub")
            }
            val apk = File(app.cacheDir, "stashr-hub-update.apk")
            Api(app).download(info.getString("downloadUrl"), apk)
            val size = info.optLong("sizeBytes")
            val sha = sha256(apk)
            if ((size > 0 && apk.length() != size) || !sha.equals(info.optString("sha256"), true)) {
                apk.delete()
                lastError = "Downloaded update did not match its checksum"
                return@withContext done(lastError)
            }
            install(app, apk)
            done("Installing $version…")
        } catch (e: Exception) {
            lastError = e.message ?: "Update check failed"
            done(lastError)
        }
    }

    private fun done(m: String): String { lastMessage = m; return m }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input -> val buf = ByteArray(64 * 1024); while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("stashr-hub.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; session.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallResultReceiver::class.java).setPackage(ctx.packageName), flags)
            session.commit(pi.intentSender)
        }
    }
}
