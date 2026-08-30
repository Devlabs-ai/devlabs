// Package proto implements Cinder's module-1 wire format.
//
// One request per line, CRLF terminated; a bare LF is accepted so telnet works.
// Replies borrow Redis's prefix convention (+simple, -error, $payload).
//
// The new piece in this module is NextFrame. With blocking reads, bufio found
// message boundaries for us. The event loop owns its own buffer, so framing
// becomes an explicit, restartable operation over whatever bytes have arrived.
package proto

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
)

// CRLF terminates every request and every reply.
const CRLF = "\r\n"

// ErrEmpty is returned for a line with no verb.
var ErrEmpty = errors.New("proto: empty request")

// Request is one parsed command line.
type Request struct {
	// Name is the verb, upper-cased so dispatch is case-insensitive.
	Name string
	// Args are the whitespace-separated arguments after the verb.
	Args []string
}

// NextFrame splits the first complete request out of buf.
//
// It returns the line without its terminator, the bytes that follow it, and
// whether a complete frame was found at all. When ok is false the caller keeps
// buf as-is and waits for more bytes — a half-arrived request is the normal
// case on a stream, not an error.
//
// The returned slices alias buf. That is deliberate: framing runs on every
// read, and copying here would allocate on the hottest path in the server.
func NextFrame(buf []byte) (line, rest []byte, ok bool) {
	i := bytes.IndexByte(buf, '\n')
	if i < 0 {
		return nil, buf, false
	}
	line = buf[:i]
	if n := len(line); n > 0 && line[n-1] == '\r' {
		line = line[:n-1]
	}
	return line, buf[i+1:], true
}

// HasFrame reports whether buf holds at least one complete request. Used to
// tell "the client is slow" apart from "the client is flooding us without ever
// sending a newline".
func HasFrame(buf []byte) bool {
	return bytes.IndexByte(buf, '\n') >= 0
}

// ParseLine splits a request line into a Request.
func ParseLine(line string) (Request, error) {
	fields := strings.Fields(strings.TrimRight(line, "\r\n"))
	if len(fields) == 0 {
		return Request{}, ErrEmpty
	}
	return Request{
		Name: strings.ToUpper(fields[0]),
		Args: fields[1:],
	}, nil
}

// Simple formats a "+OK"-style reply.
func Simple(s string) string { return "+" + s + CRLF }

// Payload formats a value reply.
func Payload(s string) string { return "$" + s + CRLF }

// Error formats an error reply, flattened onto one line.
func Error(msg string) string {
	return "-ERR " + strings.ReplaceAll(msg, "\n", " ") + CRLF
}

// Errorf is Error with formatting.
func Errorf(format string, args ...any) string {
	return Error(fmt.Sprintf(format, args...))
}
