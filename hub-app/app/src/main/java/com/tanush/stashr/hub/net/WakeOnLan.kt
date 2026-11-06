package com.tanush.stashr.hub.net

import android.content.Context
import android.net.ConnectivityManager
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress

/** Wake-on-LAN: the "magic packet" (6 × FF, then the MAC 16 times) broadcast on the home Wi-Fi. */
object WakeOnLan {
    fun parseMac(mac: String): ByteArray {
        val parts = mac.trim().split(':', '-')
        require(parts.size == 6 && parts.all { Regex("^[0-9a-fA-F]{2}$").matches(it) }) { "That MAC address does not look right (like aa:bb:cc:dd:ee:ff)." }
        return ByteArray(6) { parts[it].toInt(16).toByte() }
    }

    fun magicPacket(mac: ByteArray): ByteArray = ByteArray(6 + 16 * 6) { i -> if (i < 6) 0xff.toByte() else mac[(i - 6) % 6] }

    /** The broadcast address of the Wi-Fi subnet, e.g. 192.168.1.255, or null. */
    private fun subnetBroadcast(ctx: Context): String? = try {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val la = cm?.getLinkProperties(cm.activeNetwork)?.linkAddresses?.firstOrNull { it.address is Inet4Address }
        if (la == null) null else {
            val b = la.address.address
            val ip = ((b[0].toInt() and 0xff) shl 24) or ((b[1].toInt() and 0xff) shl 16) or ((b[2].toInt() and 0xff) shl 8) or (b[3].toInt() and 0xff)
            val host = if (la.prefixLength >= 32) 0 else (-1 ushr la.prefixLength)
            val bc = ip or host
            "${(bc ushr 24) and 0xff}.${(bc ushr 16) and 0xff}.${(bc ushr 8) and 0xff}.${bc and 0xff}"
        }
    } catch (e: Exception) { null }

    fun send(ctx: Context, mac: String): String {
        val packet = magicPacket(parseMac(mac))
        val targets = listOfNotNull(subnetBroadcast(ctx), "255.255.255.255").distinct()
        var sent = 0
        DatagramSocket().use { s ->
            s.broadcast = true
            for (t in targets) for (port in intArrayOf(9, 7)) {
                try { s.send(DatagramPacket(packet, packet.size, InetAddress.getByName(t), port)); sent++ } catch (e: Exception) { }
            }
        }
        if (sent == 0) throw IllegalStateException("Could not send the wake-up packet on this network.")
        return "Wake-up packet sent to ${mac.lowercase()}"
    }
}
