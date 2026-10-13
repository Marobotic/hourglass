package dev.marobotic.hourglass.alarm

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import dev.marobotic.hourglass.App

// Syncs about every 15 minutes (Android's shortest period) whenever there is a
// network, with the app closed too, so an alarm set on another device reaches
// this phone and rings without anyone opening Hourglass here. Each sync
// reschedules the next alarm. Survives reboots (persisted).
class SyncJob : JobService() {
    companion object {
        private const val ID = 4203

        fun ensure(ctx: Context) = runCatching {
            val js = ctx.getSystemService(JobScheduler::class.java) ?: return@runCatching
            if (js.getPendingJob(ID) != null) return@runCatching
            js.schedule(
                JobInfo.Builder(ID, ComponentName(ctx, SyncJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(15 * 60_000L)
                    .setPersisted(true)
                    .build()
            )
        }.onFailure { android.util.Log.w("Hourglass", "background sync job not scheduled", it) }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            runCatching {
                val repo = App.repo(this)
                repo.syncBlocking()
                Scheduler.reschedule(this, repo)
            }
            jobFinished(params, false)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters) = true
}
