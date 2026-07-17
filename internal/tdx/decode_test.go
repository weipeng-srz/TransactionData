package tdx

import (
	"encoding/binary"
	"testing"
)

func TestDecodeHistoryTrades(t *testing.T) {
	body := make([]byte, 6)
	binary.LittleEndian.PutUint16(body[:2], 2)
	body = append(body, minuteBytes(570)...)
	body = append(body, encodeSignedVarint(1050)...)
	body = append(body, encodeSignedVarint(10)...)
	body = append(body, encodeSignedVarint(0)...)
	body = append(body, encodeSignedVarint(0)...)
	body = append(body, minuteBytes(571)...)
	body = append(body, encodeSignedVarint(-1)...)
	body = append(body, encodeSignedVarint(20)...)
	body = append(body, encodeSignedVarint(1)...)
	body = append(body, encodeSignedVarint(0)...)

	trades, err := decodeHistoryTrades(body, "2026-07-09")
	if err != nil {
		t.Fatalf("decodeHistoryTrades() error = %v", err)
	}
	if len(trades) != 2 {
		t.Fatalf("len(trades) = %d, want 2", len(trades))
	}
	if trades[0].Price != 10.5 || trades[0].VolumeShares != 1000 || trades[0].SideName() != "买盘" {
		t.Fatalf("first trade = %#v", trades[0])
	}
	if trades[1].Price != 10.49 || trades[1].VolumeShares != 2000 || trades[1].SideName() != "卖盘" {
		t.Fatalf("second trade = %#v", trades[1])
	}
}

func TestSplitSymbolRejectsBeijing(t *testing.T) {
	if _, _, err := splitSymbol("bj920493"); err == nil {
		t.Fatal("splitSymbol() unexpectedly accepted a Beijing symbol")
	}
}

func minuteBytes(value uint16) []byte {
	result := make([]byte, 2)
	binary.LittleEndian.PutUint16(result, value)
	return result
}

func encodeSignedVarint(value int64) []byte {
	negative := value < 0
	if negative {
		value = -value
	}
	first := byte(value & 0x3F)
	value >>= 6
	if negative {
		first |= 0x40
	}
	result := []byte{first}
	for value > 0 {
		result[len(result)-1] |= 0x80
		result = append(result, byte(value&0x7F))
		value >>= 7
	}
	return result
}
