package syncworker

import (
	"crypto/sha256"
	"encoding/hex"
)

func registrationID(root string) string {
	sum := sha256.Sum256([]byte(root))
	return "GoNaviSync-" + hex.EncodeToString(sum[:8])
}
