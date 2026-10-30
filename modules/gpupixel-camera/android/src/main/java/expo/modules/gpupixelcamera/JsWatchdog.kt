package expo.modules.gpupixelcamera

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.os.Process
import android.os.SystemClock
import android.util.Log

/**
 * Live-room freeze detector. JS sends a heartbeat every second while a live is open. If it stops for 6 s the JS thread
 * is blocked (a sync native call that never returns, or a JS loop): every thread's stack + the last JS steps are written
 * to the crash report (shown with a Copy button on the next start), and a native dialog lets the user close the app,
 * because no JS button can work while JS is frozen.
 */
object JsWatchdog {
  @Volatile private var last = 0L
  @Volatile private var armed = false
  @Volatile private var fired = false
  private var thread: Thread? = null
  private val marks = ArrayDeque<String>()
  private val t0 = SystemClock.uptimeMillis()

  fun mark(line: String) {
    synchronized(marks) {
      marks.addLast("${(SystemClock.uptimeMillis() - t0) / 100 / 10.0}s $line")
      while (marks.size > 80) marks.removeFirst()
    }
  }

  fun beat(ctx: Context, activity: () -> Activity?) {
    last = SystemClock.uptimeMillis()
    armed = true
    fired = false
    if (thread == null) start(ctx.applicationContext, activity)
  }

  fun stop() { armed = false }

  private fun start(app: Context, activity: () -> Activity?) {
    thread = Thread({
      while (true) {
        try { Thread.sleep(1000) } catch (_: InterruptedException) { return@Thread }
        if (!armed || fired) continue
        val gap = SystemClock.uptimeMillis() - last
        if (gap < 6000) continue
        fired = true
        val dump = buildDump(gap)
        Log.e("BeeWatchdog", dump)
        CrashLog.writeReport(app, dump)
        val a = activity() ?: continue
        a.runOnUiThread {
          try {
            AlertDialog.Builder(a)
              .setTitle("Live is not responding")
              .setMessage("The app stopped responding. Close it now? A report will be shown on the next start (please copy it and send it to support).")
              .setPositiveButton("Close app") { _, _ -> a.finishAffinity(); Process.killProcess(Process.myPid()) }
              .setNegativeButton("Wait", null)
              .show()
          } catch (_: Throwable) { }
        }
      }
    }, "bee-js-watchdog").apply { isDaemon = true; start() }
  }

  private fun buildDump(gap: Long): String {
    val sb = StringBuilder()
    sb.append("JS FROZEN for ${gap / 1000}s (live room)\n\nLast JS steps:\n")
    synchronized(marks) { marks.forEach { sb.append("  ").append(it).append('\n') } }
    val all = try { Thread.getAllStackTraces() } catch (_: Throwable) { emptyMap<Thread, Array<StackTraceElement>>() }
    // JS thread first, then WebRTC executor / signaling / main, then the rest.
    fun rank(n: String) = when {
      n.contains("js", true) -> 0
      n.startsWith("pool-") || n.contains("signaling", true) || n.contains("webrtc", true) -> 1
      n == "main" -> 2
      else -> 3
    }
    all.entries.sortedBy { rank(it.key.name) }.forEach { (t, st) ->
      if (st.isEmpty() || sb.length > 14000) return@forEach
      sb.append("\n--- ").append(t.name).append(" [").append(t.state).append("]\n")
      st.take(if (rank(t.name) < 3) 40 else 8).forEach { sb.append("    at ").append(it).append('\n') }
    }
    return sb.toString().take(16000)
  }
}
