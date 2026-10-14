package com.guardianlink.app

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Encrypted storage for the per-device key (never a shared/hardcoded token). */
class Session(ctx: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        ctx, "gl_session", MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    var deviceId: Long
        get() = prefs.getLong("id", 0); set(v) = prefs.edit().putLong("id", v).apply()
    var deviceKey: String?
        get() = prefs.getString("key", null); set(v) = prefs.edit().putString("key", v).apply()
    val enrolled get() = deviceId > 0 && deviceKey != null
    fun clear() = prefs.edit().clear().apply()
}

class ApiException(val status: Int, msg: String) : Exception(msg)

object Api {
    /** Overridable for tests. Release builds must use https (enforced by network security + this check). */
    @Volatile var baseUrl: String = BuildConfig.SERVER_URL

    private fun call(method: String, path: String, body: JSONObject?, s: Session?): JSONObject {
        if (!BuildConfig.DEBUG && !baseUrl.startsWith("https://")) throw ApiException(0, "Server URL must use https")
        val c = URL(baseUrl + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 15000; c.readTimeout = 15000
        c.setRequestProperty("Content-Type", "application/json")
        if (s != null) { c.setRequestProperty("X-Device-Id", s.deviceId.toString()); c.setRequestProperty("X-Device-Key", s.deviceKey ?: "") }
        if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toString().toByteArray()) } }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText().orEmpty()
        val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        if (code >= 400) throw ApiException(code, json.optString("error", "HTTP $code"))
        return json
    }

    /** Returns (deviceId, deviceKey). Separated from Session so it is unit-testable on the JVM. */
    fun enrollRaw(code: String, name: String): Pair<Long, String> {
        val r = call("POST", "/api/devices/enroll", JSONObject().put("code", code).put("name", name).put("platform", "android").put("consent", true), null)
        return r.getLong("deviceId") to r.getString("deviceKey")
    }
    fun enroll(code: String, name: String, s: Session) {
        val (id, key) = enrollRaw(code, name)
        s.deviceId = id; s.deviceKey = key
    }
    fun telemetry(s: Session, battery: Int, lat: Double?, lng: Double?, acc: Float?) {
        val b = JSONObject().put("battery", battery)
        if (lat != null && lng != null) { b.put("lat", lat).put("lng", lng); if (acc != null) b.put("accuracy", acc.toDouble()) }
        call("POST", "/api/device/telemetry", b, s)
    }
    fun commands(s: Session): List<Pair<Long, String>> {
        val a = call("GET", "/api/device/commands", null, s).getJSONArray("commands")
        return (0 until a.length()).map { a.getJSONObject(it).let { o -> o.getLong("id") to o.getString("type") } }
    }
    fun ack(s: Session, id: Long) { call("POST", "/api/device/commands/$id/ack", JSONObject(), s) }
    fun leave(s: Session) { call("POST", "/api/device/leave", JSONObject(), s) }
}
