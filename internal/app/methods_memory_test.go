package app

import "testing"

// TestReclaimMemoryInvokesTrim 保证绑定方法真的触发了既有的内存回收实现。
//
// 断言的是「调用到 fileTransferMemoryTrimFn」而不是「内存真的降了」：GC 是否归还
// 物理页由运行时决定，测不到也不该测；这里要防的回归是绑定方法被改成空实现、
// 或绕过共用实现又写了一套 GC。
func TestReclaimMemoryInvokesTrim(t *testing.T) {
	originalTrim := fileTransferMemoryTrimFn
	t.Cleanup(func() { fileTransferMemoryTrimFn = originalTrim })

	trimCalls := 0
	fileTransferMemoryTrimFn = func() { trimCalls++ }

	result := (&App{}).ReclaimMemory()

	if trimCalls != 1 {
		t.Fatalf("ReclaimMemory 调用 trim 次数 = %d, want 1", trimCalls)
	}
	if !result.Success {
		t.Fatalf("ReclaimMemory 应返回成功，实际：%+v", result)
	}
}

// TestReclaimMemoryFailureNeverBlocksFrontend 记录一条契约：内存回收是尽力而为的
// 优化动作，无论运行时发生什么都不应向调用方报失败 —— 前端在预热完成后是「顺手调」，
// 一旦返回失败就得加错误处理，而它其实无能为力。
func TestReclaimMemoryFailureNeverBlocksFrontend(t *testing.T) {
	originalTrim := fileTransferMemoryTrimFn
	t.Cleanup(func() { fileTransferMemoryTrimFn = originalTrim })

	fileTransferMemoryTrimFn = func() {}

	result := (&App{}).ReclaimMemory()
	if !result.Success {
		t.Fatalf("ReclaimMemory 不应失败，实际：%+v", result)
	}
}
