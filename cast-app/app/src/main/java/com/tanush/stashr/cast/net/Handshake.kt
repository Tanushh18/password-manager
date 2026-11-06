package com.tanush.stashr.cast.net

import com.tanush.stashr.cast.core.Logic
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket

/** Opens the connection to a TV and does the hello. Blocking: call from a background thread. */
object Handshake {
    class Result(val socket: Socket, val reply: Logic.Reply)

    /** Returns the connected socket and the TV's answer. A TV that says no is not an exception: look at reply.ok. */
    fun connect(host: String, port: Int, name: String, pin: String?, token: String?, w: Int, h: Int, fps: Int, audio: Boolean): Result {
        val s = Socket()
        try {
            s.tcpNoDelay = true
            s.keepAlive = true
            s.connect(InetSocketAddress(host, port), 4000)
            s.soTimeout = 8000
            val out = s.getOutputStream()
            out.write((Logic.MAGIC + "\n" + Logic.helloJson(name, pin, token, w, h, fps, audio) + "\n").toByteArray())
            out.flush()
            val reply = Logic.parseReply(readLine(s.getInputStream()))
            s.soTimeout = 0
            if (!reply.ok) { s.close() }
            return Result(s, reply)
        } catch (e: Exception) {
            try { s.close() } catch (_: Exception) { }
            throw if (e is IOException) IOException(friendly(e), e) else e
        }
    }

    private fun friendly(e: IOException): String = when (e) {
        is java.net.SocketTimeoutException -> "The TV did not answer. Is Stashr TV open on it?"
        is java.net.ConnectException -> "Could not reach the TV. Are the phone and the TV on the same Wi-Fi?"
        is java.net.UnknownHostException -> "That TV address was not found."
        else -> e.message ?: "Could not connect to the TV."
    }

    /** One line (up to 4 KB) without reading past it, so the packets that follow stay in the stream. */
    private fun readLine(input: InputStream): String {
        val sb = StringBuilder()
        while (sb.length < 4096) {
            val b = input.read()
            if (b < 0) throw IOException("The TV closed the connection.")
            if (b == '\n'.code) return sb.toString()
            sb.append(b.toChar())
        }
        throw IOException("The TV's answer was too long.")
    }
}
