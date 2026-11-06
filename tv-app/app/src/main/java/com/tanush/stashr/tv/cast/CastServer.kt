package com.tanush.stashr.tv.cast

import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.ui.CastReceiverActivity
import java.io.BufferedInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

/** What the receiver screen listens to. */
interface CastListener {
    fun onSize(w: Int, h: Int)
    fun onEnded(reason: String)
}

/** The cast that is running now (at most one) and the screen that shows it. */
object CastHub {
    @Volatile var session: CastSession? = null
    @Volatile var listener: CastListener? = null
    @Volatile var port = 0
    @Volatile var lastSize: Pair<Int, Int>? = null

    fun active() = session != null
    fun from() = session?.hello?.name ?: ""
    /** Back on the remote, the phone closing, or `mirror_stop`: end the cast and tell the phone. */
    fun stop(reason: String = "Stopped") { session?.end(reason, tellClient = true) }
}

class CastSession(val hello: Hello, private val socket: Socket, private val out: OutputStream, private val main: Handler) {
    @Volatile var lastPacketAt = System.currentTimeMillis()
    @Volatile private var ended = false
    private var lastAskAt = 0L
    val audio: CastAudio? = if (hello.audio) CastAudio().also { try { it.start() } catch (e: Exception) { /* no sound device */ } } else null
    val decoder = CastDecoder(
        onSize = { w, h -> CastHub.lastSize = w to h; main.post { CastHub.listener?.onSize(w, h) } },
        onNeedKey = { askKey() }
    )

    fun askKey() {
        val now = System.currentTimeMillis()
        if (!CastLogic.mayAskKey(lastAskAt, now)) return
        lastAskAt = now
        sendByte(Cast.ASK_KEY)
    }

    @Synchronized private fun sendByte(b: Int) { try { out.write(b); out.flush() } catch (e: IOException) { /* the phone is gone */ } }

    fun end(reason: String, tellClient: Boolean) {
        if (ended) return
        ended = true
        if (tellClient) sendByte(Cast.STOP)
        try { socket.close() } catch (e: IOException) { /* closed */ }
        decoder.release(); audio?.release()
        if (CastHub.session === this) { CastHub.session = null; CastHub.lastSize = null }
        main.post { CastHub.listener?.onEnded(reason) }
    }
}

/**
 * The TV end of screen mirroring: a TCP server (port 8766, or the next free one up to 8770) announced on the Wi-Fi as
 * "_stashr-cast._tcp". A phone must show the 4-digit PIN once (then it is remembered) and only one phone casts at a time.
 */
class CastServer(private val ctx: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = Prefs(ctx)
    private val guard = PinGuard()
    @Volatile private var server: ServerSocket? = null
    private var nsdListener: NsdManager.RegistrationListener? = null

    fun start() {
        if (server != null) return
        Thread({
            var s: ServerSocket? = null
            for (p in Cast.PORTS) {
                try { s = ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(p)) }; break } catch (e: IOException) { s = null }
            }
            val bound = s ?: run { prefs.lastError = "Screen mirror could not open a port (8766-8770)"; return@Thread }
            server = bound; CastHub.port = bound.localPort
            advertise(bound.localPort)
            while (!bound.isClosed) {
                try { val c = bound.accept(); Thread({ handle(c) }, "cast-conn").also { it.isDaemon = true; it.start() } } catch (e: IOException) { break }
            }
        }, "cast-accept").also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        CastHub.stop("The TV app stopped")
        try { server?.close() } catch (e: IOException) { /* closed */ }
        server = null; CastHub.port = 0
        val l = nsdListener; nsdListener = null
        if (l != null) try { (ctx.getSystemService(Context.NSD_SERVICE) as NsdManager).unregisterService(l) } catch (e: Exception) { /* not registered */ }
    }

    private fun advertise(port: Int) {
        try {
            val info = NsdServiceInfo().apply {
                serviceName = prefs.deviceName.ifBlank { "Stashr TV" }.filter { it >= ' ' }.take(40)
                serviceType = Cast.SERVICE_TYPE; setPort(port)
            }
            val l = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(i: NsdServiceInfo) {}
                override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) { prefs.lastError = "Screen mirror is not announced on the Wi-Fi (code $code)" }
                override fun onServiceUnregistered(i: NsdServiceInfo) {}
                override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
            }
            nsdListener = l
            (ctx.getSystemService(Context.NSD_SERVICE) as NsdManager).registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
        } catch (e: Exception) { prefs.lastError = "Screen mirror is not announced on the Wi-Fi" }
    }

    private fun handle(sock: Socket) {
        var session: CastSession? = null
        try {
            sock.tcpNoDelay = true; sock.soTimeout = 5000
            val input = BufferedInputStream(sock.getInputStream(), 64 * 1024)
            val out = sock.getOutputStream()
            val addr = sock.inetAddress?.hostAddress ?: "?"
            val now = System.currentTimeMillis()
            if (Handshake.readLine(input, 64) != Cast.HELLO) { sock.close(); return }
            if (guard.isBlocked(addr, now)) { reply(out, Handshake.error("Not allowed")); sock.close(); return }
            val hello = Handshake.parseHello(Handshake.readLine(input, 2048) ?: "") ?: run { reply(out, Handshake.error("Not allowed")); sock.close(); return }

            // Who is it? (no side effects until we know the TV is free)
            val tokens = Tokens.parse(prefs.castTokens)
            val known = hello.token?.let { Tokens.find(tokens, it) }
            val pinOk = known == null && Pin.matches(prefs.castPin(), hello.pin)
            if (known == null && !pinOk) {
                if (hello.pin != null) guard.fail(addr, now)
                reply(out, Handshake.error(if (hello.pin != null) "Wrong PIN" else "Not allowed")); sock.close(); return
            }
            val cur = CastHub.session
            if (cur != null && CastLogic.busy(true, cur.lastPacketAt, now)) { reply(out, Handshake.error("TV is busy")); sock.close(); return }
            cur?.end("Another phone took over", tellClient = true)

            val token = known?.token ?: Tokens.newToken().also {
                prefs.castTokens = Tokens.toJson(Tokens.add(tokens, CastToken(it, hello.name, now)))
                prefs.rotateCastPin()
                guard.success(addr)
            }
            reply(out, Handshake.ok(token))
            sock.soTimeout = Cast.IDLE_MS.toInt()

            session = CastSession(hello, sock, out, main)
            CastHub.session = session
            try {
                ctx.startActivity(Intent(ctx, CastReceiverActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            } catch (e: Exception) {
                prefs.lastError = "Could not open the mirror screen: allow Display over other apps in Stashr TV settings"
                session.end("The TV could not open the mirror screen", tellClient = true); return
            }

            while (true) {
                val p = PacketIO.read(input) ?: break
                session.lastPacketAt = System.currentTimeMillis()
                when (p.type) {
                    Cast.T_CONFIG -> session.decoder.setConfig(p.payload, hello.w, hello.h)
                    Cast.T_KEY -> session.decoder.feed(p.payload, true, p.ptsUs)
                    Cast.T_DELTA -> session.decoder.feed(p.payload, false, p.ptsUs)
                    Cast.T_AUDIO -> session.audio?.write(p.payload)
                }
            }
            session.end("The phone stopped sharing", tellClient = false)
        } catch (e: SocketTimeoutException) {
            session?.end("No data from the phone for 10 seconds", tellClient = true)
        } catch (e: Exception) {
            session?.end("Connection lost", tellClient = false)
        } finally {
            try { sock.close() } catch (e: IOException) { /* closed */ }
        }
    }

    private fun reply(out: OutputStream, line: String) { out.write(line.toByteArray()); out.flush() }
}
