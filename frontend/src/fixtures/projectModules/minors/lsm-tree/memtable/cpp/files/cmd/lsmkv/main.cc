// REPL over the store as it grows. In chapter 1 there is only a memtable, so
// everything is lost on exit; chapter 2 fixes that.

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "memtable/memtable.h"

namespace {

const char* kHelp = R"(commands:
  put <key> <value>   store a value
  get <key>           look a key up
  del <key>           delete a key (writes a tombstone)
  scan [from]         list entries in key order, tombstones included
  stats               entry count and approximate size
  quit)";

}  // namespace

int main() {
  lsmkv::Memtable m;
  std::cout << "lsmkv: memtable only (chapter 1). Type 'help'.\n";

  std::string line;
  while (true) {
    std::cout << "> " << std::flush;
    if (!std::getline(std::cin, line)) {
      std::cout << "\n";
      return 0;
    }
    std::istringstream in(line);
    std::vector<std::string> args;
    for (std::string word; in >> word;) args.push_back(word);
    if (args.empty()) continue;
    const std::string cmd = args[0];
    args.erase(args.begin());

    if (cmd == "put" && args.size() >= 2) {
      std::string value = args[1];
      for (size_t i = 2; i < args.size(); ++i) value += " " + args[i];
      m.Put(args[0], value);
      std::cout << "OK\n";
    } else if (cmd == "get" && args.size() == 1) {
      std::string value;
      lsmkv::Result res = m.Get(args[0], &value);
      if (res == lsmkv::Result::kFound) {
        std::cout << '"' << value << "\"\n";
      } else {
        std::cout << "(" << lsmkv::ResultName(res) << ")\n";
      }
    } else if (cmd == "del" && args.size() == 1) {
      m.Delete(args[0]);
      std::cout << "OK\n";
    } else if (cmd == "scan" && args.size() <= 1) {
      lsmkv::Iterator it = m.NewIterator();
      if (args.empty()) {
        it.SeekToFirst();
      } else {
        it.Seek(args[0]);
      }
      for (; it.Valid(); it.Next()) {
        if (it.kind() == lsmkv::Kind::kTombstone) {
          std::cout << it.Key() << "  (tombstone)\n";
        } else {
          std::cout << it.Key() << "  \"" << it.Value() << "\"\n";
        }
      }
    } else if (cmd == "stats") {
      std::cout << "entries=" << m.Len() << " approx_bytes=" << m.ApproximateSize() << "\n";
    } else if (cmd == "quit" || cmd == "exit") {
      return 0;
    } else {
      std::cout << kHelp << "\n";
    }
  }
}
