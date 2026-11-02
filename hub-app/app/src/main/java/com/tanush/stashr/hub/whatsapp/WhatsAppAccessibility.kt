package com.tanush.stashr.hub.whatsapp

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Looks at WhatsApp only while [WhatsAppSender] has a message waiting: taps the group in the share list (scrolling,
 * then searching if it is not visible) and presses Send. It never reads or stores anything else.
 */
class WhatsAppAccessibility : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private var lastAttempt = 0L

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { if (instance === this) instance = null; return super.onUnbind(intent) }
    override fun onInterrupt() {}
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) { if (WhatsAppSender.job != null) poke() }

    /** Called by events and by the sender's 500 ms loop; one attempt at a time, at most every 250 ms. */
    fun poke() { main.post { attempt() } }

    private fun attempt() {
        val job = WhatsAppSender.job ?: return
        if (job.done || job.error != null) return
        val now = System.currentTimeMillis()
        if (now - lastAttempt < 250) return
        lastAttempt = now
        val root = rootInActiveWindow ?: return
        try {
            val pkg = root.packageName?.toString() ?: return
            if (pkg != "com.whatsapp" && pkg != "com.whatsapp.w4b") return
            if (!job.picked) pickGroup(root, job) else pressSend(root, job)
        } finally { try { root.recycle() } catch (e: Exception) { } }
    }

    private fun pickGroup(root: AccessibilityNodeInfo, job: WhatsAppSender.Job) {
        val hit = root.findAccessibilityNodeInfosByText(job.group).orEmpty().firstOrNull { !it.isEditable && it.className?.toString()?.contains("EditText") != true }
        if (hit != null && clickUp(hit)) { job.picked = true; return }
        // Not visible: scroll a few times, then use the search box.
        if (job.scrolls < 5) {
            job.scrolls++
            val list = firstScrollable(root)
            if (list != null && list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return
            job.scrolls = 5
        }
        if (!job.searched) {
            val s = root.findAccessibilityNodeInfosByText("Search").orEmpty().firstOrNull { it.contentDescription?.toString().equals("Search", true) && !it.isEditable }
            if (s != null && clickUp(s)) job.searched = true else job.misses++
        } else if (!job.typed) {
            val edit = findEditable(root)
            if (edit != null) {
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, job.group) }
                if (edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) job.typed = true
            } else job.misses++
        } else job.misses++
        if (job.misses > 12 || (job.typed && ++job.misses > 12)) job.error = "Group not found"
    }

    /**
     * WhatsApp's share flow can have two Send steps (a bar under the chosen chat, then the preview with the text), so one
     * click is not "sent". After a click it waits 1.5 s for the next screen; the message counts as sent once no Send button
     * has shown for 2.5 s after at least one click. The same button is never pressed twice within 1.5 s.
     */
    private fun pressSend(root: AccessibilityNodeInfo, job: WhatsAppSender.Job) {
        val now = System.currentTimeMillis()
        if (job.clicks > 0 && now - job.lastClick < 1_500) return
        val btn = findSendButton(root)
        if (btn != null) {
            if (clickUp(btn)) { job.clicks++; job.lastClick = now; job.misses = 0 }
            return
        }
        if (job.clicks > 0) { if (now - job.lastClick > 2_500) job.done = true }
        else if (++job.misses > 40) job.error = "Could not find WhatsApp's Send button"
    }

    private fun findSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        for (id in SEND_IDS) root.findAccessibilityNodeInfosByViewId(id).orEmpty().firstOrNull { it.isVisibleToUser }?.let { return it }
        for (w in SEND) {
            val n = root.findAccessibilityNodeInfosByText(w).orEmpty().firstOrNull {
                it.isVisibleToUser && !it.isEditable && (it.text?.toString().equals(w, true) || it.contentDescription?.toString().equals(w, true))
            }
            if (n != null) return n
        }
        return null
    }

    private fun clickUp(n: AccessibilityNodeInfo): Boolean {
        var cur: AccessibilityNodeInfo? = n
        var hops = 0
        while (cur != null && hops < 7) {
            if (cur.isClickable && cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            cur = cur.parent; hops++
        }
        return false
    }

    private fun firstScrollable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (n.isScrollable) return n
        for (i in 0 until n.childCount) { val c = n.getChild(i) ?: continue; firstScrollable(c)?.let { return it } }
        return null
    }

    private fun findEditable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (n.isEditable) return n
        for (i in 0 until n.childCount) { val c = n.getChild(i) ?: continue; findEditable(c)?.let { return it } }
        return null
    }

    companion object {
        @Volatile var instance: WhatsAppAccessibility? = null
        private val SEND = listOf("Send", "भेजें", "Enviar", "Envoyer")
        private val SEND_IDS = listOf("com.whatsapp:id/send", "com.whatsapp.w4b:id/send")
    }
}
