package com.tanush.stashr.where

import com.tanush.stashr.where.core.StatusText
import org.junit.Assert.assertEquals
import org.junit.Test

class StatusTextTest {
    @Test fun sayHelloWithTheNameWhenThereIsOne() {
        assertEquals("Hello Papa, connected to your home", StatusText.message("Papa"))
        assertEquals("Hello Papa, connected to your home", StatusText.message("  Papa "))
    }
    @Test fun withoutANameItStillSaysHello() {
        assertEquals("Hello, connected to your home", StatusText.message(""))
        assertEquals("Hello, connected to your home", StatusText.message("   "))
    }
    @Test fun aLongNameIsCut() {
        assertEquals("Hello ${"a".repeat(24)}, connected to your home", StatusText.message("a".repeat(60)))
    }
}
