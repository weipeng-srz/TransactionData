package main

import (
	"context"
	"testing"
	"time"

	"stockticks/internal/marketdata"
)

type fakeMarketClient struct {
	counts map[string]int
}

func (f fakeMarketClient) DayTrades(_ context.Context, _, date string) ([]marketdata.Trade, error) {
	return make([]marketdata.Trade, f.counts[date]), nil
}

func TestFindTradingDaysIncludesTodayAfterClose(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 10, 18, 30, 0, 0, location)
	client := fakeMarketClient{counts: map[string]int{
		"2026-07-10": 99,
		"2026-07-09": 2,
		"2026-07-08": 3,
	}}

	days, err := findTradingDays(context.Background(), client, "sz000001", 2, now, nil)
	if err != nil {
		t.Fatal(err)
	}
	if days[0].Date != "2026-07-10" || days[1].Date != "2026-07-09" {
		t.Fatalf("days = %#v", days)
	}
}

func TestFindTradingDaysSkipsTodayBeforeClose(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 10, 15, 30, 0, 0, location)
	client := fakeMarketClient{counts: map[string]int{
		"2026-07-10": 99,
		"2026-07-09": 2,
	}}
	days, err := findTradingDays(context.Background(), client, "sz000001", 1, now, nil)
	if err != nil {
		t.Fatal(err)
	}
	if days[0].Date != "2026-07-09" {
		t.Fatalf("days = %#v", days)
	}
}
