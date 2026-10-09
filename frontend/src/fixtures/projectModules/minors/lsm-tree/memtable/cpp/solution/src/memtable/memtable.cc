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
  std::unique_lock lock(mu_);
  list_.Put(std::string(key), "", Kind::kTombstone);
}

Result Memtable::Get(std::string_view key, std::string* value) const {
  std::shared_lock lock(mu_);
  const Node* n = list_.Get(key);
  if (n == nullptr) {
    return Result::kMissing;
  }
  if (n->kind == Kind::kTombstone) {
    return Result::kDeleted;
  }
  *value = n->value;
  return Result::kFound;
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
