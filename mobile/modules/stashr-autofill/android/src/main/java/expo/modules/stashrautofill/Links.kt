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
}
