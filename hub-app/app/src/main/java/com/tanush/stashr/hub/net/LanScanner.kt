package com.tanush.stashr.hub.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import com.tanush.stashr.hub.core.DeviceInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import kotlin.random.Random

data class LanDevice(val ip: String, var name: String = "", var vendor: String = "", var pingMs: Int = 0, var up: Boolean = true, var ports: List<Int> = emptyList(), var mac: String = "")

data class ScanResult(val subnet: String, val ms: Long, val devices: List<LanDevice>) {
    fun toJson(): JSONArray = JSONArray().also { a -> devices.forEach { d ->
        a.put(JSONObject().put("ip", d.ip).put("name", d.name).put("vendor", d.vendor).put("pingMs", d.pingMs).put("up", d.up).put("mac", d.mac).put("ports", JSONArray(d.ports)))
    } }
}

/**
 * Finds every device answering on the home Wi-Fi, how fast it answers, and the name it gives itself:
 * the router's DNS (the name the phone gave when it joined), Bonjour / mDNS (iPhones, Macs, many Androids, Chromecasts)
 * and NetBIOS (Windows PCs). The name is what lets Stashr keep a phone's row and label when its IP changes.
 */
object LanScanner {
    private val PROBE_PORTS = intArrayOf(80, 443, 7, 62078, 5353)
    val RISK_PORTS = intArrayOf(21, 22, 23, 80, 443, 445, 554, 1883, 2323, 3389, 5555, 5900, 8080, 8291, 8443)

    /** Names learned earlier, by IP: a lookup that times out this round keeps last round's name. */
    private val nameCache = HashMap<String, Pair<String, Long>>()

    private data class Net(val base: Int, val prefix: Int, val self: String, val gateway: String?, val dns: List<String>)

    private fun ipToInt(ip: String): Int = ip.split(".").fold(0) { acc, s -> (acc shl 8) or (s.toInt() and 0xff) }
    private fun intToIp(v: Int): String = "${(v ushr 24) and 0xff}.${(v ushr 16) and 0xff}.${(v ushr 8) and 0xff}.${v and 0xff}"

    private fun findNet(ctx: Context): Net? {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        var lp: LinkProperties? = null
        if (cm != null) {
            val active = cm.activeNetwork
            val caps = active?.let { cm.getNetworkCapabilities(it) }
            lp = if (active != null && caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) cm.getLinkProperties(active) else null
            if (lp == null) {
                @Suppress("DEPRECATION")
                for (n in cm.allNetworks) {
                    val c = cm.getNetworkCapabilities(n) ?: continue
                    if (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) { lp = cm.getLinkProperties(n); break }
                }
            }
        }
        val la = lp?.linkAddresses?.firstOrNull { it.address is Inet4Address }
        val self = la?.address?.hostAddress ?: DeviceInfo.localIp()
        if (self.isBlank()) return null
        // Never sweep more than a /24 (254 hosts): bigger networks would take minutes and flood the router.
        val prefix = (la?.prefixLength ?: 24).coerceIn(24, 30)
        val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
        val gateway = lp?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
        val dns = lp?.dnsServers?.filterIsInstance<Inet4Address>()?.mapNotNull { it.hostAddress } ?: emptyList()
        return Net(ipToInt(self) and mask, prefix, self, gateway, dns)
    }

    suspend fun scan(ctx: Context, withPorts: Boolean): ScanResult = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        val net = findNet(ctx) ?: return@withContext ScanResult("", 0, emptyList())
        val hostCount = (1 shl (32 - net.prefix)) - 2
        val hosts = (1..hostCount).map { intToIp(net.base + it) }

        // 1. Who answers, and how fast.
        val gate = Semaphore(64)
        val alive = coroutineScope {
            hosts.map { ip -> async { gate.withPermit { if (ip == net.self) null else probe(ip)?.let { LanDevice(ip, pingMs = it) } } } }.awaitAll().filterNotNull()
        }.toMutableList()
        alive.add(LanDevice(net.self, name = "This tablet", pingMs = 0))

        // 2. Names: router DNS, then mDNS, then NetBIOS for whatever is still nameless.
        val dnsServers = (listOfNotNull(net.gateway) + net.dns).distinct().filter { it.startsWith(intToIp(net.base).substringBeforeLast('.')) || it == net.gateway }
        val wifi = ctx.applicationContext.getSystemService(WifiManager::class.java)
        val lock = try { wifi?.createMulticastLock("stashr-mdns")?.apply { setReferenceCounted(false); acquire() } } catch (e: Exception) { null }
        try {
            coroutineScope {
                alive.filter { it.ip != net.self }.map { d ->
                    async {
                        gate.withPermit {
                            var name = ""
                            for (server in dnsServers) { name = NameWire.cleanName(dnsPtr(d.ip, server)); if (name.isNotEmpty()) break }
                            if (name.isEmpty()) name = NameWire.cleanName(mdnsPtr(d.ip))
                            if (name.isEmpty()) name = NameWire.cleanName(netbios(d.ip))
                            val now = System.currentTimeMillis()
                            synchronized(nameCache) {
                                if (name.isNotEmpty()) nameCache[d.ip] = name to now
                                else nameCache[d.ip]?.let { (n, at) -> if (now - at < 6 * 3600_000) name = n }
                            }
                            d.name = name
                        }
                    }
                }.awaitAll()
            }
        } finally { try { lock?.release() } catch (e: Exception) { } }

        // 3. Open ports, now and then: the ones that let someone in without you knowing.
        if (withPorts) {
            coroutineScope {
                alive.filter { it.ip != net.self }.map { d ->
                    async { gate.withPermit { d.ports = RISK_PORTS.filter { open(d.ip, it, 300) } } }
                }.awaitAll()
            }
        }

        val sorted = alive.sortedBy { ipToInt(it.ip).toLong() and 0xffffffffL }
        ScanResult("${intToIp(net.base)}/${net.prefix}", System.currentTimeMillis() - started, sorted)
    }

    /** Milliseconds to answer, or null when nothing answered: ICMP if allowed, else a TCP knock on common ports. */
    private fun probe(ip: String): Int? {
        val t0 = System.nanoTime()
        try { if (InetAddress.getByName(ip).isReachable(600)) return ((System.nanoTime() - t0) / 1_000_000).toInt().coerceAtLeast(1) } catch (e: Exception) { }
        for (port in PROBE_PORTS) {
            val t = System.nanoTime()
            val s = Socket()
            try {
                s.connect(InetSocketAddress(ip, port), 250)
                return ((System.nanoTime() - t) / 1_000_000).toInt().coerceAtLeast(1)
            } catch (e: java.net.ConnectException) {
                // "Connection refused" comes from the device itself: it is there, just not listening on that port.
                if ((e.message ?: "").contains("refused", true)) return ((System.nanoTime() - t) / 1_000_000).toInt().coerceAtLeast(1)
            } catch (e: Exception) {
            } finally { try { s.close() } catch (e: Exception) { } }
        }
        return null
    }

    private fun open(ip: String, port: Int, timeoutMs: Int): Boolean {
        val s = Socket()
        return try { s.connect(InetSocketAddress(ip, port), timeoutMs); true } catch (e: Exception) { false } finally { try { s.close() } catch (e: Exception) { } }
    }

    private fun udp(payload: ByteArray, host: String, port: Int, timeoutMs: Int, accept: (ByteArray) -> String?): String? {
        DatagramSocket().use { sock ->
            sock.soTimeout = timeoutMs
            sock.send(DatagramPacket(payload, payload.size, InetAddress.getByName(host), port))
            val buf = ByteArray(1500)
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                val p = DatagramPacket(buf, buf.size)
                try { sock.receive(p) } catch (e: SocketTimeoutException) { return null }
                val got = accept(buf.copyOf(p.length))
                if (got != null) return got
            }
        }
        return null
    }

    private fun dnsPtr(ip: String, server: String): String? = try {
        val id = Random.nextInt(1, 0xffff)
        udp(NameWire.ptrQuery(ip, id), server, 53, 700) { NameWire.parsePtrAnswer(it, id) }
    } catch (e: Exception) { null }

    /** Asks the device itself over mDNS, with the "answer me directly" bit, by sending to it and to the group. */
    private fun mdnsPtr(ip: String): String? = try {
        val q = NameWire.ptrQuery(ip, 0, mdns = true)
        DatagramSocket().use { sock ->
            sock.soTimeout = 400
            sock.send(DatagramPacket(q, q.size, InetAddress.getByName(ip), 5353))
            sock.send(DatagramPacket(q, q.size, InetAddress.getByName("224.0.0.251"), 5353))
            val buf = ByteArray(1500)
            val deadline = System.currentTimeMillis() + 800
            var found: String? = null
            while (found == null && System.currentTimeMillis() < deadline) {
                val p = DatagramPacket(buf, buf.size)
                try { sock.receive(p) } catch (e: SocketTimeoutException) { break }
                if (p.address?.hostAddress == ip || p.address?.hostAddress == null) found = NameWire.parsePtrAnswer(buf.copyOf(p.length))
            }
            found
        }
    } catch (e: Exception) { null }

    private fun netbios(ip: String): String? = try {
        val id = Random.nextInt(1, 0xffff)
        udp(NameWire.netbiosQuery(id), ip, 137, 500) { NameWire.parseNetbiosAnswer(it, id) }
    } catch (e: Exception) { null }
}
