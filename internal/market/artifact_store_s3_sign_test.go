package market

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestArtifactS3SigningAWSVectors(t *testing.T) {
	// Public example credentials and expected signatures, not real secrets:
	// https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
	store := &S3Store{options: S3Options{
		AccessKeyID: "AKIAIOSFODNN7EXAMPLE", SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", Region: "us-east-1",
	}}
	cases := []struct {
		name, method, path, payload, signature string
		headers                                map[string]string
	}{
		{
			name: "get", method: http.MethodGet, path: "/test.txt",
			headers:   map[string]string{"Range": "bytes=0-9"},
			signature: "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
		},
		{
			name: "put", method: http.MethodPut, path: "/test$file.text", payload: "Welcome to Amazon S3.",
			headers:   map[string]string{"Date": "Fri, 24 May 2013 00:00:00 GMT", "X-Amz-Storage-Class": "REDUCED_REDUNDANCY"},
			signature: "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(test.method, "https://examplebucket.s3.amazonaws.com"+test.path, strings.NewReader(test.payload))
			if err != nil {
				t.Fatal(err)
			}
			for key, value := range test.headers {
				request.Header.Set(key, value)
			}
			store.sign(request, artifactTestDigest([]byte(test.payload)), time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
			if !strings.HasSuffix(request.Header.Get("Authorization"), ",Signature="+test.signature) {
				t.Fatalf("unexpected signature: %s", request.Header.Get("Authorization"))
			}
		})
	}
}

func TestArtifactS3PathEscaping(t *testing.T) {
	cases := map[string]string{
		"/bucket/a b+c/%25/雪": "/bucket/a%20b%2Bc/%2525/%E9%9B%AA",
		"/a//b/../c":          "/a//b/../c",
		"/AZaz09-_.~/":        "/AZaz09-_.~/",
		"/file$@!=()":         "/file%24%40%21%3D%28%29",
	}
	for path, want := range cases {
		if got := escapeArtifactS3Path(path); got != want {
			t.Fatalf("escape(%q) = %q, want %q", path, got, want)
		}
	}
}
