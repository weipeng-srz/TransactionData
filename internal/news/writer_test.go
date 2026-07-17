package news

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteCSV(t *testing.T) {
	location := chinaLocation()
	path := filepath.Join(t.TempDir(), "nested", "news.csv")
	articles := []Article{{
		Symbol:         "600000",
		CompanyName:    "浦发银行",
		Portal:         "新浪搜索",
		Channel:        "新闻/财经",
		Media:          "上海证券报",
		PublishedAt:    time.Date(2026, 7, 16, 9, 30, 0, 0, location),
		Title:          "=危险标题",
		Summary:        "测试摘要",
		URL:            "https://example.com/news",
		Relevance:      1,
		Sentiment:      "负面",
		SentimentScore: -1,
		NegativeTerms:  []string{"处罚", "违规"},
	}}
	if err := WriteCSV(path, articles, time.Date(2026, 7, 17, 10, 0, 0, 0, location)); err != nil {
		t.Fatal(err)
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
	if len(records) != 2 || len(records[0]) != len(csvHeader) {
		t.Fatalf("records = %#v", records)
	}
	if records[1][0] != "600000" || records[1][5] != "2026-07-16 09:30:00" || records[1][8] != "-1.000" {
		t.Fatalf("record values = %#v", records[1])
	}
	if records[1][11] != "'=危险标题" {
		t.Fatalf("formula-safe title = %q", records[1][11])
	}
}

func TestWriteCSVAllowsEmptyResults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "news.csv")
	if err := WriteCSV(path, nil, time.Now()); err != nil {
		t.Fatal(err)
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
	if len(records) != 1 {
		t.Fatalf("records = %#v", records)
	}
}
