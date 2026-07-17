package marketdata

import (
	"testing"
	"time"
)

func TestSessionName(t *testing.T) {
	tests := []struct {
		hour   int
		minute int
		want   string
	}{
		{9, 25, "开盘集合竞价"},
		{9, 30, "连续竞价"},
		{11, 30, "连续竞价"},
		{14, 57, "收盘集合竞价"},
		{15, 0, "收盘集合竞价"},
		{15, 5, "盘后交易"},
	}
	for _, test := range tests {
		trade := Trade{Time: time.Date(2026, 7, 16, test.hour, test.minute, 0, 0, time.Local)}
		if got := trade.SessionName(); got != test.want {
			t.Errorf("SessionName(%02d:%02d) = %q, want %q", test.hour, test.minute, got, test.want)
		}
	}
}
