package market

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (s *S3Store) sign(request *http.Request, payloadHash string, timestamp time.Time) {
	stamp := timestamp.UTC().Format("20060102T150405Z")
	date := timestamp.UTC().Format("20060102")
	request.Header.Set("X-Amz-Date", stamp)
	request.Header.Set("X-Amz-Content-Sha256", payloadHash)
	if s.options.SessionToken != "" {
		request.Header.Set("X-Amz-Security-Token", s.options.SessionToken)
	}
	headers := map[string]string{"host": request.URL.Host}
	if request.Host != "" {
		headers["host"] = request.Host
	}
	for name, values := range request.Header {
		if strings.EqualFold(name, "Authorization") {
			continue
		}
		canonical := make([]string, 0, len(values))
		for _, value := range values {
			canonical = append(canonical, strings.Join(strings.Fields(value), " "))
		}
		headers[strings.ToLower(name)] = strings.Join(canonical, ",")
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, name := range names {
		canonicalHeaders.WriteString(name + ":" + headers[name] + "\n")
	}
	signed := strings.Join(names, ";")
	// Artifact requests have no query; the constructor rejects endpoint queries.
	canonical := strings.Join([]string{request.Method, escapeArtifactS3Path(request.URL.Path), "", canonicalHeaders.String(), signed, payloadHash}, "\n")
	scope := date + "/" + s.options.Region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + artifactSHA256([]byte(canonical))
	key := artifactS3HMAC([]byte("AWS4"+s.options.SecretAccessKey), date)
	key = artifactS3HMAC(key, s.options.Region)
	key = artifactS3HMAC(key, "s3")
	key = artifactS3HMAC(key, "aws4_request")
	signature := hex.EncodeToString(artifactS3HMAC(key, toSign))
	request.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.options.AccessKeyID+"/"+scope+",SignedHeaders="+signed+",Signature="+signature)
}

func artifactS3HMAC(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(value))
	return mac.Sum(nil)
}

func artifactSHA256(contents []byte) string {
	digest := sha256.Sum256(contents)
	return hex.EncodeToString(digest[:])
}

func escapeArtifactS3Path(path string) string {
	const hexDigits = "0123456789ABCDEF"
	var escaped strings.Builder
	for i := 0; i < len(path); i++ {
		character := path[i]
		if (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') || strings.ContainsRune("-_.~/", rune(character)) {
			escaped.WriteByte(character)
			continue
		}
		escaped.WriteByte('%')
		escaped.WriteByte(hexDigits[character>>4])
		escaped.WriteByte(hexDigits[character&15])
	}
	return escaped.String()
}
