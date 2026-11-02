package com.tanush.stashr.hub.phone

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.tanush.stashr.hub.BuildConfig
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.ApiError
import com.tanush.stashr.hub.core.DeviceInfo
import com.tanush.stashr.hub.core.Prefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * A family phone's health reports: battery, storage, memory and whether it is on the home Wi-Fi. Sent every
 * 15 minutes (the shortest Android allows in the background) and right after the phone joins a Wi-Fi network.
 */
object PhoneReporter {
    private const val PERIODIC = "stashr-phone-report"
    private const val ONCE = "stashr-phone-report-now"
    @Volatile private var callbackRegistered = false
    @Volatile var lastSentAt = 0L
    @Volatile var lastMessage = ""

    fun schedule(ctx: Context) {
        val app = ctx.applicationContext
        val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val wm = WorkManager.getInstance(app)
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<PhoneReportWorker>(15, TimeUnit.MINUTES).setConstraints(net).build())
        enqueueOnce(app)
        registerWifiCallback(app)
    }

    fun cancel(ctx: Context) {
        val wm = WorkManager.getInstance(ctx.applicationContext)
        wm.cancelUniqueWork(PERIODIC); wm.cancelUniqueWork(ONCE)
    }

    private fun enqueueOnce(app: Context) {
        val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(app).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PhoneReportWorker>().setConstraints(net)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST).build())
    }

    private fun registerWifiCallback(app: Context) {
        if (callbackRegistered) return
        val cm = app.getSystemService(ConnectivityManager::class.java) ?: return
        try {
            val req = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
            cm.registerNetworkCallback(req, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { if (Prefs(app).paired) enqueueOnce(app) }
            })
            callbackRegistered = true
        } catch (e: Exception) { /* the periodic work still runs */ }
    }

    fun status(ctx: Context): JSONObject {
        val bat = DeviceInfo.battery(ctx)
        val wifi = DeviceInfo.onWifi(ctx)
        val out = JSONObject()
            .put("battery", bat.opt("pct") ?: JSONObject.NULL)
            .put("charging", bat.optBoolean("charging"))
            .put("batteryTemp", bat.optDouble("temp", 0.0))
            .put("batteryHealth", bat.optString("health"))
            .put("storage", DeviceInfo.storage())
            .put("ram", DeviceInfo.ram(ctx))
            .put("wifi", wifi)
            .put("ip", if (wifi) DeviceInfo.localIp() else "")
            .put("network", DeviceInfo.networkName(ctx))
            .put("model", DeviceInfo.model())
            .put("android", Build.VERSION.RELEASE)
            .put("uptimeH", DeviceInfo.uptimeHours())
            .put("appVersion", BuildConfig.VERSION_NAME)
        if (Prefs(ctx).shareLocation) LocationService.last?.let { out.put("location", it.toJson()) }
        return out
    }

    suspend fun reportNow(ctx: Context): String = withContext(Dispatchers.IO) {
        val prefs = Prefs(ctx)
        if (!prefs.paired) return@withContext "Not paired"
        try {
            val api = Api(ctx)
            var res = api.report(JSONObject().put("status", status(ctx)))
            val acks = JSONArray()
            val cmds = res.optJSONArray("commands") ?: JSONArray()
            var again = false
            for (i in 0 until cmds.length()) {
                val c = cmds.getJSONObject(i)
                if (c.optString("type") == "report_now") again = true
                acks.put(JSONObject().put("id", c.optString("id")).put("ok", c.optString("type") == "report_now")
                    .put("message", if (c.optString("type") == "report_now") "Sent" else "Not supported on a phone"))
            }
            if (acks.length() > 0 || again) res = api.report(JSONObject().put("status", status(ctx)).put("acks", acks))
            lastSentAt = System.currentTimeMillis()
            lastMessage = "Sent"
            "Sent"
        } catch (e: ApiError) {
            if (e.status == 401) prefs.forget()
            lastMessage = e.message ?: "Server error"
            lastMessage
        } catch (e: Exception) {
            lastMessage = e.message ?: "Could not reach Stashr"
            lastMessage
        }
    }
}

class PhoneReportWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        if (!Prefs(applicationContext).paired) return Result.success()
        val msg = PhoneReporter.reportNow(applicationContext)
        return if (msg == "Sent" || msg == "Not paired") Result.success() else Result.retry()
    }

    override suspend fun getForegroundInfo(): androidx.work.ForegroundInfo {
        val nm = applicationContext.getSystemService(android.app.NotificationManager::class.java)
        nm.createNotificationChannel(android.app.NotificationChannel("phone", "Stashr Hub", android.app.NotificationManager.IMPORTANCE_MIN))
        val n = android.app.Notification.Builder(applicationContext, "phone").setSmallIcon(com.tanush.stashr.hub.R.drawable.ic_stat)
            .setContentTitle("Sending phone health to Stashr").build()
        return if (Build.VERSION.SDK_INT >= 29) androidx.work.ForegroundInfo(2, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else androidx.work.ForegroundInfo(2, n)
    }
}
