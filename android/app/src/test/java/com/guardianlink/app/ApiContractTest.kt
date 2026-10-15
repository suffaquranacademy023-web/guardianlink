package com.guardianlink.app

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * JVM contract tests against a minimal stub HTTP server (plain java.net) that mirrors server/src/app.js responses.
 * Real end-to-end verification still needs the actual backend.
 */
class ApiContractTest {
    private lateinit var ss: ServerSocket
    @Volatile private var lastBody = ""
    @Volatile private var lastKey: String? = null

    private fun handle(path: String, headers: Map<String, String>, body: String): Pair<Int, String> {
        lastBody = body; lastKey = headers["x-device-key"]
        return when (path) {
            "/api/devices/enroll" -> if (JSONObject(body).optString("code") == "ABCD2345") 201 to """{"deviceId":7,"deviceKey":"k3y"}"""
                                     else 401 to """{"error":"Invalid or expired pairing code"}"""
            "/api/device/telemetry" -> 200 to """{"ok":true}"""
            "/api/device/commands" -> if (headers["x-device-key"] == "k3y") 200 to """{"commands":[{"id":3,"type":"lock"}]}""" else 401 to """{"error":"Unauthorized"}"""
            else -> 404 to """{"error":"Not found"}"""
        }
    }

    @Before fun up() {
        ss = ServerSocket(0, 5, java.net.InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (!ss.isClosed) {
                val s = try { ss.accept() } catch (e: Exception) { break }
                thread(isDaemon = true) {
                    s.use { sock ->
                        val inp = sock.getInputStream().buffered()
                        fun line(): String { val b = ByteArrayOutputStream(); while (true) { val c = inp.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) b.write(c) }; return b.toString("UTF-8") }
                        val first = line().split(" ")
                        val headers = HashMap<String, String>()
                        while (true) { val l = line(); if (l.isEmpty()) break; val i = l.indexOf(':'); if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim() }
                        val len = headers["content-length"]?.toIntOrNull() ?: 0
                        val body = if (len > 0) String(ByteArray(len).also { var n = 0; while (n < len) { val r = inp.read(it, n, len - n); if (r < 0) break; n += r } }, Charsets.UTF_8) else ""
                        val (code, resp) = handle(first[1], headers, body)
                        val bytes = resp.toByteArray()
                        sock.getOutputStream().apply {
                            write("HTTP/1.1 $code X\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(bytes); flush()
                        }
                    }
                }
            }
        }
        Api.baseUrl = "http://127.0.0.1:${ss.localPort}"
    }

    @After fun down() = ss.close()

    @Test fun invalidCodeSurfacesServerMessage() {
        try { Api.enrollRaw("WRONG000", "Pixel"); fail("expected ApiException") }
        catch (e: ApiException) { assertEquals(401, e.status); assertTrue(e.message!!.contains("expired")) }
    }

    @Test fun enrollSendsConsentAndPlatform() {
        val r = Api.enrollRaw("ABCD2345", "Pixel")
        assertEquals(7L, r.first); assertEquals("k3y", r.second)
        val j = JSONObject(lastBody)
        assertTrue(j.getBoolean("consent")); assertEquals("android", j.getString("platform"))
    }
}
