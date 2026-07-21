package exportcsv

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/weipeng-srz/TransactionData/internal/marketdata"
)

func TestWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.csv")
	days := []DailyTrades{{
		Date:                    "2026-07-09",
		ForwardAdjustmentFactor: 1.25,
		ListedAShares:           1_234_567_890,
		ShareCapitalDate:        "2026-06-30",
		Trades: []marketdata.Trade{{
			Time:         time.Date(2026, 7, 9, 9, 30, 0, 0, time.Local),
			Price:        10.510,
			VolumeShares: 200,
			Status:       0,
		}},
	}}
	metadata := FileMetadata{ListedAShares: 1_234_567_890, ShareCapitalDate: "2026-06-30", SecurityName: "平安银行"}
	rows, err := Write(path, "sz000001", metadata, days)
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if rows != 1 {
		t.Fatalf("Write() rows = %d, want 1", rows)
	}

	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if got := records[0]; len(got) != 10 || got[0] != "#META" || got[1] != "股票代码=000001" || got[2] != "股票名称=平安银行" || got[3] != "流通A股本(股)=1234567890" || got[4] != "流通股本生效日=2026-06-30" || got[5] != "价格口径=前复权" || got[6] != "成交数据级别=Level-1历史分笔" {
		t.Fatalf("metadata = %#v", got)
	}
	if got := records[1]; len(got) != 10 || got[0] != "#DAY" || got[1] != "交易日期=2026-07-09" || got[2] != "前复权因子=1.2500000000" || got[3] != "流通A股本(股)=1234567890" {
		t.Fatalf("daily metadata = %#v", got)
	}
	if got := records[2]; len(got) != 10 || got[0] != "交易日期" || got[3] != "原始成交价格(元)" || got[4] != "前复权成交价格(元)" {
		t.Fatalf("header = %#v", got)
	}
	if got := records[3][4]; got != "8.408" {
		t.Fatalf("forward-adjusted price = %q, want 8.408", got)
	}
	if got := records[3][3]; got != "10.510" {
		t.Fatalf("raw price = %q, want 10.510", got)
	}
	if got := records[3][6]; got != "2102.000" {
		t.Fatalf("amount = %q, want 2102.000", got)
	}
	if got := records[3][7]; got != "买盘" {
		t.Fatalf("kind = %q, want 买盘", got)
	}
	if got := records[3][8]; got != "0" {
		t.Fatalf("raw kind = %q, want 0", got)
	}
	if got := records[3][9]; got != "连续竞价" {
		t.Fatalf("session = %q, want 连续竞价", got)
	}
}
