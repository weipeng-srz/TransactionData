package marketdata

import "time"

// Trade is one Level-1 historical transaction row returned by the provider.
// TDX timestamps historical transactions to the minute and may aggregate
// multiple exchange executions into one row.
type Trade struct {
	Time         time.Time
	Price        float64
	VolumeShares int64
	Status       int64
}

func (t Trade) SideName() string {
	switch t.Status {
	case 0:
		return "买盘"
	case 1:
		return "卖盘"
	case 2:
		return "中性盘"
	default:
		return "其他"
	}
}

// SessionName classifies a transaction into the exchange trading phase using
// the minute-level timestamp exposed by the free TDX feed. It is deliberately
// coarse: the source does not expose order-entry timestamps inside a minute.
func (t Trade) SessionName() string {
	minute := t.Time.Hour()*60 + t.Time.Minute()
	switch {
	case minute >= 9*60+15 && minute <= 9*60+25:
		return "开盘集合竞价"
	case minute >= 9*60+30 && minute <= 11*60+30:
		return "连续竞价"
	case minute >= 13*60 && minute <= 14*60+56:
		return "连续竞价"
	case minute >= 14*60+57 && minute <= 15*60:
		return "收盘集合竞价"
	case minute > 15*60 && minute <= 15*60+30:
		return "盘后交易"
	default:
		return "其他时段"
	}
}
