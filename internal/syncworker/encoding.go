package syncworker

import (
	"bytes"
	"fmt"
	"strings"

	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

const (
	taskXMLDeclarationUTF8  = `<?xml version="1.0" encoding="UTF-8"?>`
	taskXMLDeclarationUTF16 = `<?xml version="1.0" encoding="UTF-16"?>`
)

// taskXMLBytes 把任务定义编码成任务计划程序自己导出的格式：UTF-16LE 带 BOM。
//
// schtasks.exe 按系统 ANSI 代码页解码 /XML 文件；任务计划程序自己导出的 XML 正是
// UTF-16LE + BOM。对齐这个参考格式后，含非 ASCII 的路径（中文用户名、中文数据根
// 目录）不会因为解码歧义被读成乱码而拒绝注册。
//
// 声明必须跟着字节一起改成 UTF-16：带着 BOM 却声明 UTF-8 会让解析器在
// 「按 BOM 判定」与「按声明判定」之间产生分歧。
//
// 放在平台无关文件里而不是 autostart_windows.go：后者只参与 GOOS=windows 构建，
// 在 Linux/macOS 上连编译都到不了，编码这种纯函数必须能在任何平台被测试守住。
func taskXMLBytes(task string) ([]byte, error) {
	declared := strings.Replace(task, taskXMLDeclarationUTF8, taskXMLDeclarationUTF16, 1)
	if declared == task {
		return nil, fmt.Errorf("encode task XML: %s declaration not found", taskXMLDeclarationUTF8)
	}
	encoded, _, err := transform.Bytes(unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewEncoder(), []byte(declared))
	if err != nil {
		return nil, fmt.Errorf("encode task XML: %w", err)
	}
	return encoded, nil
}

// taskXMLCandidates 按尝试顺序给出同一份任务定义的多种编码。
//
// 不同 Windows 版本与系统代码页下，schtasks.exe 对 /XML 的期望并不一致：任务
// 计划程序导出的 UTF-16LE + BOM 是参考格式，而部分环境下 UTF-8 反而更稳。既然
// 无法在出问题的机器上验证哪一种会被接受，就不赌一种 —— 两种都给出，任一种被
// 接受即注册成功，编码这个变量于是被彻底消掉。若两种都被拒，错误里会带上两份
// 各自的 schtasks 输出，指向的就不再是编码问题。
//
// 顺序固定，调用方用返回的第一个元素做「任务定义是否变化」的比较基准。
func taskXMLCandidates(task string) ([][]byte, error) {
	encoded, err := taskXMLBytes(task)
	if err != nil {
		return nil, err
	}
	return [][]byte{encoded, []byte(task)}, nil
}

// firstAcceptedEncoding 依次尝试各候选任务定义，返回第一个被接受的那份。
//
// 全部被拒时把每一份的输出都带上：编码和账户标识都可能导致注册失败，逐份列出
// schtasks 的实际输出，才能让「权限不足」「账户无法解析」这类真正的原因显形。
func firstAcceptedEncoding(candidates [][]byte, attempt func([]byte) error) ([]byte, error) {
	var failures []string
	for index, content := range candidates {
		if err := attempt(content); err != nil {
			failures = append(failures, fmt.Sprintf("candidate %d: %s", index+1, err))
			continue
		}
		return content, nil
	}
	return nil, fmt.Errorf("all %d task XML candidates were rejected: %s", len(candidates), strings.Join(failures, "; "))
}

// matchesAnyCandidate 判断 marker 里记录的定义是否仍与当前的某一个候选编码一致。
//
// 注册成功时会写入实际生效的那份编码，而回退分支成功时写入的是 UTF-8。若比较
// 只认第一个候选，回退成功后每次启动都会判定「定义已变化」而重新注册一遍。
func matchesAnyCandidate(previous []byte, candidates [][]byte) bool {
	for _, candidate := range candidates {
		if bytes.Equal(previous, candidate) {
			return true
		}
	}
	return false
}
