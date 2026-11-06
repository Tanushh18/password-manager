package com.tanush.stashr.cast.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.tanush.stashr.cast.core.Logic

/** Finds Stashr TVs on the Wi-Fi: each announces "_stashr-cast._tcp" (port 8766). */
class TvFinder(ctx: Context, private val onChange: () -> Unit) {
    class Tv(val name: String, val host: String, val port: Int)

    private val nsd = ctx.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, Tv>()
    private val queue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var running = false

    private val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { running = false }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onServiceFound(info: NsdServiceInfo) { main.post { queue.addLast(info); next() } }
        override fun onServiceLost(info: NsdServiceInfo) { main.post { if (found.remove(info.serviceName) != null) onChange() } }
    }

    fun list(): List<Tv> = found.values.toList()

    fun start() {
        if (running) return
        running = true
        try { nsd.discoverServices(Logic.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) } catch (e: Exception) { running = false }
    }

    fun stop() {
        if (!running) return
        running = false
        queue.clear()
        try { nsd.stopServiceDiscovery(listener) } catch (e: Exception) { /* not started */ }
    }

    // One resolve at a time: Android refuses a second one while the first is still running.
    @Suppress("DEPRECATION")
    private fun next() {
        if (resolving) return
        val info = queue.removeFirstOrNull() ?: return
        resolving = true
        try {
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) { main.post { resolving = false; next() } }
                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    val host = serviceInfo.host?.hostAddress
                    main.post {
                        resolving = false
                        if (host != null) { found[serviceInfo.serviceName] = Tv(serviceInfo.serviceName, host, serviceInfo.port.takeIf { it > 0 } ?: Logic.PORT); onChange() }
                        next()
                    }
                }
            })
        } catch (e: Exception) { resolving = false }
    }
}
