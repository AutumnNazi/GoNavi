package app

import "strings"

const windowsWebViewImageName = "msedgewebview2.exe"

// runtimeProcess is a snapshot row used to decide which WebView2 processes
// still belong to a live GoNavi host.
type runtimeProcess struct {
	PID              uint32
	ParentPID        uint32
	ImageName        string
	CommandLine      string
	CommandLineKnown bool
}

func normalizePathToken(path string) string {
	trimmed := strings.TrimSpace(path)
	trimmed = strings.Trim(trimmed, `"'`)
	trimmed = strings.TrimPrefix(trimmed, `\\?\`)
	trimmed = strings.ReplaceAll(trimmed, "/", `\`)
	trimmed = strings.TrimRight(trimmed, `\`)
	return strings.ToLower(trimmed)
}

func commandLineUsesUserDataDir(commandLine string, known bool, markers []string) bool {
	if !known {
		return false
	}
	normalized := strings.ReplaceAll(strings.ToLower(commandLine), "/", `\`)
	if !strings.Contains(normalized, "user-data-dir") {
		return false
	}
	for _, marker := range markers {
		token := normalizePathToken(marker)
		if token == "" || token == "." {
			continue
		}
		if pathTokenPresent(normalized, token) {
			return true
		}
	}
	return false
}

func pathTokenPresent(commandLine, token string) bool {
	start := 0
	for start < len(commandLine) {
		index := strings.Index(commandLine[start:], token)
		if index < 0 {
			return false
		}
		index += start
		beforeOK := index == 0 || isPathBoundary(commandLine[index-1])
		end := index + len(token)
		afterOK := end == len(commandLine) || isPathBoundary(commandLine[end])
		if beforeOK && afterOK {
			return true
		}
		start = index + 1
	}
	return false
}

func isPathBoundary(value byte) bool {
	switch value {
	case '=', '"', '\'', ' ', '\t', '\\':
		return true
	default:
		return false
	}
}

func descendantSet(nodes []runtimeProcess, root uint32) map[uint32]struct{} {
	children := make(map[uint32][]uint32)
	for _, node := range nodes {
		if node.PID == 0 || node.ParentPID == 0 || node.PID == node.ParentPID {
			continue
		}
		children[node.ParentPID] = append(children[node.ParentPID], node.PID)
	}
	seen := make(map[uint32]struct{})
	var walk func(uint32)
	walk = func(pid uint32) {
		for _, child := range children[pid] {
			if _, exists := seen[child]; exists {
				continue
			}
			seen[child] = struct{}{}
			walk(child)
		}
	}
	if root != 0 {
		walk(root)
	}
	return seen
}

func commandLineHasDetachedWindow(commandLine string, known bool) bool {
	if !known {
		return false
	}
	return argumentTokenPresent(strings.ToLower(commandLine), "detached-window")
}

func argumentTokenPresent(commandLine, token string) bool {
	start := 0
	for start < len(commandLine) {
		index := strings.Index(commandLine[start:], token)
		if index < 0 {
			return false
		}
		index += start
		beforeOK := index == 0 || isArgPrefix(commandLine[index-1])
		end := index + len(token)
		afterOK := end == len(commandLine) || isArgSuffix(commandLine[end])
		if beforeOK && afterOK {
			return true
		}
		start = index + 1
	}
	return false
}

func isArgPrefix(value byte) bool {
	switch value {
	case ' ', '\t', '"', '\'', '-':
		return true
	default:
		return false
	}
}

func isArgSuffix(value byte) bool {
	switch value {
	case ' ', '\t', '"', '\'':
		return true
	default:
		return false
	}
}

// selectOrphanRuntimeTargets returns WebView2 processes and detached GoNavi
// processes that no longer sit under a live host. Descendant WebView processes
// of an orphaned detached window are included even when their own command line
// could not be read.
func selectOrphanRuntimeTargets(nodes []runtimeProcess, webViewImage string, hostImages map[string]struct{}, markers []string) []uint32 {
	webViewImage = strings.ToLower(strings.TrimSpace(webViewImage))
	byPID := make(map[uint32]runtimeProcess, len(nodes))
	for _, node := range nodes {
		byPID[node.PID] = node
	}
	chosen := make(map[uint32]struct{})
	add := func(pid uint32) {
		if pid != 0 {
			chosen[pid] = struct{}{}
		}
	}
	for _, pid := range selectOrphanWebViewTargets(nodes, webViewImage, hostImages, markers) {
		add(pid)
	}
	for _, node := range nodes {
		if _, host := hostImages[node.ImageName]; !host {
			continue
		}
		if !commandLineHasDetachedWindow(node.CommandLine, node.CommandLineKnown) {
			continue
		}
		if hasHostAncestor(nodes, node.PID, hostImages) {
			continue
		}
		add(node.PID)
		for child := range descendantSet(nodes, node.PID) {
			if byPID[child].ImageName == webViewImage {
				add(child)
			}
		}
	}
	targets := make([]uint32, 0, len(chosen))
	for pid := range chosen {
		targets = append(targets, pid)
	}
	return reapKillOrder(nodes, targets)
}

func hasHostAncestor(nodes []runtimeProcess, pid uint32, hostImages map[string]struct{}) bool {
	byPID := make(map[uint32]runtimeProcess, len(nodes))
	for _, node := range nodes {
		byPID[node.PID] = node
	}
	seen := make(map[uint32]struct{})
	current := pid
	for step := 0; step < 64; step++ {
		node, ok := byPID[current]
		if !ok || node.ParentPID == 0 || node.ParentPID == current {
			return false
		}
		if _, loop := seen[node.ParentPID]; loop {
			return false
		}
		seen[node.ParentPID] = struct{}{}
		parent, ok := byPID[node.ParentPID]
		if !ok {
			return false
		}
		if _, host := hostImages[parent.ImageName]; host {
			return true
		}
		current = parent.PID
	}
	return false
}

// selectOrphanWebViewTargets returns WebView2 processes whose command line
// points at GoNavi's user-data directory and whose parent chain no longer
// contains a live GoNavi process.
func selectOrphanWebViewTargets(nodes []runtimeProcess, webViewImage string, hostImages map[string]struct{}, markers []string) []uint32 {
	webViewImage = strings.ToLower(strings.TrimSpace(webViewImage))
	if webViewImage == "" {
		return nil
	}
	byPID := make(map[uint32]runtimeProcess, len(nodes))
	for _, node := range nodes {
		byPID[node.PID] = node
	}
	chosen := make(map[uint32]struct{})
	for _, node := range nodes {
		if node.ImageName != webViewImage {
			continue
		}
		if !commandLineUsesUserDataDir(node.CommandLine, node.CommandLineKnown, markers) {
			continue
		}
		if hasHostAncestor(nodes, node.PID, hostImages) {
			continue
		}
		chosen[node.PID] = struct{}{}
		for child := range descendantSet(nodes, node.PID) {
			if byPID[child].ImageName == webViewImage {
				chosen[child] = struct{}{}
			}
		}
	}
	targets := make([]uint32, 0, len(chosen))
	for pid := range chosen {
		targets = append(targets, pid)
	}
	return reapKillOrder(nodes, targets)
}

func reapKillOrder(nodes []runtimeProcess, targets []uint32) []uint32 {
	parent := make(map[uint32]uint32, len(nodes))
	for _, node := range nodes {
		parent[node.PID] = node.ParentPID
	}
	unique := make([]uint32, 0, len(targets))
	seen := make(map[uint32]struct{}, len(targets))
	for _, pid := range targets {
		if pid == 0 {
			continue
		}
		if _, exists := seen[pid]; exists {
			continue
		}
		seen[pid] = struct{}{}
		unique = append(unique, pid)
	}
	ordered := append([]uint32(nil), unique...)
	depths := make(map[uint32]int, len(ordered))
	var depthOf func(uint32) int
	depthOf = func(pid uint32) int {
		if depth, ok := depths[pid]; ok {
			return depth
		}
		depths[pid] = 0
		next := parent[pid]
		if next == 0 || next == pid {
			return 0
		}
		depths[pid] = depthOf(next) + 1
		return depths[pid]
	}
	for i := 1; i < len(ordered); i++ {
		pid := ordered[i]
		depth := depthOf(pid)
		j := i
		for j > 0 && depthOf(ordered[j-1]) < depth {
			ordered[j] = ordered[j-1]
			j--
		}
		ordered[j] = pid
	}
	return ordered
}
