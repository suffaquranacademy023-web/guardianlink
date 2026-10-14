package com.guardianlink.app

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import java.net.UnknownHostException
import java.net.SocketTimeoutException
import androidx.compose.ui.unit.dp
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val session = Session(this)
        setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { App(session) } } }
    }

    @Composable
    fun App(s: Session) {
        var enrolled by remember { mutableStateOf(s.enrolled) }
        var code by remember { mutableStateOf("") }
        var name by remember { mutableStateOf(Build.MODEL ?: "Child device") }
        var agreed by remember { mutableStateOf(false) }
        var msg by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            startForegroundService(Intent(this, MonitoringService::class.java))
        }

        Column(Modifier.padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("GuardianLink", style = MaterialTheme.typography.headlineMedium)
            if (!enrolled) {
                Text("This app shares the following with your family organiser:\n• Approximate location\n• Battery level\n• Which device this is\n\nA permanent notification is always shown while sharing. You can leave the family at any time from this screen.")
                OutlinedTextField(code, { code = it.uppercase().take(8) }, label = { Text("Pairing code from the parent") }, singleLine = true)
                OutlinedTextField(name, { name = it.take(100) }, label = { Text("Device name") }, singleLine = true)
                Row { Checkbox(agreed, { agreed = it }); Text("I understand and agree to share this information.", Modifier.padding(top = 12.dp)) }
                Button(enabled = agreed && code.length == 8 && !busy, onClick = {
                    busy = true; msg = ""
                    thread {
                        try { Api.enroll(code, name, s); runOnUiThread { enrolled = true
                            perms.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)) } }
                        catch (e: Exception) { runOnUiThread { msg = when (e) {
                            is UnknownHostException, is SocketTimeoutException -> "Cannot reach the server. Check your internet connection and try again."
                            is ApiException -> if (e.status == 401) "That code is invalid, expired or already used. Ask the parent for a new one." else e.message ?: "Failed"
                            else -> e.message ?: "Failed" } } }
                        finally { runOnUiThread { busy = false } }
                    }
                }) { Text("Join family") }
                if (busy) CircularProgressIndicator()
            } else {
                Text("This device is part of a family and is sharing location and battery level. Last status is shown in the notification.")
                Button(onClick = {
                    startActivity(Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, ComponentName(this@MainActivity, LockAdmin::class.java))
                        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Lets a parent request that this screen be locked."))
                }) { Text("Allow parent lock requests (optional)") }
                OutlinedButton(onClick = {
                    thread {
                        runCatching { Api.leave(s) }
                        s.clear(); stopService(Intent(this@MainActivity, MonitoringService::class.java))
                        runOnUiThread { enrolled = false }
                    }
                }) { Text("Leave family and stop sharing") }
            }
            if (msg.isNotEmpty()) Text(msg, color = MaterialTheme.colorScheme.error)
        }
    }
}
