#include "memtable/memtable.h"

#include <mutex>
#include <stdexcept>

namespace lsmkv {

const char* ResultName(Result result) {
  switch (result) {
    case Result::kMissing:
      return "missing";
    case Result::kFound:
      return "found";
    case Result::kDeleted:
      return "deleted";
  }
  return "unknown";
}

Memtable::Memtable() : list_(0x5EED) {}

void Memtable::Put(std::string_view key, std::string_view value) {
  std::unique_lock lock(mu_);
  list_.Put(std::string(key), std::string(value), Kind::kValue);
}

void Memtable::Delete(std::string_view key) {
  // ── TODO(1.3) — a delete is a write ───────────────────────────────────────
  //
  // Do not remove the node. Older SSTables on disk may still hold a value
  // for key, and removing it here would let that old value reappear.
  //
  // Take the write lock (std::unique_lock, like Put) and store a tombstone:
  // list_.Put(std::string(key), "", Kind::kTombstone)
  (void)key;
  throw std::logic_error("TODO(1.3): Delete — write a tombstone instead of removing the key");
}

Result Memtable::Get(std::string_view key, std::string* value) const {
  // ── TODO(1.3) — three answers, not two ────────────────────────────────────
  //
  // Take the read lock (std::shared_lock) and list_.Get(key).
  //   no node                     -> Result::kMissing
  //   node->kind == kTombstone    -> Result::kDeleted
  //   otherwise                   -> *value = node->value; Result::kFound
  //
  // kMissing and kDeleted look alike to a user ("no value") but mean opposite
  // things to the read path in chapter 4: kMissing keeps searching older
  // tables, kDeleted stops.
  (void)key;
  (void)value;
  throw std::logic_error("TODO(1.3): Get — report kFound, kDeleted, or kMissing");
}

size_t Memtable::Len() const {
  std::shared_lock lock(mu_);
  return list_.length();
}

size_t Memtable::ApproximateSize() const {
  std::shared_lock lock(mu_);
  return list_.size();
}

}  // namespace lsmkv
