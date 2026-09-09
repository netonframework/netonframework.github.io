import neton.http.pool.SlotPool
import kotlin.native.runtime.GC
import kotlin.native.runtime.NativeRuntimeApi

private class Box(var a: Int = 0, var b: String? = null)
@kotlin.concurrent.Volatile private var escape: Box? = null

@OptIn(NativeRuntimeApi::class, kotlin.ExperimentalStdlibApi::class)
fun gcEpoch(): Long { return GC.lastGCInfo?.epoch ?: 0 }

@OptIn(NativeRuntimeApi::class)
fun main() {
    // Small heap floor so the Box garbage forces GCs we can count; autotune off
    // so the floor is the whole story.
    GC.autotune = false
    GC.minHeapBytes = 4L * 1024 * 1024
    GC.targetHeapBytes = 4L * 1024 * 1024
    val iters = 5_000_000
    // A: 直接 new 每次
    GC.collect(); val e0a = gcEpoch()
    var sinkA = 0
    for (i in 0 until iters) { val x = Box(i, null); escape = x; sinkA += x.a }
    GC.collect(); val e1a = gcEpoch()
    // B: pool 借还复用
    val pool = SlotPool(64, { Box() }, { it.a = 0; it.b = null })
    GC.collect(); val e0b = gcEpoch()
    var sinkB = 0
    for (i in 0 until iters) {
        val s = pool.lease()!!
        s.value.a = i; s.value.b = null
        escape = s.value; sinkB += s.value.a
        s.close(s.token)
    }
    GC.collect(); val e1b = gcEpoch()
    println("直接 new:   ${iters} 次 → GC epoch 增量 ${e1a-e0a-1} (sink=${sinkA and 1})")
    println("pool 复用:  ${iters} 次 → GC epoch 增量 ${e1b-e0b-1} (sink=${sinkB and 1})")
    println("池创建槽数: ${pool.createdCount}")
}
