package com.tanush.stashr.hub.core

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

/** What this device can say about itself: battery, Wi-Fi, address, storage, memory. Used by the tablet and phones. */
object DeviceInfo {
    fun battery(ctx: Context): JSONObject {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return JSONObject()
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val health = when (i.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "Good"; BatteryManager.BATTERY_HEALTH_OVERHEAT -> "Overheating"
            BatteryManager.BATTERY_HEALTH_DEAD -> "Dead"; BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "Over voltage"
            BatteryManager.BATTERY_HEALTH_COLD -> "Cold"; BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "Failing"
            else -> ""
        }
        return JSONObject()
            .put("pct", if (level >= 0 && scale > 0) Math.round(level * 100f / scale) else JSONObject.NULL)
            .put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
            .put("temp", i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0)
            .put("health", health)
    }

    /** True when the active network is Wi-Fi. */
    fun onWifi(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    fun networkName(ctx: Context): String {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return "offline"
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "offline"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile data"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            else -> "other"
        }
    }

    /** This device's IPv4 address on the Wi-Fi (or any LAN interface), or "". */
    fun localIp(): String = try {
        NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
            .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>().firstOrNull { it.isSiteLocalAddress }?.hostAddress ?: ""
    } catch (e: Exception) { "" }

    /** Wi-Fi signal in dBm (closer to 0 is stronger), or 0 when unknown. */
    /** The access point the tablet is connected to, or "" (Android hides it without location permission and shows 02:00:00:00:00:00). */
    @Suppress("DEPRECATION")
    fun wifiBssid(ctx: Context): String = try {
        ctx.applicationContext.getSystemService(WifiManager::class.java)?.connectionInfo?.bssid?.lowercase()?.takeIf { it.length == 17 && it != "02:00:00:00:00:00" && it != "00:00:00:00:00:00" } ?: ""
    } catch (e: Exception) { "" }

    @Suppress("DEPRECATION")
    fun wifiRssi(ctx: Context): Int = try { ctx.applicationContext.getSystemService(WifiManager::class.java)?.connectionInfo?.rssi ?: 0 } catch (e: Exception) { 0 }

    fun storage(): JSONObject {
        val s = StatFs(Environment.getDataDirectory().path)
        return JSONObject().put("free", s.availableBytes).put("total", s.totalBytes)
    }

    fun ram(ctx: Context): JSONObject {
        val mi = ActivityManager.MemoryInfo()
        ctx.getSystemService(ActivityManager::class.java)?.getMemoryInfo(mi)
        return JSONObject().put("free", mi.availMem).put("total", mi.totalMem)
    }

    fun model(): String = (if (Build.MODEL.startsWith(Build.MANUFACTURER, true)) Build.MODEL else Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL)
    fun uptimeHours(): Long = SystemClock.elapsedRealtime() / 3_600_000
}
