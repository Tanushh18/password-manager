package com.tanush.stashr.tv.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.TextView
import com.tanush.stashr.tv.BuildConfig
import com.tanush.stashr.tv.access.RemoteAccessibilityService
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.core.Ui
import com.tanush.stashr.tv.service.TvService
import com.tanush.stashr.tv.sync.MovieStore
import com.tanush.stashr.tv.update.Updater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/** Link status, movie sync and storage, updates, and the two permissions the commands from Stashr need. */
class SettingsActivity : Activity() {
    private lateinit var ui: Ui
    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private lateinit var linkText: TextView
    private lateinit var storageText: TextView
    private lateinit var syncText: TextView
    private lateinit var accessText: TextView
    private lateinit var overlayText: TextView
    private lateinit var updateText: TextView
    private lateinit var mirrorText: TextView
    @Volatile private var alive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this); prefs = Prefs(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr TV · ${BuildConfig.VERSION_NAME}"))
        col.addView(ui.h1("Settings"))

        val link = ui.card("Link")
        linkText = ui.body(""); link.addView(linkText)
        link.addView(ui.danger("Unlink this TV") {
            AlertDialog.Builder(this).setTitle("Unlink this TV?").setMessage("It stops reporting to Stashr. You can link it again with the code from the website.")
                .setPositiveButton("Unlink") { _, _ -> prefs.unlink(); stopService(Intent(this, TvService::class.java)); startActivity(Intent(this, SetupActivity::class.java)); finish() }
                .setNegativeButton("Cancel", null).show()
        })
        col.addView(link)

        val movies = ui.card("Movies", "Copied from your Google Drive folder to this TV's USB drive or storage")
        syncText = ui.body(""); storageText = ui.dim("")
        movies.addView(syncText); movies.addView(storageText)
        movies.addView(ui.primary("Sync movies now") { TvService.syncNow(this); android.widget.Toast.makeText(this, "Syncing…", android.widget.Toast.LENGTH_SHORT).show() })
        col.addView(movies)

        val perms = ui.card("Commands from Stashr", "Two permissions make the buttons on the Smart home page work on this TV")
        accessText = ui.body(""); overlayText = ui.body("")
        perms.addView(accessText)
        perms.addView(ui.quiet("Open Accessibility settings") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
        perms.addView(ui.dim("Turn on “Stashr TV remote”. It lets Stashr press Home and Back and see which app is open. It does not read the screen."))
        perms.addView(overlayText)
        perms.addView(ui.quiet("Allow Display over other apps") { open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) })
        perms.addView(ui.dim("Needed for messages like “Parveen is arriving in 15 mins” over Netflix, and for opening apps from Stashr."))
        perms.addView(ui.quiet("Test on-screen message") {
            com.tanush.stashr.tv.overlay.NoticeOverlay.show(this, "Parveen is arriving in 15 mins")
        })
        col.addView(perms)

        val mirror = ui.card("Screen mirror", "Show a phone's screen and sound on this TV over the Wi-Fi (Stashr Cast app)")
        mirrorText = ui.body(""); mirror.addView(mirrorText)
        mirror.addView(ui.quiet("Forget all phones") { prefs.castTokens = ""; android.widget.Toast.makeText(this, "All phones forgotten", android.widget.Toast.LENGTH_SHORT).show() })
        col.addView(mirror)

        val upd = ui.card("App updates", "Stashr TV updates itself from the Stashr server")
        updateText = ui.body(Updater.lastMessage.ifEmpty { "Version ${BuildConfig.VERSION_NAME}" }); upd.addView(updateText)
        upd.addView(ui.quiet("Check for updates") {
            updateText.text = "Checking…"
            CoroutineScope(Dispatchers.Main).launch { updateText.text = Updater.check(this@SettingsActivity, manual = true) }
        })
        col.addView(upd)
        col.addView(ui.quiet("Back") { finish() })
        setContentView(root)
    }

    private fun open(i: Intent) { try { startActivity(i) } catch (e: Exception) { android.widget.Toast.makeText(this, "This TV has no screen for that setting", android.widget.Toast.LENGTH_LONG).show() } }

    override fun onResume() { super.onResume(); alive = true; refresh() }
    override fun onPause() { alive = false; main.removeCallbacksAndMessages(null); super.onPause() }

    private fun refresh() {
        val fmt = SimpleDateFormat("d MMM HH:mm", Locale.getDefault())
        linkText.text = if (!prefs.linked) "Not linked. Open the Stashr tile again to link."
            else "Linked as “${prefs.deviceName}”\n" + (if (prefs.lastReportOk > 0) "Last report to Stashr: ${fmt.format(Date(prefs.lastReportOk))}" else "No report yet") + (if (prefs.lastError.isNotEmpty()) "\n⚠ ${prefs.lastError}" else "")
        accessText.text = if (RemoteAccessibilityService.enabled(this)) "✓ Accessibility: on" else "✗ Accessibility: off (Back and “which app is open” will not work)"
        overlayText.text = if (Settings.canDrawOverlays(this)) "✓ Display over other apps: allowed" else "✗ Display over other apps: not allowed (messages show as a small toast)"
        mirrorText.text = "PIN: ${prefs.castPin()}" + (if (com.tanush.stashr.tv.cast.CastHub.active()) "\nShowing ${com.tanush.stashr.tv.cast.CastHub.from()} now" else "")
        val s = TvService.syncer?.state
        syncText.text = when {
            s == null -> "Waiting for the first sync"
            s.active && s.error.isEmpty() -> "Downloading ${Logic.title(s.name)}… ${s.pct}%"
            s.error.isNotEmpty() -> "⚠ ${s.error}"
            s.finishedAt > 0 -> "Last sync: ${fmt.format(Date(s.finishedAt))}"
            else -> "Not synced yet"
        }
        thread {
            val used = MovieStore.usedByMovies(this); val free = MovieStore.freeBytes(this); val total = MovieStore.totalBytes(this); val usb = MovieStore.onUsb(this)
            main.post { storageText.text = (if (usb) "USB drive" else "Internal storage (no USB drive found)") + ": movies ${Logic.size(used)} · free ${Logic.size(free)} of ${Logic.size(total)}" }
        }
        if (alive) main.postDelayed({ refresh() }, 3000)
    }
}
