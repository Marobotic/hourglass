package dev.marobotic.hourglass

import android.app.Application
import android.content.Context
import dev.marobotic.hourglass.alarm.Scheduler
import dev.marobotic.hourglass.data.Repo

class App : Application() {
    val repo by lazy { Repo(this) }

    override fun onCreate() {
        super.onCreate()
        Scheduler.ensureChannel(this)
        Scheduler.reschedule(this, repo)
        repo.startLoop()
    }

    companion object {
        fun repo(ctx: Context): Repo = (ctx.applicationContext as App).repo
    }
}
