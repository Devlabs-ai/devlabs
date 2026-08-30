// Package logx is a deliberately small leveled logger.
//
// A real server would reach for structured logging. Cinder does not, for one
// reason: from module 2 the event loop is the hot path, and every log call on
// that path is a syscall the loop is not spending on clients. Small and
// obvious beats featureful here.
package logx

import (
	"log"
	"os"
	"strings"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelError
)

// Logger writes to stderr with a level filter. Safe for concurrent use because
// the standard log.Logger it wraps is.
type Logger struct {
	level Level
	out   *log.Logger
}

// New builds a Logger for the given level name (debug, info, error).
func New(level string) *Logger {
	return &Logger{
		level: parseLevel(level),
		out:   log.New(os.Stderr, "", log.LstdFlags|log.Lmicroseconds),
	}
}

func parseLevel(name string) Level {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "debug":
		return LevelDebug
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

func (l *Logger) Debugf(format string, args ...any) { l.logf(LevelDebug, "DEBUG ", format, args...) }
func (l *Logger) Infof(format string, args ...any)  { l.logf(LevelInfo, "INFO  ", format, args...) }
func (l *Logger) Errorf(format string, args ...any) { l.logf(LevelError, "ERROR ", format, args...) }

func (l *Logger) logf(at Level, prefix, format string, args ...any) {
	if at < l.level {
		return
	}
	l.out.Printf(prefix+format, args...)
}
