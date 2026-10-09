// Package memtable is the in-memory, sorted write buffer of the LSM tree.
//
// Every Put and Delete lands here first. When it grows past a size limit it is
// frozen and flushed to disk as an SSTable (chapter 3), and a fresh memtable
// takes its place.
package memtable

import "sync"

// Result is the outcome of a lookup in one memtable.
type Result uint8

const (
	// Missing: this memtable knows nothing about the key. Older tables might.
	Missing Result = iota
	// Found: the key has a live value here.
	Found
	// Deleted: the newest thing written for the key is a tombstone. The key
	// is gone; do not look in older tables.
	Deleted
)

func (r Result) String() string {
	switch r {
	case Missing:
		return "missing"
	case Found:
		return "found"
	case Deleted:
		return "deleted"
	default:
		return "unknown"
	}
}

// Memtable is a sorted, in-memory map safe for one writer and many readers.
type Memtable struct {
	mu   sync.RWMutex
	list *skiplist
}

// New returns an empty memtable.
func New() *Memtable {
	return &Memtable{list: newSkiplist(0x5EED)}
}

// Put stores value under key, replacing anything written for key before.
//
// Key and value are copied, so callers may reuse their buffers.
func (m *Memtable) Put(key, value []byte) {
	k := append([]byte(nil), key...)
	v := append([]byte{}, value...)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.list.put(k, v, KindValue)
}

// Delete records that key no longer exists.
func (m *Memtable) Delete(key []byte) {
	// ── TODO(1.3) — a delete is a write ────────────────────────────────────
	//
	// Do not remove the node. Older SSTables on disk may still hold a value
	// for key, and removing it here would let that old value reappear.
	//
	// Copy key (like Put does), take the write lock, and store a tombstone:
	// m.list.put(k, nil, KindTombstone)
	panic("TODO(1.3): Delete — write a tombstone instead of removing the key")
}

// Get looks key up in this memtable only.
//
// The value is returned only when the result is Found. It is the memtable's
// own slice; callers must not modify it.
func (m *Memtable) Get(key []byte) ([]byte, Result) {
	// ── TODO(1.3) — three answers, not two ─────────────────────────────────
	//
	// Take the read lock and m.list.get(key).
	//   no node                  -> nil, Missing
	//   node.kind == KindTombstone -> nil, Deleted
	//   otherwise                -> node.value, Found
	//
	// Missing and Deleted look alike to a user ("no value") but mean opposite
	// things to the read path in chapter 4: Missing keeps searching older
	// tables, Deleted stops.
	panic("TODO(1.3): Get — report Found, Deleted, or Missing")
}

// Len is the number of entries, tombstones included.
func (m *Memtable) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.list.length
}

// ApproximateSize is the memory the entries account for, in bytes.
func (m *Memtable) ApproximateSize() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.list.size
}
