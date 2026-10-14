package com.guardianlink.app

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress

/** JVM contract tests against a stub server that mirrors server/src/app.js responses. Real end-to-end needs the actual backend. */
class ApiContractTest {
    private lateinit var srv: HttpServer
    private var lastHeaders: Map<String, List<String>> = emptyMap()
    private var lastBody = ""

    @Before fun up() {
        srv = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        srv.createContext("/api/devices/enroll") { ex ->
            lastBody = ex.requestBody.readBytes().decodeToString()
            val ok = JSONObject(lastBody).optString("code") == "ABCD2345"
            reply(ex, if (ok) 201 else 401, if (ok) """{"deviceId":7,"deviceKey":"k3y"}""" else """{"error":"Invalid or expired pairing code"}""")
        }
        srv.createContext("/api/device/telemetry") { ex -> lastHeaders = ex.requestHeaders.toMap(); lastBody = ex.requestBody.readBytes().decodeToString(); reply(ex, 200, """{"ok":true}""") }
        srv.createContext("/api/device/commands") { ex -> reply(ex, if (ex.requestHeaders.getFirst("X-Device-Key") == "k3y") 200 else 401, """{"commands":[{"id":3,"type":"lock"}]}""") }
        srv.start(); Api.baseUrl = "http://127.0.0.1:${srv.address.port}"
    }
    @After fun down() = srv.stop(0)

    private fun reply(ex: com.sun.net.httpserver.HttpExchange, code: Int, body: String) {
        val b = body.toByteArray(); ex.sendResponseHeaders(code, b.size.toLong()); ex.responseBody.use { it.write(b) }
    }
    @Test fun invalidCodeSurfacesServerMessage() {
        try { Api.enrollRaw("WRONG000", "Pixel"); fail() } catch (e: ApiException) { assertEquals(401, e.status); assertTrue(e.message!!.contains("expired")) }
    }
    @Test fun enrollSendsConsentAndPlatform() {
        val r = Api.enrollRaw("ABCD2345", "Pixel")
        assertEquals(7L, r.first); assertEquals("k3y", r.second)
        val j = JSONObject(lastBody); assertTrue(j.getBoolean("consent")); assertEquals("android", j.getString("platform"))
    }
}
