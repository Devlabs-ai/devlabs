import random
import unittest

from lsmkv.memtable import Kind, Memtable, Result
from lsmkv.memtable.skiplist import entry_size


def collect(m: Memtable) -> list:
    out = []
    it = m.new_iterator()
    it.seek_to_first()
    while it.valid():
        value = (it.value() or b"").decode()
        out.append(f"{it.key().decode()}={value}/{it.kind().name.lower()}")
        it.next()
    return out


class MemtableTest(unittest.TestCase):
    def assert_get(self, m: Memtable, key: str, want_value, want_result: Result) -> None:
        got, res = m.get(key.encode())
        self.assertIs(res, want_result, f"get({key!r}) result")
        if res is Result.FOUND:
            self.assertEqual(got, want_value.encode(), f"get({key!r}) value")
        else:
            self.assertIsNone(got, f"get({key!r}) returned a value with {res}; only FOUND carries one")

    def test_empty_memtable(self):
        m = Memtable()
        self.assert_get(m, "anything", None, Result.MISSING)
        self.assertEqual((len(m), m.approximate_size()), (0, 0))
        it = m.new_iterator()
        it.seek_to_first()
        self.assertFalse(it.valid(), "iterator over an empty memtable is valid")

    def test_put_then_get(self):
        m = Memtable()
        m.put(b"order:1", b"pending")
        m.put(b"order:2", b"paid")
        self.assert_get(m, "order:1", "pending", Result.FOUND)
        self.assert_get(m, "order:2", "paid", Result.FOUND)
        self.assert_get(m, "order:3", None, Result.MISSING)
        self.assertEqual(len(m), 2)

    def test_empty_value_is_still_a_value(self):
        m = Memtable()
        m.put(b"k", b"")
        got, res = m.get(b"k")
        self.assertIs(res, Result.FOUND)
        self.assertEqual(got, b"")

    def test_overwrite_keeps_one_entry(self):
        m = Memtable()
        m.put(b"a", b"1")
        m.put(b"a", b"22")
        self.assert_get(m, "a", "22", Result.FOUND)
        self.assertEqual(len(m), 1, "len after overwrite")
        self.assertEqual(m.approximate_size(), entry_size(b"a", b"22"),
                         "size must track the new value length")

    def test_put_copies_its_input(self):
        m = Memtable()
        key, val = bytearray(b"k"), bytearray(b"v1")
        m.put(key, val)
        key[0], val[1] = ord("X"), ord("9")
        self.assert_get(m, "k", "v1", Result.FOUND)

    def test_delete_leaves_a_tombstone(self):
        m = Memtable()
        m.put(b"a", b"1")
        m.delete(b"a")
        self.assert_get(m, "a", None, Result.DELETED)
        self.assertEqual(len(m), 1, "the tombstone is an entry")
        self.assertEqual(collect(m), ["a=/tombstone"])

    def test_delete_of_unknown_key_is_recorded(self):
        # The key may live in an older SSTable this memtable has never seen.
        m = Memtable()
        m.delete(b"ghost")
        self.assert_get(m, "ghost", None, Result.DELETED)
        self.assertEqual(len(m), 1)

    def test_delete_copies_its_key(self):
        m = Memtable()
        key = bytearray(b"k")
        m.delete(key)
        key[0] = ord("X")
        self.assert_get(m, "k", None, Result.DELETED)

    def test_put_after_delete_revives(self):
        m = Memtable()
        m.put(b"a", b"1")
        m.delete(b"a")
        m.put(b"a", b"2")
        self.assert_get(m, "a", "2", Result.FOUND)
        self.assertEqual(len(m), 1)

    def test_iteration_is_sorted(self):
        m = Memtable()
        for k in ["m", "c", "x", "a", "q"]:
            m.put(k.encode(), (k + k).encode())
        m.delete(b"q")
        self.assertEqual(collect(m), [
            "a=aa/value", "c=cc/value", "m=mm/value", "q=/tombstone", "x=xx/value",
        ])

    def test_seek(self):
        m = Memtable()
        for k in [b"b", b"d", b"f"]:
            m.put(k, b"v")
        for target, want in [("a", "b"), ("b", "b"), ("c", "d"), ("f", "f"), ("g", None)]:
            it = m.new_iterator()
            it.seek(target.encode())
            if want is None:
                self.assertFalse(it.valid(), f"seek({target!r}) should be exhausted")
            else:
                self.assertTrue(it.valid(), f"seek({target!r}) exhausted, want {want!r}")
                self.assertEqual(it.key(), want.encode(), f"seek({target!r})")

        it = m.new_iterator()
        it.seek(b"c")
        walked = []
        while it.valid():
            walked.append(it.key())
            it.next()
        self.assertEqual(walked, [b"d", b"f"], "scan from c")

    def test_random_ops_match_a_model(self):
        """Drive the memtable and a dict with the same random puts and deletes,
        then check every lookup and the full ordered walk."""
        rnd = random.Random(42)
        m = Memtable()
        model = {}  # key -> value, or None for deleted
        for i in range(20000):
            key = f"key{rnd.randrange(2000):04d}"
            if rnd.randrange(4) == 0:
                m.delete(key.encode())
                model[key] = None
            else:
                val = f"v{i}"
                m.put(key.encode(), val.encode())
                model[key] = val

        self.assertEqual(len(m), len(model))
        want_size = 0
        for k, v in model.items():
            want_size += entry_size(k.encode(), (v or "").encode())
            if v is None:
                self.assert_get(m, k, None, Result.DELETED)
            else:
                self.assert_get(m, k, v, Result.FOUND)
        self.assertEqual(m.approximate_size(), want_size)
        self.assert_get(m, "key9999", None, Result.MISSING)

        keys = sorted(model)
        it = m.new_iterator()
        it.seek_to_first()
        i = 0
        while it.valid():
            self.assertLess(i, len(keys), "iterator yielded too many entries")
            self.assertEqual(it.key(), keys[i].encode(), f"entry {i}")
            self.assertEqual(it.kind() is Kind.TOMBSTONE, model[keys[i]] is None,
                             f"entry {keys[i]!r} kind")
            i += 1
            it.next()
        self.assertEqual(i, len(keys), "iterator yielded too few entries")

    def test_search_is_logarithmic(self):
        """Fails if lookups crawl level 0. A linear scan over 100k keys averages
        ~50k comparisons; a working skiplist needs a few dozen."""
        n = 100000
        m = Memtable()
        for i in range(n):
            m.put(f"key{i:08d}".encode(), b"v")
        sl = m._list
        self.assertGreaterEqual(sl.height, 4, "put is not building towers")

        rnd = random.Random(7)
        lookups = 2000
        sl.compares = 0
        for _ in range(lookups):
            key = f"key{rnd.randrange(n):08d}"
            _, res = m.get(key.encode())
            self.assertIs(res, Result.FOUND, key)
        avg = sl.compares / lookups
        self.assertLessEqual(
            avg, 150,
            f"average {avg:.0f} comparisons per lookup over {n} keys; "
            "search is not using the upper levels")


if __name__ == "__main__":
    unittest.main()
