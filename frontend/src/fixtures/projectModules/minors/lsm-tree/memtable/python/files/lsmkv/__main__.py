"""REPL over the store as it grows. In chapter 1 there is only a memtable, so
everything is lost on exit; chapter 2 fixes that."""

from lsmkv.memtable import Kind, Memtable, Result

HELP = """commands:
  put <key> <value>   store a value
  get <key>           look a key up
  del <key>           delete a key (writes a tombstone)
  scan [from]         list entries in key order, tombstones included
  stats               entry count and approximate size
  quit"""


def main() -> None:
    m = Memtable()
    print("lsmkv: memtable only (chapter 1). Type 'help'.")
    while True:
        try:
            line = input("> ")
        except EOFError:
            print()
            return
        fields = line.split()
        if not fields:
            continue
        cmd, args = fields[0].lower(), fields[1:]
        if cmd == "put" and len(args) >= 2:
            m.put(args[0].encode(), " ".join(args[1:]).encode())
            print("OK")
        elif cmd == "get" and len(args) == 1:
            value, res = m.get(args[0].encode())
            print(repr(value.decode()) if res is Result.FOUND else f"({res.name.lower()})")
        elif cmd == "del" and len(args) == 1:
            m.delete(args[0].encode())
            print("OK")
        elif cmd == "scan" and len(args) <= 1:
            it = m.new_iterator()
            if args:
                it.seek(args[0].encode())
            else:
                it.seek_to_first()
            while it.valid():
                if it.kind() is Kind.TOMBSTONE:
                    print(f"{it.key().decode()}  (tombstone)")
                else:
                    print(f"{it.key().decode()}  {it.value().decode()!r}")
                it.next()
        elif cmd == "stats":
            print(f"entries={len(m)} approx_bytes={m.approximate_size()}")
        elif cmd in ("quit", "exit"):
            return
        else:
            print(HELP)


if __name__ == "__main__":
    main()
