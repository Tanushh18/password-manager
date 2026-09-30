package expo.modules.stashrautofill

import org.json.JSONArray
import org.json.JSONObject

object Links {
  fun parse(json: String): Map<String, Set<String>> {
    if (json.isBlank()) return emptyMap()
    return try {
      val o = JSONObject(json)
      o.keys().asSequence().associateWith { k ->
        val a = o.getJSONArray(k)
        (0 until a.length()).map { a.getString(it) }.toSet()
      }
    } catch (e: Exception) {
      emptyMap()
    }
  }

  fun toJson(links: Map<String, Set<String>>): String {
    val o = JSONObject()
    links.forEach { (k, ids) -> o.put(k, JSONArray(ids.toList())) }
    return o.toString()
  }

  fun parsePending(json: String): List<Pair<String, String>> {
    if (json.isBlank()) return emptyList()
    return try {
      val a = JSONArray(json)
      (0 until a.length()).map { val o = a.getJSONObject(it); o.getString("key") to o.getString("id") }
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun pendingToJson(list: List<Pair<String, String>>): String {
    val a = JSONArray()
    list.forEach { (k, id) -> a.put(JSONObject().put("key", k).put("id", id)) }
    return a.toString()
  }

  /** A login the user asked Android to save; waits here until the app can put it in the vault. */
  data class PendingSave(
    val ref: String,
    val existingId: String?,
    val name: String,
    val url: String,
    val username: String,
    val password: String,
  )

  fun parseSaves(json: String): List<PendingSave> {
    if (json.isBlank()) return emptyList()
    return try {
      val a = JSONArray(json)
      (0 until a.length()).map {
        val o = a.getJSONObject(it)
        PendingSave(
          ref = o.getString("ref"),
          existingId = if (o.isNull("existingId")) null else o.getString("existingId"),
          name = o.optString("name"),
          url = o.optString("url"),
          username = o.optString("username"),
          password = o.optString("password"),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun savesToJson(list: List<PendingSave>): String {
    val a = JSONArray()
    list.forEach {
      a.put(
        JSONObject()
          .put("ref", it.ref)
          .put("existingId", it.existingId ?: JSONObject.NULL)
          .put("name", it.name)
          .put("url", it.url)
          .put("username", it.username)
          .put("password", it.password)
      )
    }
    return a.toString()
  }

  fun credentialsToJson(list: List<Credential>): String {
    val a = JSONArray()
    list.forEach {
      a.put(
        JSONObject().put("id", it.id).put("name", it.name).put("username", it.username)
          .put("password", it.password).put("url", it.url)
      )
    }
    return a.toString()
  }
}
