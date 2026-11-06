package com.tanush.stashr.where.core

/** The words of the always-there notification of Stashr Location. */
object StatusText {
    const val TITLE = "Stashr Location"

    /** "Hello Papa, connected to your home" (or without the name when the phone has none). */
    fun message(name: String): String {
        val n = name.trim().take(24)
        return if (n.isEmpty()) "Hello, connected to your home" else "Hello $n, connected to your home"
    }
}
