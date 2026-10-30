package expo.modules.gpupixelcamera

import android.content.Context
import java.io.File

/**
 * Crash evidence for the next launch.
 * - Java/Kotlin crashes: default uncaught handler writes the stack trace.
 * - Native crashes (SIGSEGV etc.) cannot be caught in Kotlin, so the camera writes its current stage
 *   (init / open camera / first frame) to a file and clears it on a clean stop. A stage file that
 *   survives to the next launch means the process died inside that stage.
 */
object CrashLog {
  private const val STAGE = "gpupixel-stage.txt"
  private const val CRASH = "gpupixel-crash.txt"
  @Volatile private var installed = false

  fun install(ctx: Context) {
    if (installed) return
    installed = true
    val app = ctx.applicationContext
    val prev = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { t, e ->
      try {
        val stage = File(app.filesDir, STAGE).takeIf { it.exists() }?.readText() ?: "-"
        File(app.filesDir, CRASH).writeText("Thread: ${t.name}\nStage: $stage\n${e.stackTraceToString().take(6000)}")
      } catch (_: Throwable) { }
      prev?.uncaughtException(t, e)
    }
  }

  fun stage(ctx: Context, s: String) {
    try { File(ctx.applicationContext.filesDir, STAGE).writeText("$s @ ${System.currentTimeMillis()}") } catch (_: Throwable) { }
  }

  /** Report written by the JS freeze watchdog; shown on the next launch like a crash. */
  fun writeReport(ctx: Context, text: String) {
    try { File(ctx.applicationContext.filesDir, CRASH).writeText(text) } catch (_: Throwable) { }
  }

  fun clearStage(ctx: Context) { try { File(ctx.applicationContext.filesDir, STAGE).delete() } catch (_: Throwable) { } }

  /** Report from the previous run (or null), then cleared. Must be called before the camera opens. */
  fun take(ctx: Context): String? {
    val dir = ctx.applicationContext.filesDir
    val crash = File(dir, CRASH); val stage = File(dir, STAGE)
    val parts = ArrayList<String>()
    if (crash.exists()) parts += crash.readText()
    else if (stage.exists()) parts += "Native crash (no Java stack). Last camera stage: ${stage.readText()}"
    crash.delete(); stage.delete()
    return parts.joinToString("\n").ifBlank { null }
  }
}
