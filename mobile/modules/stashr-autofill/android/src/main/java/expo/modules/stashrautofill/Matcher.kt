package expo.modules.stashrautofill

data class Credential(
  val id: String,
  val name: String,
  val username: String,
  val password: String,
  val url: String,
)

object Matcher {
  private val generic = setOf(
    "com", "org", "net", "io", "co", "in", "app", "apps", "android", "mobile", "www", "the",
    "release", "main", "client", "lite", "beta", "prod", "google", "browser", "activity",
  )

  private val browsers = setOf(
    "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "org.mozilla.firefox",
    "org.mozilla.fenix", "com.brave.browser", "com.microsoft.emmx", "com.sec.android.app.sbrowser",
    "com.opera.browser", "com.opera.mini.native", "com.heytap.browser", "com.coloros.browser",
    "com.duckduckgo.mobile.android", "com.vivaldi.browser", "com.kiwibrowser.browser",
  )

  fun isBrowser(pkg: String) = pkg in browsers

  fun domainOf(raw: String): String {
    val text = raw.trim().lowercase()
    if (text.isEmpty()) return ""
    val m = Regex("^(?:[a-z][a-z0-9+.-]*://)?(?:[^@/\\s]*@)?([^/:?#\\s]+)").find(text) ?: return ""
    val host = m.groupValues[1].removePrefix("www.")
    return if (host.contains('.')) host else ""
  }

  private fun hasTwoPartSuffix(parts: List<String>) =
    parts.size >= 3 && parts[parts.size - 2].length <= 3 && parts.last().length == 2

  /** "accounts.google.com" -> "google.com", "news.bbc.co.uk" -> "bbc.co.uk". */
  fun registrableDomain(domain: String): String {
    val parts = domain.split('.').filter { it.isNotEmpty() }
    if (parts.size <= 2) return domain
    return parts.takeLast(if (hasTwoPartSuffix(parts)) 3 else 2).joinToString(".")
  }

  /** "accounts.google.com" -> "google" (second-level label). */
  fun baseLabel(domain: String): String {
    val parts = domain.split('.').filter { it.isNotEmpty() }
    if (parts.size < 2) return domain
    return parts[parts.size - if (hasTwoPartSuffix(parts)) 3 else 2]
  }

  private fun squash(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

  fun tokensFor(pkg: String, label: String): Set<String> {
    val out = mutableSetOf<String>()
    pkg.lowercase().split('.').forEach { if (it.length >= 3 && it !in generic) out += squash(it) }
    label.lowercase().split(Regex("[^a-z0-9]+")).forEach { if (it.length >= 3 && it !in generic) out += it }
    val whole = squash(label)
    if (whole.length >= 3) out += whole
    return out
  }

  private fun matchesTokens(c: Credential, tokens: Set<String>): Boolean {
    if (tokens.isEmpty()) return false
    val name = squash(c.name)
    val base = squash(baseLabel(domainOf(c.url)))
    return tokens.any { t ->
      (name.length >= 3 && (name.contains(t) || t.contains(name))) ||
        (base.length >= 3 && (base == t || base.contains(t) || t.contains(base)))
    }
  }

  private fun matchesDomain(c: Credential, domain: String): Boolean {
    val itemDomain = domainOf(c.url)
    if (itemDomain.isNotEmpty() &&
      registrableDomain(itemDomain) == registrableDomain(domain)
    ) return true
    val base = squash(baseLabel(domain))
    val name = squash(c.name)
    return base.length >= 3 && name.length >= 3 && (name == base || name.contains(base) || base.contains(name))
  }

  /** Credentials for the app/site in front. Empty when nothing matches (caller shows everything). */
  fun match(all: List<Credential>, pkg: String, appLabel: String, browserUrl: String?): List<Credential> {
    if (isBrowser(pkg)) {
      val domain = browserUrl?.let { domainOf(it) }.orEmpty()
      if (domain.isEmpty()) return emptyList()
      return all.filter { matchesDomain(it, domain) }
    }
    val tokens = tokensFor(pkg, appLabel)
    return all.filter { matchesTokens(it, tokens) }
  }
}
