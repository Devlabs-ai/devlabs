#include <cstdio>
#include <map>
#include <optional>
#include <random>
#include <string>
#include <vector>

#include "check.h"
#include "memtable/memtable.h"

namespace lsmkv {

// Reaches into Memtable for the skiplist statistics the tests need.
struct MemtableTestPeer {
  static SkipList& List(Memtable& m) { return m.list_; }
};

}  // namespace lsmkv

using lsmkv::Kind;
using lsmkv::Memtable;
using lsmkv::Result;

namespace {

// want_value is ignored unless want_result is kFound.
void ExpectGet(const Memtable& m, const std::string& key, const std::string& want_value,
               Result want_result) {
  std::string got = "<untouched>";
  Result res = m.Get(key, &got);
  CHECK_MSG(res == want_result, "Get(\"" << key << "\") result = " << lsmkv::ResultName(res)
                                         << ", want " << lsmkv::ResultName(want_result));
  if (res == Result::kFound) {
    CHECK_MSG(got == want_value, "Get(\"" << key << "\") value = \"" << got << "\", want \""
                                          << want_value << "\"");
  } else {
    CHECK_MSG(got == "<untouched>",
              "Get(\"" << key << "\") wrote a value with result " << lsmkv::ResultName(res)
                       << "; only kFound sets *value");
  }
}

std::vector<std::string> Collect(const Memtable& m) {
  std::vector<std::string> out;
  lsmkv::Iterator it = m.NewIterator();
  for (it.SeekToFirst(); it.Valid(); it.Next()) {
    out.push_back(std::string(it.Key()) + "=" + std::string(it.Value()) + "/" +
                  lsmkv::KindName(it.kind()));
  }
  return out;
}

std::string Join(const std::vector<std::string>& items) {
  std::string out = "[";
  for (size_t i = 0; i < items.size(); ++i) out += (i ? " " : "") + items[i];
  return out + "]";
}

std::string KeyN(const char* fmt, int n) {
  char buf[32];
  std::snprintf(buf, sizeof buf, fmt, n);
  return buf;
}

}  // namespace

TEST(EmptyMemtable) {
  Memtable m;
  ExpectGet(m, "anything", "", Result::kMissing);
  CHECK_EQ(m.Len(), size_t{0});
  CHECK_EQ(m.ApproximateSize(), size_t{0});
  lsmkv::Iterator it = m.NewIterator();
  it.SeekToFirst();
  CHECK_MSG(!it.Valid(), "iterator over an empty memtable is Valid");
}

TEST(PutThenGet) {
  Memtable m;
  m.Put("order:1", "pending");
  m.Put("order:2", "paid");
  ExpectGet(m, "order:1", "pending", Result::kFound);
  ExpectGet(m, "order:2", "paid", Result::kFound);
  ExpectGet(m, "order:3", "", Result::kMissing);
  CHECK_EQ(m.Len(), size_t{2});
}

TEST(EmptyValueIsStillAValue) {
  Memtable m;
  m.Put("k", "");
  ExpectGet(m, "k", "", Result::kFound);
}

TEST(OverwriteKeepsOneEntry) {
  Memtable m;
  m.Put("a", "1");
  m.Put("a", "22");
  ExpectGet(m, "a", "22", Result::kFound);
  CHECK_EQ(m.Len(), size_t{1});
  CHECK_MSG(m.ApproximateSize() == lsmkv::EntrySize("a", "22"),
            "ApproximateSize = " << m.ApproximateSize() << ", want " << lsmkv::EntrySize("a", "22")
                                 << " (size must track the new value length)");
}

TEST(PutCopiesItsInput) {
  Memtable m;
  std::string key = "k", val = "v1";
  m.Put(key, val);
  key[0] = 'X';
  val[1] = '9';
  ExpectGet(m, "k", "v1", Result::kFound);
}

TEST(DeleteLeavesATombstone) {
  Memtable m;
  m.Put("a", "1");
  m.Delete("a");
  ExpectGet(m, "a", "", Result::kDeleted);
  CHECK_MSG(m.Len() == 1, "Len after delete = " << m.Len() << ", want 1: the tombstone is an entry");
  CHECK_EQ(Join(Collect(m)), std::string("[a=/tombstone]"));
}

TEST(DeleteOfUnknownKeyIsRecorded) {
  // The key may live in an older SSTable this memtable has never seen.
  Memtable m;
  m.Delete("ghost");
  ExpectGet(m, "ghost", "", Result::kDeleted);
  CHECK_EQ(m.Len(), size_t{1});
}

TEST(DeleteCopiesItsKey) {
  Memtable m;
  std::string key = "k";
  m.Delete(key);
  key[0] = 'X';
  ExpectGet(m, "k", "", Result::kDeleted);
}

TEST(PutAfterDeleteRevives) {
  Memtable m;
  m.Put("a", "1");
  m.Delete("a");
  m.Put("a", "2");
  ExpectGet(m, "a", "2", Result::kFound);
  CHECK_EQ(m.Len(), size_t{1});
}

TEST(IterationIsSorted) {
  Memtable m;
  for (std::string k : {"m", "c", "x", "a", "q"}) m.Put(k, k + k);
  m.Delete("q");
  CHECK_EQ(Join(Collect(m)),
           std::string("[a=aa/value c=cc/value m=mm/value q=/tombstone x=xx/value]"));
}

TEST(Seek) {
  Memtable m;
  for (const char* k : {"b", "d", "f"}) m.Put(k, "v");
  struct Case {
    const char* target;
    const char* want;  // nullptr: the iterator must be exhausted
  };
  for (Case c : {Case{"a", "b"}, Case{"b", "b"}, Case{"c", "d"}, Case{"f", "f"}, Case{"g", nullptr}}) {
    lsmkv::Iterator it = m.NewIterator();
    it.Seek(c.target);
    if (c.want == nullptr) {
      CHECK_MSG(!it.Valid(), "Seek(\"" << c.target << "\") landed on \"" << it.Key()
                                       << "\", want exhausted");
    } else {
      CHECK_MSG(it.Valid(), "Seek(\"" << c.target << "\") exhausted, want \"" << c.want << "\"");
      CHECK_MSG(it.Key() == c.want,
                "Seek(\"" << c.target << "\") = \"" << it.Key() << "\", want \"" << c.want << "\"");
    }
  }

  std::vector<std::string> walked;
  lsmkv::Iterator it = m.NewIterator();
  for (it.Seek("c"); it.Valid(); it.Next()) walked.emplace_back(it.Key());
  CHECK_EQ(Join(walked), std::string("[d f]"));
}

// Drives the memtable and a std::map with the same random Puts and Deletes,
// then checks every lookup and the full ordered walk.
TEST(RandomOpsMatchAModel) {
  std::mt19937 rnd(42);
  Memtable m;
  std::map<std::string, std::optional<std::string>> model;  // nullopt: deleted

  for (int i = 0; i < 20000; ++i) {
    std::string key = KeyN("key%04d", static_cast<int>(rnd() % 2000));
    if (rnd() % 4 == 0) {
      m.Delete(key);
      model[key] = std::nullopt;
      continue;
    }
    std::string val = "v" + std::to_string(i);
    m.Put(key, val);
    model[key] = val;
  }

  CHECK_EQ(m.Len(), model.size());
  size_t want_size = 0;
  for (const auto& [k, v] : model) {
    want_size += lsmkv::EntrySize(k, v.value_or(""));
    if (v) {
      ExpectGet(m, k, *v, Result::kFound);
    } else {
      ExpectGet(m, k, "", Result::kDeleted);
    }
  }
  CHECK_EQ(m.ApproximateSize(), want_size);
  ExpectGet(m, "key9999", "", Result::kMissing);

  auto want = model.begin();
  lsmkv::Iterator it = m.NewIterator();
  for (it.SeekToFirst(); it.Valid(); it.Next(), ++want) {
    CHECK_MSG(want != model.end(), "iterator yielded more than " << model.size() << " entries");
    CHECK_EQ(std::string(it.Key()), want->first);
    CHECK_MSG((it.kind() == Kind::kTombstone) == !want->second.has_value(),
              "entry \"" << want->first << "\" kind = " << lsmkv::KindName(it.kind()));
  }
  CHECK_MSG(want == model.end(), "iterator stopped early");
}

// Fails if lookups crawl level 0. A linear scan over 100k keys averages ~50k
// comparisons; a working skiplist needs a few dozen.
TEST(SearchIsLogarithmic) {
  constexpr int n = 100000;
  Memtable m;
  for (int i = 0; i < n; ++i) m.Put(KeyN("key%08d", i), "v");
  lsmkv::SkipList& list = lsmkv::MemtableTestPeer::List(m);
  CHECK_MSG(list.height() >= 4,
            "list height = " << list.height() << " after " << n << " inserts; Put is not building towers");

  std::mt19937 rnd(7);
  constexpr int lookups = 2000;
  list.ResetCompares();
  std::string value;
  for (int i = 0; i < lookups; ++i) {
    std::string key = KeyN("key%08d", static_cast<int>(rnd() % n));
    CHECK_MSG(m.Get(key, &value) == Result::kFound, "Get(\"" << key << "\") is not kFound");
  }
  double avg = static_cast<double>(list.compares()) / lookups;
  std::cout << "      average comparisons per lookup: " << avg << "\n";
  CHECK_MSG(avg <= 150, "average " << avg << " comparisons per lookup over " << n
                                   << " keys; search is not using the upper levels");
}

int main() { return check::RunAll(); }
