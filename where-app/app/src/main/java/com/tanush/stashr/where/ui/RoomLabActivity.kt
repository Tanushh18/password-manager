package com.tanush.stashr.where.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.Switch
import com.tanush.stashr.where.core.Api
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.core.RoomLogic
import com.tanush.stashr.where.core.Ui
import com.tanush.stashr.where.work.RoomScan
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Room Lab. Stand in a room, tap "Main yahan hoon: <room>", keep the phone still for 15 seconds: it listens to the Wi-Fi networks and
 * Bluetooth devices around it and sends what it heard, labelled with the room. Do this in 4-5 different spots of each room. Stashr then
 * works out the room from every later scan and shows how well it works (the accuracy). If it ever names the wrong room, tell it the right
 * one ("Galat hai"), and that correction teaches it too.
 */
class RoomLabActivity : Activity() {
    private lateinit var ui: Ui
    private lateinit var prefs: Prefs
    private lateinit var body: LinearLayout
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null
    private var status = ""
    private var config = JSONObject()
    private var report = ""
    private var pending: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ui = Ui(this); prefs = Prefs(this)
        val (root, col) = ui.page()
        body = col
        setContentView(root)
        refresh()
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    private fun busy() = job?.isActive == true

    private fun refresh() {
        scope.launch {
            try {
                config = withContext(Dispatchers.IO) { Api(this@RoomLabActivity).roomConfig() }
                prefs.roomOn = config.optBoolean("on")
            } catch (e: Exception) { status = "Server se baat nahi ho paayi: " + (e.message ?: "") }
            draw()
        }
    }

    private fun draw() {
        body.removeAllViews()
        val rooms = RoomLogic.rooms(config)
        val counts = RoomLogic.parseCounts(config.optJSONObject("counts"))
        body.addView(ui.eyebrow("Stashr Location"))
        body.addView(ui.h1("Room Lab"))
        body.addView(ui.dim("Kamre mein khade hoke button dabao aur phone ko 15 second sthir rakho. Har kamre mein 4-5 alag jagah karo."))

        val live = ui.card("Abhi")
        val cur = config.optJSONObject("current")
        val field = config.optJSONObject("field")
        live.addView(ui.body(if (cur != null) "Stashr ke hisaab se aap: ${cur.optString("name")} mein (${(cur.optDouble("confidence") * 100).toInt()}% pakka)" else if (prefs.roomOn) "Kamra abhi pata nahi." else "Room location band hai: ek kamre ko train karoge to apne aap on ho jayega."))
        if (cur != null) live.addView(ui.quiet("Sahi hai ✓") { if (!busy()) scope.launch { try { withContext(Dispatchers.IO) { Api(this@RoomLabActivity).roomConfirm() }; status = "Shukriya: sahi gina gaya."; refresh() } catch (e: Exception) { status = e.message ?: "Could not save"; draw() } } })
        val sw = Switch(this).apply {
            text = "Room location on (checks ke saath Wi-Fi/Bluetooth scan jaayega)"; isChecked = prefs.roomOn; setTextColor(ui.c.text)
            setOnCheckedChangeListener { _, on -> if (!busy()) scope.launch { try { withContext(Dispatchers.IO) { Api(this@RoomLabActivity).roomOn(on) }; prefs.roomOn = on } catch (e: Exception) { status = e.message ?: "Could not save"; draw() } } }
        }
        live.addView(sw)
        val bleSw = Switch(this).apply {
            text = "Bluetooth bhi use karo (zyada sahi, thodi zyada battery)"; isChecked = prefs.roomBle; setTextColor(ui.c.text)
            setOnCheckedChangeListener { _, on -> prefs.roomBle = on }
        }
        live.addView(bleSw)
        body.addView(live)

        val train = ui.card("Kamre sikhao", RoomLogic.summary(rooms, counts))
        train.addView(ui.dim("Jis kamre mein ho wahan khade hoke ye button dabao. Wo kamre ka naam poochega (naya naam likho ya purana chuno), phir 15 second sunega."))
        train.addView(ui.primary("Main yahan hoon") { askRoom() }.apply { isEnabled = !busy() })
        val thin = RoomLogic.thin(rooms, counts)
        if (thin.isNotEmpty() && rooms.isNotEmpty()) train.addView(ui.text("Kam training: ${thin.joinToString(", ")} (kam se kam 5 scan chahiye)", 13f, ui.c.warn))
        if (status.isNotEmpty()) train.addView(ui.body(status))
        body.addView(train)

        if (rooms.size >= 2) {
            val wrong = ui.card("Galat hai?", "Agar Stashr ne galat kamra bataya, apna asli kamra chuno: wo scan sudhaar ki tarah seekha jaata hai.")
            for (r in rooms) wrong.addView(ui.quiet("Main asal mein $r mein hoon") { withPermission { capture(r, fix = true) } }.apply { isEnabled = !busy() })
            body.addView(wrong)
        }

        val rep = ui.card("Kitna sahi hai?", "Har scan ko chhupa ke baaki se guess karwaya jaata hai; jitne sahi, wahi accuracy.")
        if (report.isNotEmpty()) rep.addView(ui.body(report))
        rep.addView(ui.quiet("Report dekho") { loadReport() })
        body.addView(rep)

        body.addView(ui.quiet("Wapas") { finish() })
    }

    /** "Main yahan hoon": asks which room this is (a new name, or one of the rooms already there), adds it if it is new, then listens. */
    private fun askRoom() {
        if (busy()) return
        val rooms = RoomLogic.rooms(config)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(ui.dp(20), ui.dp(8), ui.dp(20), 0) }
        val input = ui.input("Kamre ka naam, jaise Bedroom")
        box.addView(input)
        if (rooms.isNotEmpty()) {
            box.addView(ui.dim("Ya inme se chuno:"))
            rooms.forEach { r -> box.addView(ui.quiet(r) { input.setText(r); input.setSelection(r.length) }) }
        }
        android.app.AlertDialog.Builder(this).setTitle("Aap kaun se kamre mein ho?").setView(box)
            .setPositiveButton("Scan shuru karo") { _, _ ->
                val typed = RoomLogic.cleanRoom(input.text.toString())
                if (typed == null) { status = "Kamre ka naam kam se kam 2 akshar ka ho."; draw() }
                else { val room = RoomLogic.resolveRoom(typed, rooms); withPermission { addThenCapture(room, rooms) } }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun addThenCapture(room: String, known: List<String>) {
        if (room in known) { capture(room, fix = false); return }
        job = scope.launch {
            status = "Naya kamra “$room” bana raha hoon…"; draw()
            try { withContext(Dispatchers.IO) { Api(this@RoomLabActivity).roomAdd(room) } } catch (e: Exception) { status = "Kamra add nahi hua: " + (e.message ?: ""); draw(); return@launch }
            capture(room, fix = false)
        }
    }

    /** Bluetooth needs its own permission on Android 12+: ask once; Wi-Fi alone still works if it is refused. */
    private fun withPermission(go: () -> Unit) {
        if (busy()) return
        if (prefs.roomBle && Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) { pending = go; requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_SCAN), 20); return }
        if (!RoomScan.hasWifiPermission(this)) { status = "Location ki permission chahiye (Wi-Fi scan ke liye): app settings mein allow karo."; draw(); return }
        go()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 20) { pending?.let { if (RoomScan.hasWifiPermission(this)) it() else { status = "Location ki permission chahiye."; draw() } }; pending = null }
    }

    private fun capture(room: String, fix: Boolean) {
        job = scope.launch {
            status = "Sun raha hoon… phone ko sthir rakho."
            draw()
            try {
                val got = RoomScan.capture(this@RoomLabActivity, if (fix) 10 else 15, prefs.roomBle) { tick -> status = "Sun raha hoon… $tick"; draw() }
                if (got.scans.isEmpty()) { status = "Kuch sunayi nahi diya: Wi-Fi/Bluetooth on karo aur dobara try karo."; draw(); return@launch }
                val r = withContext(Dispatchers.IO) {
                    val api = Api(this@RoomLabActivity)
                    if (fix) api.roomFix(room, got.scans) else api.roomSample(room, RoomLogic.newSession(System.currentTimeMillis()), got.scans)
                }
                prefs.roomOn = true
                val acc = if (r.optInt("tested") > 0) " · accuracy ${r.optInt("accuracy")}%" else ""
                status = "Save hua: ${got.scans.size} scan (Wi-Fi ${got.wifi}, Bluetooth ${got.ble}). $room: ${r.optJSONObject("counts")?.optInt(room) ?: "?"} scan$acc. ${r.optString("verdict")}"
            } catch (e: Exception) { status = "Save nahi hua: " + (e.message ?: e.javaClass.simpleName) }
            refresh()
        }
    }

    private fun loadReport() {
        scope.launch {
            try {
                val r = withContext(Dispatchers.IO) { Api(this@RoomLabActivity).roomReport() }
                val per = r.optJSONObject("perRoom")
                val lines = per?.keys()?.asSequence()?.map { k -> "$k: ${per.getJSONObject(k).optInt("accuracy")}% (${per.getJSONObject(k).optInt("n")} scan)" }?.joinToString("\n") ?: ""
                report = if (r.optInt("tested") > 0) "Accuracy ${r.optInt("accuracy")}% (${r.optInt("tested")} scan ka test, ${r.optInt("unsure")}% “pakka nahi”)\n$lines\n${r.optString("verdict")}" else r.optString("verdict")
            } catch (e: Exception) { report = "Report nahi mili: " + (e.message ?: "") }
            draw()
        }
    }
}
