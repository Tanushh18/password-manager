package com.tanush.stashr.tv.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.tanush.stashr.tv.core.LocalPolicy
import com.tanush.stashr.tv.core.Prefs
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Finds the home tablet (Stashr Hub) on the Wi-Fi: the address used last time first, then NSD / Bonjour discovery of
 * the "_stashr-hub._tcp" service. A candidate only counts when it answers GET /v1/ping with the shared key, and only
 * private addresses are accepted. Blocking: call from a background thread.
 */
class TabletFinder(private val ctx: Context) {
    private val prefs = Prefs(ctx)

    fun ping(a: LocalPolicy.Addr, key: String): Boolean = try {
        val r = RawHttp.request(a.host, a.port, "GET", "/v1/ping", key, timeoutMs = 3000)
        r.status in 200..299 && r.body.contains("\"hub\"")
    } catch (e: Exception) { false }

    /** The saved address if it still answers, else a fresh discovery (up to [timeoutMs]); saves what it finds. */
    fun find(key: String, timeoutMs: Long = 8000): LocalPolicy.Addr? {
        val now = System.currentTimeMillis()
        LocalPolicy.cachedAddr(prefs.localAddr, prefs.localAddrAt, now)?.let { if (ping(it, key)) return it }
        val found = discover(key, timeoutMs) ?: return null
        prefs.localAddr = found.toString(); prefs.localAddrAt = System.currentTimeMillis()
        return found
    }

    @Suppress("DEPRECATION")
    private fun discover(key: String, timeoutMs: Long): LocalPolicy.Addr? {
        val nsd = ctx.applicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return null
        val latch = CountDownLatch(1)
        val result = java.util.concurrent.atomic.AtomicReference<LocalPolicy.Addr?>(null)
        val resolver = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) { /* another one may still answer */ }
            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                val host = serviceInfo.host?.hostAddress ?: return
                val addr = LocalPolicy.Addr(host, serviceInfo.port)
                if (LocalPolicy.privateHost(host) && result.get() == null && ping(addr, key)) { result.set(addr); latch.countDown() }
            }
        }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String?) {}
            override fun onDiscoveryStopped(serviceType: String?) {}
            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) { latch.countDown() }
            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {}
            override fun onServiceLost(serviceInfo: NsdServiceInfo?) {}
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType?.contains("_stashr-hub") != true) return
                // Android resolves one service at a time: a second call while one is running fails, and that is fine.
                try { nsd.resolveService(serviceInfo, resolver) } catch (e: Exception) { /* busy */ }
            }
        }
        try {
            nsd.discoverServices("_stashr-hub._tcp", NsdManager.PROTOCOL_DNS_SD, listener)
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: Exception) { /* no NSD on this box */ }
        finally { try { nsd.stopServiceDiscovery(listener) } catch (e: Exception) { /* not running */ } }
        return result.get()
    }
}
