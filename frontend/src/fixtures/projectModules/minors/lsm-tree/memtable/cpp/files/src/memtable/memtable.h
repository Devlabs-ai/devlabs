#pragma once

// The in-memory, sorted write buffer of the LSM tree.
//
// Every Put and Delete lands here first. When it grows past a size limit it is
// frozen and flushed to disk as an SSTable (chapter 3), and a fresh memtable
// takes its place.

#include <shared_mutex>
#include <string>
#include <string_view>

#include "memtable/iterator.h"
#include "memtable/skiplist.h"

namespace lsmkv {

// The outcome of a lookup in one memtable.
enum class Result {
  // This memtable knows nothing about the key. Older tables might.
  kMissing,
  // The key has a live value here.
  kFound,
  // The newest thing written for the key is a tombstone. The key is gone;
  // do not look in older tables.
  kDeleted,
};

const char* ResultName(Result result);

// A sorted, in-memory map safe for one writer and many readers.
class Memtable {
 public:
  Memtable();

  // Stores value under key, replacing anything written for key before. Key
  // and value are copied, so callers may reuse their buffers.
  void Put(std::string_view key, std::string_view value);

  // Records that key no longer exists.
  void Delete(std::string_view key);

  // Looks key up in this memtable only. *value is set only when the result
  // is kFound.
  Result Get(std::string_view key, std::string* value) const;

  // Number of entries, tombstones included.
  size_t Len() const;

  // Memory the entries account for, in bytes.
  size_t ApproximateSize() const;

  // An iterator that is not positioned yet. Call SeekToFirst or Seek.
  Iterator NewIterator() const { return Iterator(&list_); }

 private:
  friend struct MemtableTestPeer;

  mutable std::shared_mutex mu_;
  SkipList list_;
};

}  // namespace lsmkv
