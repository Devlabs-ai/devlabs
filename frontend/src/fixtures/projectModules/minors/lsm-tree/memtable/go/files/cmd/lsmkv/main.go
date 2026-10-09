// Command lsmkv is a REPL over the store as it grows. In chapter 1 there is
// only a memtable, so everything is lost on exit; chapter 2 fixes that.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/devlabs/lsmkv/internal/memtable"
)

const help = `commands:
  put <key> <value>   store a value
  get <key>           look a key up
  del <key>           delete a key (writes a tombstone)
  scan [from]         list entries in key order, tombstones included
  stats               entry count and approximate size
  quit`

func main() {
	m := memtable.New()
	in := bufio.NewScanner(os.Stdin)
	fmt.Println("lsmkv: memtable only (chapter 1). Type 'help'.")

	for {
		fmt.Print("> ")
		if !in.Scan() {
			fmt.Println()
			return
		}
		fields := strings.Fields(in.Text())
		if len(fields) == 0 {
			continue
		}
		switch cmd, args := strings.ToLower(fields[0]), fields[1:]; {
		case cmd == "put" && len(args) >= 2:
			m.Put([]byte(args[0]), []byte(strings.Join(args[1:], " ")))
			fmt.Println("OK")
		case cmd == "get" && len(args) == 1:
			value, res := m.Get([]byte(args[0]))
			if res == memtable.Found {
				fmt.Printf("%q\n", value)
			} else {
				fmt.Printf("(%v)\n", res)
			}
		case cmd == "del" && len(args) == 1:
			m.Delete([]byte(args[0]))
			fmt.Println("OK")
		case cmd == "scan" && len(args) <= 1:
			it := m.NewIterator()
			if len(args) == 1 {
				it.Seek([]byte(args[0]))
			} else {
				it.SeekToFirst()
			}
			for ; it.Valid(); it.Next() {
				if it.Kind() == memtable.KindTombstone {
					fmt.Printf("%s  (tombstone)\n", it.Key())
				} else {
					fmt.Printf("%s  %q\n", it.Key(), it.Value())
				}
			}
		case cmd == "stats":
			fmt.Printf("entries=%d approx_bytes=%d\n", m.Len(), m.ApproximateSize())
		case cmd == "quit" || cmd == "exit":
			return
		default:
			fmt.Println(help)
		}
	}
}
