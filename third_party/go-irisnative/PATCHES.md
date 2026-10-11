Local patch against github.com/caretdev/go-irisnative v0.2.1:

- Added `//go:build !windows` to `src/connection/user_posix.go`.
  Upstream ships `user_windows.go` with a Windows filename suffix, but
  `user_posix.go` has no build constraint, so Windows builds compile both
  files and fail with `userCurrent redeclared`.
- Made `Connection.Disconnect` close the underlying TCP connection after
  sending the protocol disconnect message, so `database/sql` closes do not
  leak sockets.
- Made `Connection.BeginTx` return the `START TRANSACTION` error instead of
  marking the connection as in-transaction when the server rejected the begin.
- Sent the statement id on `FETCH_DATA`. `ResultSet` kept no statement id, so
  every fetch was issued for statement 0. On a connection that had run more
  than one statement the server fetched the wrong cursor, and roughly half of
  all multi-row queries silently returned only their first row.
- Tolerated the older InterSystems wire protocol, which Caché speaks. IRIS
  negotiates protocol version 69 and Caché 2018.1 negotiates 53; the two
  differ in layout, and the driver assumed the IRIS one throughout:
  - The CONNECT response of a legacy server omits the trailing
    `serverFeatureOptions` field. Reading it unconditionally ran past the end
    of the buffer and panicked with `index out of range [75] with length 75`,
    surfacing as `driver panic during connect`. Each trailing field is now
    read only while the buffer still holds data, and the presence of
    `serverFeatureOptions` is recorded as a server capability.
  - A legacy query response omits the leading statement-feature item that IRIS
    sends. Parsing it unconditionally shifted every later field by one, which
    read the column count, `featureOption` and `slot_position` from the wrong
    bytes and ended in `vals[-1]`. The prefix is now parsed only for servers
    that reported the capability above.
  - `getColumns` indexed `additional[0..3]` without a length check, though the
    blob is shorter on a legacy server. Each byte is now read only when
    present.
  - `list.GetListItem` indexed `buffer[offset]` and sliced
    `buffer[offset:offset+size]` without bounds checks, so any truncated or
    unfamiliar response panicked the driver agent process. It now reports an
    empty item at end of buffer and clamps a declared size to what remains.
- Raised the per-query row limit from 200 to a finite 100000. Older servers treat
  that field as a hard ceiling rather than a fetch batch: Caché 2018.1 returned
  only the first 200 of 603 `INFORMATION_SCHEMA.TABLES` rows and 200 of 6710
  `INFORMATION_SCHEMA.COLUMNS` rows, and IRIS 2023.1.x is expected to behave the
  same. Because system schemas sort first, the metadata tree came back empty
  even though `GetDatabases` and the connection itself succeeded, which is the
  reported «未返回可见数据库或结构». IRIS 2026.1 ignores the field entirely.
  The value is deliberately not 0: the meaning of 0 varies by server version, so
  relying on it makes the fetch loop behave unpredictably. 100000 sits above
  GoNavi's own 50000-row budget, so that budget trips first and reports the
  truncation instead of rows being dropped silently.
