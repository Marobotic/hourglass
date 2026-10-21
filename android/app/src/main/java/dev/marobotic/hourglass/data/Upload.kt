package dev.marobotic.hourglass.data

/** One upload for the upload panel: sending, done, failed or cancelled. size -1 = unknown. */
data class Upload(
    val id: String,
    val name: String,
    val size: Long,
    val sent: Long = 0,
    val speed: Long = 0, // bytes a second
    val state: String = "sending",
    val error: String? = null,
    val at: Long = System.currentTimeMillis(),
)
