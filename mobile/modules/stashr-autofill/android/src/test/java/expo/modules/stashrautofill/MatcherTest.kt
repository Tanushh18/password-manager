package expo.modules.stashrautofill

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MatcherTest {
  private fun c(id: String, name: String, url: String = "", user: String = "u") = Credential(id, name, user, "pw", url)

  private val vault = listOf(
    c("1", "Instagram", "https://www.instagram.com", "personal"),
    c("2", "Instagram Business", "instagram.com", "biz"),
    c("3", "Gmail", "https://mail.google.com"),
    c("4", "Netflix"),
    c("5", "GitHub", "github.com"),
  )

  @Test fun appMatchesByPackageName() {
    val ids = Matcher.match(vault, "com.instagram.android", "Instagram", null).map { it.id }
    assertEquals(listOf("1", "2"), ids)
  }

  @Test fun appMatchesByLabelWhenPackageIsOpaque() {
    val ids = Matcher.match(vault, "com.nflx.mediaclient", "Netflix", null).map { it.id }
    assertEquals(listOf("4"), ids)
  }

  @Test fun unrelatedAppMatchesNothing() {
    assertTrue(Matcher.match(vault, "com.whatsapp", "WhatsApp", null).isEmpty())
  }

  @Test fun browserMatchesByDomain() {
    val ids = Matcher.match(vault, "com.android.chrome", "Chrome", "https://github.com/login").map { it.id }
    assertEquals(listOf("5"), ids)
  }

  @Test fun browserMatchesSubdomainToSavedDomain() {
    val ids = Matcher.match(vault, "com.android.chrome", "Chrome", "accounts.google.com").map { it.id }
    assertEquals(listOf("3"), ids)
  }

  @Test fun browserWithoutUrlMatchesNothing() {
    assertTrue(Matcher.match(vault, "com.android.chrome", "Chrome", null).isEmpty())
  }

  @Test fun genericPackageWordsDoNotCauseFalseMatches() {
    val v = listOf(c("1", "Android"), c("2", "App"))
    assertTrue(Matcher.match(v, "com.example.app", "Example", null).isEmpty())
  }

  @Test fun domainParsing() {
    assertEquals("instagram.com", Matcher.domainOf("https://www.instagram.com/x?y=1"))
    assertEquals("", Matcher.domainOf("localhost"))
    assertEquals("google", Matcher.baseLabel("accounts.google.com"))
    assertEquals("bbc", Matcher.baseLabel("news.bbc.co.uk"))
  }

  @Test fun linkedLoginComesFirstAndIsNotDuplicated() {
    val ids = Matcher.match(vault, "com.instagram.android", "Instagram", null, setOf("4", "2")).map { it.id }
    assertEquals(listOf("2", "4", "1"), ids)
  }

  @Test fun linkedLoginAppearsEvenWhenNothingElseMatches() {
    val ids = Matcher.match(vault, "com.some.bankapp", "Some Bank", null, setOf("3")).map { it.id }
    assertEquals(listOf("3"), ids)
  }

  @Test fun siteKeys() {
    assertEquals("app:com.instagram.android", Matcher.siteKey("com.instagram.android", null))
    assertEquals("web:google.com", Matcher.siteKey("com.android.chrome", "https://accounts.google.com/signin"))
    assertEquals(null, Matcher.siteKey("com.android.chrome", null))
  }

  @Test fun androidAppUrlMatchesThatApp() {
    val v = listOf(c("9", "My bank", "androidapp://com.some.bankapp"))
    assertEquals(listOf("9"), Matcher.match(v, "com.some.bankapp", "Whatever", null).map { it.id })
  }

  @Test fun linksRoundTrip() {
    val links = mapOf("web:google.com" to setOf("a", "b"), "app:com.x" to setOf("c"))
    assertEquals(links, Links.parse(Links.toJson(links)))
    val pending = listOf("web:google.com" to "a", "app:com.x" to "c")
    assertEquals(pending, Links.parsePending(Links.pendingToJson(pending)))
    assertTrue(Links.parse("not json").isEmpty())
  }
}
