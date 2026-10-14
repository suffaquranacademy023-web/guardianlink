package com.guardianlink.app

import android.app.*
import android.app.admin.DevicePolicyManager
import android.content.*
import android.location.Location
import android.location.LocationManager
import android.os.BatteryManager
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Foreground service with a permanent, non-dismissable notice. Only runs for an enrolled, consenting device. */
class MonitoringService : Service() {
    private var exec: ScheduledExecutorService? = null

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val s = Session(this)
        if (!s.enrolled) { stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("gl", "GuardianLink", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(1, NotificationCompat.Builder(this, "gl").setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("GuardianLink is sharing this device's location with your family")
            .setContentText("Tap to see what is shared or to leave the family.").setOngoing(true).setContentIntent(open).build())
        exec?.shutdownNow()
        exec = Executors.newSingleThreadScheduledExecutor().also {
            it.scheduleWithFixedDelay({ runCatching { tick(s) } }, 0, 60, TimeUnit.SECONDS)
        }
        return START_STICKY
    }

    private fun tick(s: Session) {
        val bat = getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val loc = lastLocation()
        try {
            Api.telemetry(s, bat, loc?.latitude, loc?.longitude, loc?.accuracy)
            for ((id, type) in Api.commands(s)) if (type == "lock") {
                val dpm = getSystemService(DevicePolicyManager::class.java)
                if (dpm.isAdminActive(ComponentName(this, LockAdmin::class.java))) dpm.lockNow()
                Api.ack(s, id)
            }
        } catch (e: ApiException) {
            if (e.status == 401) { s.clear(); stopSelf() } // access revoked by parent
        }
    }

    @Suppress("MissingPermission")
    private fun lastLocation(): Location? = runCatching {
        val lm = getSystemService(LocationManager::class.java)
        lm.getProviders(true).mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }
    }.getOrNull()

    override fun onDestroy() { exec?.shutdownNow(); super.onDestroy() }
}

class LockAdmin : android.app.admin.DeviceAdminReceiver()

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_BOOT_COMPLETED || !Session(c).enrolled) return
        try { c.startForegroundService(Intent(c, MonitoringService::class.java)) }
        catch (e: Exception) {
            // Android 14+ blocks starting a location foreground service from boot. Tell the user to reopen the app instead.
            val nm = c.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("gl-alert", "GuardianLink alerts", NotificationManager.IMPORTANCE_DEFAULT))
            val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            nm.notify(2, NotificationCompat.Builder(c, "gl-alert").setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("GuardianLink is paused").setContentText("Tap to resume sharing with your family.").setContentIntent(open).setAutoCancel(true).build())
        }
    }
}
