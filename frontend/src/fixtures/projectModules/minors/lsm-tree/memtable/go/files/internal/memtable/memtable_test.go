package memtable

import (
	"bytes"
	"fmt"
	"math/rand"
	"sort"
	"testing"
)

func mustGet(t *testing.T, m *Memtable, key string, wantValue string, wantResult Result) {
	t.Helper()
	got, res := m.Get([]byte(key))
	if res != wantResult {
		t.Fatalf("Get(%q) result = %v, want %v", key, res, wantResult)
	}
	if res == Found && string(got) != wantValue {
		t.Fatalf("Get(%q) value = %q, want %q", key, got, wantValue)
	}
	if res != Found && got != nil {
		t.Fatalf("Get(%q) returned value %q with result %v; only Found carries a value", key, got, res)
	}
}

func collect(m *Memtable) []string {
	var out []string
	it := m.NewIterator()
	for it.SeekToFirst(); it.Valid(); it.Next() {
		out = append(out, fmt.Sprintf("%s=%s/%v", it.Key(), it.Value(), it.Kind()))
	}
	return out
}

func TestEmptyMemtable(t *testing.T) {
	m := New()
	mustGet(t, m, "anything", "", Missing)
	if m.Len() != 0 || m.ApproximateSize() != 0 {
		t.Fatalf("empty memtable: Len=%d size=%d, want 0 and 0", m.Len(), m.ApproximateSize())
	}
	it := m.NewIterator()
	it.SeekToFirst()
	if it.Valid() {
		t.Fatal("iterator over an empty memtable is Valid")
	}
}

func TestPutThenGet(t *testing.T) {
	m := New()
	m.Put([]byte("order:1"), []byte("pending"))
	m.Put([]byte("order:2"), []byte("paid"))
	mustGet(t, m, "order:1", "pending", Found)
	mustGet(t, m, "order:2", "paid", Found)
	mustGet(t, m, "order:3", "", Missing)
	if m.Len() != 2 {
		t.Fatalf("Len = %d, want 2", m.Len())
	}
}

func TestEmptyValueIsStillAValue(t *testing.T) {
	m := New()
	m.Put([]byte("k"), nil)
	got, res := m.Get([]byte("k"))
	if res != Found || got == nil || len(got) != 0 {
		t.Fatalf("Get after Put(k, nil) = %q, %v; want empty non-nil value, Found", got, res)
	}
}

func TestOverwriteKeepsOneEntry(t *testing.T) {
	m := New()
	m.Put([]byte("a"), []byte("1"))
	m.Put([]byte("a"), []byte("22"))
	mustGet(t, m, "a", "22", Found)
	if m.Len() != 1 {
		t.Fatalf("Len after overwrite = %d, want 1", m.Len())
	}
	if want := entrySize([]byte("a"), []byte("22")); m.ApproximateSize() != want {
		t.Fatalf("ApproximateSize = %d, want %d (size must track the new value length)", m.ApproximateSize(), want)
	}
}

func TestPutCopiesItsInput(t *testing.T) {
	m := New()
	key := []byte("k")
	val := []byte("v1")
	m.Put(key, val)
	key[0], val[1] = 'X', '9'
	mustGet(t, m, "k", "v1", Found)
}

func TestDeleteLeavesATombstone(t *testing.T) {
	m := New()
	m.Put([]byte("a"), []byte("1"))
	m.Delete([]byte("a"))
	mustGet(t, m, "a", "", Deleted)
	if m.Len() != 1 {
		t.Fatalf("Len after delete = %d, want 1: the tombstone is an entry", m.Len())
	}
	if got, want := collect(m), []string{"a=/tombstone"}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("iteration = %v, want %v", got, want)
	}
}

func TestDeleteOfUnknownKeyIsRecorded(t *testing.T) {
	// The key may live in an older SSTable this memtable has never seen.
	m := New()
	m.Delete([]byte("ghost"))
	mustGet(t, m, "ghost", "", Deleted)
	if m.Len() != 1 {
		t.Fatalf("Len = %d, want 1", m.Len())
	}
}

func TestDeleteCopiesItsKey(t *testing.T) {
	m := New()
	key := []byte("k")
	m.Delete(key)
	key[0] = 'X'
	mustGet(t, m, "k", "", Deleted)
}

func TestPutAfterDeleteRevives(t *testing.T) {
	m := New()
	m.Put([]byte("a"), []byte("1"))
	m.Delete([]byte("a"))
	m.Put([]byte("a"), []byte("2"))
	mustGet(t, m, "a", "2", Found)
	if m.Len() != 1 {
		t.Fatalf("Len = %d, want 1", m.Len())
	}
}

func TestIterationIsSorted(t *testing.T) {
	m := New()
	for _, k := range []string{"m", "c", "x", "a", "q"} {
		m.Put([]byte(k), []byte(k+k))
	}
	m.Delete([]byte("q"))
	want := []string{"a=aa/value", "c=cc/value", "m=mm/value", "q=/tombstone", "x=xx/value"}
	if got := collect(m); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("iteration = %v, want %v", got, want)
	}
}

func TestSeek(t *testing.T) {
	m := New()
	for _, k := range []string{"b", "d", "f"} {
		m.Put([]byte(k), []byte("v"))
	}
	cases := []struct {
		target string
		want   string // "" means the iterator must be exhausted
	}{
		{"a", "b"},
		{"b", "b"},
		{"c", "d"},
		{"f", "f"},
		{"g", ""},
	}
	for _, c := range cases {
		it := m.NewIterator()
		it.Seek([]byte(c.target))
		switch {
		case c.want == "" && it.Valid():
			t.Errorf("Seek(%q) landed on %q, want exhausted", c.target, it.Key())
		case c.want != "" && !it.Valid():
			t.Errorf("Seek(%q) exhausted, want %q", c.target, c.want)
		case c.want != "" && string(it.Key()) != c.want:
			t.Errorf("Seek(%q) = %q, want %q", c.target, it.Key(), c.want)
		}
	}

	it := m.NewIterator()
	var walked []string
	for it.Seek([]byte("c")); it.Valid(); it.Next() {
		walked = append(walked, string(it.Key()))
	}
	if fmt.Sprint(walked) != "[d f]" {
		t.Fatalf("scan from c = %v, want [d f]", walked)
	}
}

// TestRandomOpsMatchAModel drives the memtable and a plain map with the same
// random Puts and Deletes, then checks every lookup and the full ordered walk.
func TestRandomOpsMatchAModel(t *testing.T) {
	type state struct {
		value   string
		deleted bool
	}
	rnd := rand.New(rand.NewSource(42))
	m := New()
	model := map[string]state{}

	for i := 0; i < 20000; i++ {
		key := fmt.Sprintf("key%04d", rnd.Intn(2000))
		if rnd.Intn(4) == 0 {
			m.Delete([]byte(key))
			model[key] = state{deleted: true}
			continue
		}
		val := fmt.Sprintf("v%d", i)
		m.Put([]byte(key), []byte(val))
		model[key] = state{value: val}
	}

	if m.Len() != len(model) {
		t.Fatalf("Len = %d, want %d", m.Len(), len(model))
	}
	wantSize := 0
	for k, st := range model {
		wantSize += entrySize([]byte(k), []byte(st.value))
		if st.deleted {
			mustGet(t, m, k, "", Deleted)
		} else {
			mustGet(t, m, k, st.value, Found)
		}
	}
	if m.ApproximateSize() != wantSize {
		t.Fatalf("ApproximateSize = %d, want %d", m.ApproximateSize(), wantSize)
	}
	mustGet(t, m, "key9999", "", Missing)

	keys := make([]string, 0, len(model))
	for k := range model {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	it := m.NewIterator()
	i := 0
	for it.SeekToFirst(); it.Valid(); it.Next() {
		if i >= len(keys) {
			t.Fatalf("iterator yielded more than %d entries", len(keys))
		}
		if !bytes.Equal(it.Key(), []byte(keys[i])) {
			t.Fatalf("entry %d = %q, want %q", i, it.Key(), keys[i])
		}
		st := model[keys[i]]
		if st.deleted != (it.Kind() == KindTombstone) {
			t.Fatalf("entry %q kind = %v, want deleted=%v", keys[i], it.Kind(), st.deleted)
		}
		i++
	}
	if i != len(keys) {
		t.Fatalf("iterator yielded %d entries, want %d", i, len(keys))
	}
}

// TestSearchIsLogarithmic fails if lookups crawl level 0. A linear scan over
// 100k keys averages ~50k comparisons; a working skiplist needs a few dozen.
func TestSearchIsLogarithmic(t *testing.T) {
	const n = 100000
	m := New()
	for i := 0; i < n; i++ {
		m.Put([]byte(fmt.Sprintf("key%08d", i)), []byte("v"))
	}
	if m.list.height < 4 {
		t.Fatalf("list height = %d after %d inserts; put is not building towers", m.list.height, n)
	}

	rnd := rand.New(rand.NewSource(7))
	const lookups = 2000
	m.list.compares = 0
	for i := 0; i < lookups; i++ {
		key := fmt.Sprintf("key%08d", rnd.Intn(n))
		if _, res := m.Get([]byte(key)); res != Found {
			t.Fatalf("Get(%q) = %v, want Found", key, res)
		}
	}
	avg := float64(m.list.compares) / lookups
	t.Logf("average comparisons per lookup: %.1f", avg)
	if avg > 150 {
		t.Fatalf("average %.0f comparisons per lookup over %d keys; search is not using the upper levels", avg, n)
	}
}

func BenchmarkPut(b *testing.B) {
	m := New()
	rnd := rand.New(rand.NewSource(1))
	keys := make([][]byte, 1<<16)
	for i := range keys {
		keys[i] = []byte(fmt.Sprintf("key%08d", rnd.Intn(1<<30)))
	}
	val := []byte("value")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Put(keys[i&(len(keys)-1)], val)
	}
}

func BenchmarkGet(b *testing.B) {
	m := New()
	keys := make([][]byte, 1<<16)
	for i := range keys {
		keys[i] = []byte(fmt.Sprintf("key%08d", i))
		m.Put(keys[i], []byte("value"))
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Get(keys[i&(len(keys)-1)])
	}
}
