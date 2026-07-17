package news

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var csvHeader = []string{
	"股票代码",
	"股票名称",
	"检索入口",
	"频道",
	"媒体来源",
	"发布时间",
	"相关性得分",
	"情绪倾向",
	"情绪得分",
	"正向词",
	"负向词",
	"新闻标题",
	"新闻摘要",
	"原文链接",
	"采集时间",
}

// WriteCSV atomically replaces path after the complete result has been
// flushed. A successful empty search still produces a header-only CSV.
func WriteCSV(path string, articles []Article, fetchedAt time.Time) (err error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("解析输出路径失败: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return fmt.Errorf("创建输出目录失败: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(absPath), ".news-*.csv")
	if err != nil {
		return fmt.Errorf("创建临时 CSV 失败: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	writer := csv.NewWriter(tmp)
	if err := writer.Write(csvHeader); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("写入 CSV 表头失败: %w", err)
	}
	fetched := formatChinaTime(fetchedAt)
	for _, article := range articles {
		record := []string{
			article.Symbol,
			safeTextCell(article.CompanyName),
			safeTextCell(article.Portal),
			safeTextCell(article.Channel),
			safeTextCell(article.Media),
			formatChinaTime(article.PublishedAt),
			strconv.FormatFloat(article.Relevance, 'f', 2, 64),
			article.Sentiment,
			strconv.FormatFloat(article.SentimentScore, 'f', 3, 64),
			strings.Join(article.PositiveTerms, "；"),
			strings.Join(article.NegativeTerms, "；"),
			safeTextCell(article.Title),
			safeTextCell(article.Summary),
			article.URL,
			fetched,
		}
		if err := writer.Write(record); err != nil {
			_ = tmp.Close()
			return fmt.Errorf("写入 CSV 失败: %w", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("刷新 CSV 失败: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("保存 CSV 失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("关闭 CSV 失败: %w", err)
	}
	if err := os.Rename(tmpName, absPath); err != nil {
		if removeErr := os.Remove(absPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("替换已有 CSV 失败: %w", err)
		}
		if renameErr := os.Rename(tmpName, absPath); renameErr != nil {
			return fmt.Errorf("保存 CSV 失败: %w", renameErr)
		}
	}
	return nil
}

func formatChinaTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.In(chinaLocation()).Format("2006-01-02 15:04:05")
}

// Prevent text returned by a website from becoming a formula when the CSV is
// opened in spreadsheet software.
func safeTextCell(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	default:
		return value
	}
}
