package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	connectionPackageAES256KeyBytes = 32
	connectionPackageSaltBytes      = 16
	connectionPackageNonceBytes     = 12
)

type connectionPackageAAD struct {
	SchemaVersion int                      `json:"schemaVersion"`
	Kind          string                   `json:"kind"`
	Cipher        string                   `json:"cipher"`
	KDF           connectionPackageKDFSpec `json:"kdf"`
	Nonce         string                   `json:"nonce"`
}

type connectionPackageAADV2Protected struct {
	V    int                        `json:"v"`
	Kind string                     `json:"kind"`
	P    int                        `json:"p"`
	KDF  connectionPackageKDFSpecV2 `json:"kdf"`
	NC   string                     `json:"nc"`
}

func encryptConnectionPackage(payload connectionPackagePayload, password string) (connectionPackageFile, error) {
	normalizedPassword := normalizeConnectionPackagePassword(password)
	if normalizedPassword == "" {
		return connectionPackageFile{}, errConnectionPackagePasswordRequired
	}

	plain, err := json.Marshal(payload)
	if err != nil {
		return connectionPackageFile{}, err
	}

	salt := make([]byte, connectionPackageSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return connectionPackageFile{}, err
	}
	nonce := make([]byte, connectionPackageNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return connectionPackageFile{}, err
	}

	file := connectionPackageFile{
		SchemaVersion: connectionPackageSchemaVersion,
		Kind:          connectionPackageKind,
		Cipher:        connectionPackageCipher,
		KDF:           defaultConnectionPackageKDFSpec(),
		Nonce:         base64.StdEncoding.EncodeToString(nonce),
	}
	file.KDF.Salt = base64.StdEncoding.EncodeToString(salt)

	key, err := deriveConnectionPackageKey(normalizedPassword, file.KDF)
	if err != nil {
		return connectionPackageFile{}, err
	}
	aad, err := marshalConnectionPackageAAD(file)
	if err != nil {
		return connectionPackageFile{}, err
	}
	aead, err := newConnectionPackageAEAD(key)
	if err != nil {
		return connectionPackageFile{}, err
	}

	ciphertext := aead.Seal(nil, nonce, plain, aad)
	if len(ciphertext) > connectionPackageMaxCiphertextBytes {
		return connectionPackageFile{}, errConnectionPackagePayloadTooLarge
	}
	file.Payload = base64.StdEncoding.EncodeToString(ciphertext)
	if len(file.Payload) > connectionPackageMaxPayloadBase64Bytes {
		return connectionPackageFile{}, errConnectionPackagePayloadTooLarge
	}
	return file, nil
}

func decryptConnectionPackage(file connectionPackageFile, password string) (connectionPackagePayload, error) {
	normalizedPassword := normalizeConnectionPackagePassword(password)
	if normalizedPassword == "" {
		return connectionPackagePayload{}, errConnectionPackagePasswordRequired
	}
	if err := validateConnectionPackageFileHeader(file); err != nil {
		return connectionPackagePayload{}, err
	}

	plain, err := decryptConnectionPackagePlaintext(file, normalizedPassword)
	if err != nil {
		if errors.Is(err, errConnectionPackagePayloadTooLarge) {
			return connectionPackagePayload{}, err
		}
		return connectionPackagePayload{}, errConnectionPackageDecryptFailed
	}

	var payload connectionPackagePayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		return connectionPackagePayload{}, errConnectionPackageDecryptFailed
	}
	return payload, nil
}

func isConnectionPackageEnvelope(raw string) bool {
	file, err := decodeConnectionPackageEnvelope(raw)
	if err != nil {
		return false
	}
	return validateConnectionPackageFileHeader(file) == nil
}

func encryptConnectionPackageV2AppManaged(payload connectionPackagePayload) (connectionPackageFileV2, error) {
	appKey, err := deriveConnectionPackageAppKey()
	if err != nil {
		return connectionPackageFileV2{}, err
	}

	encryptedPayload, err := encryptConnectionPackagePayloadSecrets(payload, appKey)
	if err != nil {
		return connectionPackageFileV2{}, err
	}

	return connectionPackageFileV2{
		V:              connectionPackageSchemaVersionV2,
		Kind:           connectionPackageKind,
		P:              connectionPackageProtectionAppManaged,
		ExportedAt:     encryptedPayload.ExportedAt,
		Connections:    encryptedPayload.Connections,
		RedisDbAliases: encryptedPayload.RedisDbAliases,
	}, nil
}

func encryptConnectionPackageV2Protected(payload connectionPackagePayload, password string) (connectionPackageFileV2Protected, error) {
	normalizedPassword := normalizeConnectionPackagePassword(password)
	if normalizedPassword == "" {
		return connectionPackageFileV2Protected{}, errConnectionPackagePasswordRequired
	}

	appKey, err := deriveConnectionPackageAppKey()
	if err != nil {
		return connectionPackageFileV2Protected{}, err
	}
	encryptedPayload, err := encryptConnectionPackagePayloadSecrets(payload, appKey)
	if err != nil {
		return connectionPackageFileV2Protected{}, err
	}

	plain, err := json.Marshal(encryptedPayload)
	if err != nil {
		return connectionPackageFileV2Protected{}, err
	}

	salt := make([]byte, connectionPackageSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return connectionPackageFileV2Protected{}, err
	}
	nonce := make([]byte, connectionPackageNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return connectionPackageFileV2Protected{}, err
	}

	file := connectionPackageFileV2Protected{
		V:    connectionPackageSchemaVersionV2,
		Kind: connectionPackageKind,
		P:    connectionPackageProtectionPasswordProtected,
		KDF:  defaultConnectionPackageKDFSpecV2(),
		NC:   base64.StdEncoding.EncodeToString(nonce),
	}
	file.KDF.S = base64.StdEncoding.EncodeToString(salt)

	key, err := deriveConnectionPackageKeyV2(normalizedPassword, file.KDF)
	if err != nil {
		return connectionPackageFileV2Protected{}, err
	}
	aad, err := marshalConnectionPackageAADV2Protected(file)
	if err != nil {
		return connectionPackageFileV2Protected{}, err
	}
	aead, err := newConnectionPackageAEAD(key)
	if err != nil {
		return connectionPackageFileV2Protected{}, err
	}

	ciphertext := aead.Seal(nil, nonce, plain, aad)
	if len(ciphertext) > connectionPackageMaxCiphertextBytes {
		return connectionPackageFileV2Protected{}, errConnectionPackagePayloadTooLarge
	}
	file.D = base64.StdEncoding.EncodeToString(ciphertext)
	if len(file.D) > connectionPackageMaxPayloadBase64Bytes {
		return connectionPackageFileV2Protected{}, errConnectionPackagePayloadTooLarge
	}
	return file, nil
}

func decryptConnectionPackageV2AppManaged(file connectionPackageFileV2) (connectionPackagePayload, error) {
	if err := validateConnectionPackageFileHeaderV2AppManaged(file); err != nil {
		return connectionPackagePayload{}, err
	}

	appKey, err := deriveConnectionPackageAppKey()
	if err != nil {
		return connectionPackagePayload{}, err
	}

	payload, err := decryptConnectionPackagePayloadSecrets(connectionPackagePayload{
		ExportedAt:     file.ExportedAt,
		Connections:    file.Connections,
		RedisDbAliases: file.RedisDbAliases,
	}, appKey)
	if err != nil {
		return connectionPackagePayload{}, errConnectionPackageDecryptFailed
	}
	return payload, nil
}

func decryptConnectionPackageV2Protected(file connectionPackageFileV2Protected, password string) (connectionPackagePayload, error) {
	normalizedPassword := normalizeConnectionPackagePassword(password)
	if normalizedPassword == "" {
		return connectionPackagePayload{}, errConnectionPackagePasswordRequired
	}
	if err := validateConnectionPackageFileHeaderV2Protected(file); err != nil {
		return connectionPackagePayload{}, err
	}

	plain, err := decryptConnectionPackageV2ProtectedPlaintext(file, normalizedPassword)
	if err != nil {
		if errors.Is(err, errConnectionPackagePayloadTooLarge) {
			return connectionPackagePayload{}, err
		}
		return connectionPackagePayload{}, errConnectionPackageDecryptFailed
	}

	var encryptedPayload connectionPackagePayload
	if err := json.Unmarshal(plain, &encryptedPayload); err != nil {
		return connectionPackagePayload{}, errConnectionPackageDecryptFailed
	}

	appKey, err := deriveConnectionPackageAppKey()
	if err != nil {
		return connectionPackagePayload{}, err
	}
	payload, err := decryptConnectionPackagePayloadSecrets(encryptedPayload, appKey)
	if err != nil {
		return connectionPackagePayload{}, errConnectionPackageDecryptFailed
	}
	return payload, nil
}

func isConnectionPackageV2AppManaged(raw string) bool {
	header, err := decodeConnectionPackageV2Header(raw)
	if err != nil {
		return false
	}
	return header.Kind == connectionPackageKind &&
		header.V == connectionPackageSchemaVersionV2 &&
		header.P == connectionPackageProtectionAppManaged
}

func isConnectionPackageV2Protected(raw string) bool {
	header, err := decodeConnectionPackageV2Header(raw)
	if err != nil {
		return false
	}
	return header.Kind == connectionPackageKind &&
		header.V == connectionPackageSchemaVersionV2 &&
		header.P == connectionPackageProtectionPasswordProtected
}

func encodeConnectionPackageEnvelope(file connectionPackageFile) (string, error) {
	raw, err := json.Marshal(file)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeConnectionPackageEnvelope(raw string) (connectionPackageFile, error) {
	var file connectionPackageFile
	if err := json.Unmarshal([]byte(raw), &file); err != nil {
		return connectionPackageFile{}, err
	}
	return file, nil
}

func decodeConnectionPackageV2Header(raw string) (struct {
	V    int    `json:"v"`
	Kind string `json:"kind"`
	P    int    `json:"p"`
}, error) {
	var header struct {
		V    int    `json:"v"`
		Kind string `json:"kind"`
		P    int    `json:"p"`
	}
	if err := json.Unmarshal([]byte(raw), &header); err != nil {
		return header, err
	}
	return header, nil
}

func decryptConnectionPackagePlaintext(file connectionPackageFile, password string) ([]byte, error) {
	if err := validateConnectionPackageFileHeader(file); err != nil {
		return nil, err
	}

	nonce, err := base64.StdEncoding.DecodeString(file.Nonce)
	if err != nil || len(nonce) != connectionPackageNonceBytes {
		return nil, errors.New("invalid nonce")
	}
	if len(file.Payload) > connectionPackageMaxPayloadBase64Bytes {
		return nil, errConnectionPackagePayloadTooLarge
	}
	ciphertext, err := base64.StdEncoding.DecodeString(file.Payload)
	if err != nil || len(ciphertext) == 0 {
		return nil, errors.New("invalid payload")
	}
	if len(ciphertext) > connectionPackageMaxCiphertextBytes {
		return nil, errConnectionPackagePayloadTooLarge
	}

	key, err := deriveConnectionPackageKey(password, file.KDF)
	if err != nil {
		return nil, err
	}
	aad, err := marshalConnectionPackageAAD(file)
	if err != nil {
		return nil, err
	}
	aead, err := newConnectionPackageAEAD(key)
	if err != nil {
		return nil, err
	}

	plain, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, err
	}
	return plain, nil
}

func deriveConnectionPackageKey(password string, spec connectionPackageKDFSpec) ([]byte, error) {
	if password == "" {
		return nil, errConnectionPackagePasswordRequired
	}
	if err := validateConnectionPackageKDFSpec(spec); err != nil {
		return nil, err
	}

	salt, err := base64.StdEncoding.DecodeString(spec.Salt)
	if err != nil || len(salt) == 0 {
		return nil, errors.New("invalid salt")
	}

	key := argon2.IDKey(
		[]byte(password),
		salt,
		spec.TimeCost,
		spec.MemoryKiB,
		spec.Parallelism,
		connectionPackageAES256KeyBytes,
	)
	return key, nil
}

func deriveConnectionPackageKeyV2(password string, spec connectionPackageKDFSpecV2) ([]byte, error) {
	if password == "" {
		return nil, errConnectionPackagePasswordRequired
	}
	if err := validateConnectionPackageKDFSpecV2(spec); err != nil {
		return nil, err
	}

	salt, err := base64.StdEncoding.DecodeString(spec.S)
	if err != nil || len(salt) == 0 {
		return nil, errors.New("invalid salt")
	}

	key := argon2.IDKey(
		[]byte(password),
		salt,
		spec.T,
		spec.M,
		spec.L,
		connectionPackageAES256KeyBytes,
	)
	return key, nil
}

func marshalConnectionPackageAAD(file connectionPackageFile) ([]byte, error) {
	aad := connectionPackageAAD{
		SchemaVersion: file.SchemaVersion,
		Kind:          file.Kind,
		Cipher:        file.Cipher,
		KDF:           file.KDF,
		Nonce:         file.Nonce,
	}
	return json.Marshal(aad)
}

func marshalConnectionPackageAADV2Protected(file connectionPackageFileV2Protected) ([]byte, error) {
	return json.Marshal(connectionPackageAADV2Protected{
		V:    file.V,
		Kind: file.Kind,
		P:    file.P,
		KDF:  file.KDF,
		NC:   file.NC,
	})
}

func newConnectionPackageAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func validateConnectionPackageFileHeader(file connectionPackageFile) error {
	switch {
	case file.SchemaVersion != connectionPackageSchemaVersion:
		return errConnectionPackageUnsupported
	case strings.TrimSpace(file.Kind) != connectionPackageKind:
		return errConnectionPackageUnsupported
	case strings.TrimSpace(file.Cipher) != connectionPackageCipher:
		return errConnectionPackageUnsupported
	case validateConnectionPackageKDFSpec(file.KDF) != nil:
		return errConnectionPackageUnsupported
	default:
		return nil
	}
}

func validateConnectionPackageFileHeaderV2AppManaged(file connectionPackageFileV2) error {
	switch {
	case file.V != connectionPackageSchemaVersionV2:
		return errConnectionPackageUnsupported
	case strings.TrimSpace(file.Kind) != connectionPackageKind:
		return errConnectionPackageUnsupported
	case file.P != connectionPackageProtectionAppManaged:
		return errConnectionPackageUnsupported
	default:
		return nil
	}
}

func validateConnectionPackageFileHeaderV2Protected(file connectionPackageFileV2Protected) error {
	switch {
	case file.V != connectionPackageSchemaVersionV2:
		return errConnectionPackageUnsupported
	case strings.TrimSpace(file.Kind) != connectionPackageKind:
		return errConnectionPackageUnsupported
	case file.P != connectionPackageProtectionPasswordProtected:
		return errConnectionPackageUnsupported
	case validateConnectionPackageKDFSpecV2(file.KDF) != nil:
		return errConnectionPackageUnsupported
	default:
		return nil
	}
}

func validateConnectionPackageKDFSpec(spec connectionPackageKDFSpec) error {
	switch {
	case strings.TrimSpace(spec.Name) != connectionPackageKDFName:
		return errConnectionPackageUnsupported
	case spec.MemoryKiB == 0 || spec.TimeCost == 0 || spec.Parallelism == 0:
		return errConnectionPackageUnsupported
	case spec.MemoryKiB > connectionPackageKDFMaxMemoryKiB:
		return errConnectionPackageUnsupported
	case spec.TimeCost > connectionPackageKDFMaxTimeCost:
		return errConnectionPackageUnsupported
	case spec.Parallelism > connectionPackageKDFMaxParallelism:
		return errConnectionPackageUnsupported
	default:
		return nil
	}
}

func validateConnectionPackageKDFSpecV2(spec connectionPackageKDFSpecV2) error {
	switch {
	case strings.TrimSpace(spec.N) != connectionPackageKDFNameV2:
		return errConnectionPackageUnsupported
	case spec.M == 0 || spec.T == 0 || spec.L == 0:
		return errConnectionPackageUnsupported
	case spec.M > connectionPackageKDFMaxMemoryKiB:
		return errConnectionPackageUnsupported
	case spec.T > connectionPackageKDFMaxTimeCost:
		return errConnectionPackageUnsupported
	case spec.L > connectionPackageKDFMaxParallelism:
		return errConnectionPackageUnsupported
	default:
		return nil
	}
}

func decryptConnectionPackageV2ProtectedPlaintext(file connectionPackageFileV2Protected, password string) ([]byte, error) {
	if err := validateConnectionPackageFileHeaderV2Protected(file); err != nil {
		return nil, err
	}

	nonce, err := base64.StdEncoding.DecodeString(file.NC)
	if err != nil || len(nonce) != connectionPackageNonceBytes {
		return nil, errors.New("invalid nonce")
	}
	if len(file.D) > connectionPackageMaxPayloadBase64Bytes {
		return nil, errConnectionPackagePayloadTooLarge
	}
	ciphertext, err := base64.StdEncoding.DecodeString(file.D)
	if err != nil || len(ciphertext) == 0 {
		return nil, errors.New("invalid payload")
	}
	if len(ciphertext) > connectionPackageMaxCiphertextBytes {
		return nil, errConnectionPackagePayloadTooLarge
	}

	key, err := deriveConnectionPackageKeyV2(password, file.KDF)
	if err != nil {
		return nil, err
	}
	aad, err := marshalConnectionPackageAADV2Protected(file)
	if err != nil {
		return nil, err
	}
	aead, err := newConnectionPackageAEAD(key)
	if err != nil {
		return nil, err
	}

	return aead.Open(nil, nonce, ciphertext, aad)
}

func encryptConnectionPackagePayloadSecrets(payload connectionPackagePayload, appKey []byte) (connectionPackagePayload, error) {
	encrypted := connectionPackagePayload{
		ExportedAt:     payload.ExportedAt,
		Connections:    make([]connectionPackageItem, len(payload.Connections)),
		RedisDbAliases: sanitizeConnectionPackageRedisDbAliases(payload.RedisDbAliases),
	}

	for index, item := range payload.Connections {
		encryptedItem := item
		// 确保别名被拷贝进加密后的连接项（不加密，仅展示偏好）
		encryptedItem.RedisDbAliases = cloneStringMap(item.RedisDbAliases)
		encryptedItem.SchemaVisibilityByDatabase = cloneSchemaVisibilityByDatabase(item.SchemaVisibilityByDatabase)
		bundle, err := encryptSecretBundle(appKey, item.Secrets, connectionPackageItemAAD(item))
		if err != nil {
			return connectionPackagePayload{}, err
		}
		encryptedItem.Secrets = bundle
		encrypted.Connections[index] = encryptedItem
	}

	return encrypted, nil
}

func decryptConnectionPackagePayloadSecrets(payload connectionPackagePayload, appKey []byte) (connectionPackagePayload, error) {
	decrypted := connectionPackagePayload{
		ExportedAt:     payload.ExportedAt,
		Connections:    make([]connectionPackageItem, len(payload.Connections)),
		RedisDbAliases: sanitizeConnectionPackageRedisDbAliases(payload.RedisDbAliases),
	}

	for index, item := range payload.Connections {
		decryptedItem := item
		decryptedItem.RedisDbAliases = cloneStringMap(item.RedisDbAliases)
		decryptedItem.SchemaVisibilityByDatabase = cloneSchemaVisibilityByDatabase(item.SchemaVisibilityByDatabase)
		bundle, err := decryptSecretBundle(appKey, item.Secrets, connectionPackageItemAAD(item))
		if err != nil {
			return connectionPackagePayload{}, err
		}
		decryptedItem.Secrets = bundle
		decrypted.Connections[index] = decryptedItem
	}

	return decrypted, nil
}

func connectionPackageItemAAD(item connectionPackageItem) string {
	if strings.TrimSpace(item.ID) != "" {
		return item.ID
	}
	return item.Config.ID
}
