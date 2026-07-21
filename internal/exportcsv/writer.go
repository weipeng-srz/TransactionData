package exportcsv

import (
	"encoding/csv"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"

	"github.com/weipeng-srz/TransactionData/internal/marketdata"
	"github.com/weipeng-srz/TransactionData/internal/stock"
)

type DailyTrades struct {
	Date                    string
	Trades                  []marketdata.Trade
	ForwardAdjustmentFactor float64
	ListedAShares           int64
	ShareCapitalDate        string
}

type FileMetadata struct {
	ListedAShares    int64
	ShareCapitalDate string
	SecurityName     string
}

var header = []string{
	"交易日期",
	"成交时间",
	"数据序号",
	"原始成交价格(元)",
	"前复权成交价格(元)",
	"成交量(股)",
	"成交金额(元)",
	"性质",
	"原始性质代码",
	"交易时段",
}

// Write atomically replaces path only after all CSV rows have been written.
func Write(path, symbol string, metadata FileMetadata, days []DailyTrades) (rowCount int, err error) {
	if metadata.ListedAShares <= 0 {
		return 0, fmt.Errorf("流通A股本无效: %d", metadata.ListedAShares)
	}
	if metadata.ShareCapitalDate == "" {
		return 0, fmt.Errorf("缺少流通股本生效日")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return 0, fmt.Errorf("解析输出路径失败: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return 0, fmt.Errorf("创建输出目录失败: %w", err)
	}

	tmp, err := os.CreateTemp(filepath.Dir(absPath), ".data-*.csv")
	if err != nil {
		return 0, fmt.Errorf("创建临时 CSV 失败: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()

	writer := csv.NewWriter(tmp)
	metadataRecord := []string{
		"#META",
		"股票代码=" + stock.DisplayCode(symbol),
		"股票名称=" + metadata.SecurityName,
		"流通A股本(股)=" + strconv.FormatInt(metadata.ListedAShares, 10),
		"流通股本生效日=" + metadata.ShareCapitalDate,
		"价格口径=前复权",
		"成交数据级别=Level-1历史分笔",
		"成交时间精度=分钟",
		"数据序号口径=文件内单日顺序",
		"成交金额口径=原始成交价×成交量",
	}
	if err := writer.Write(metadataRecord); err != nil {
		_ = tmp.Close()
		return 0, fmt.Errorf("写入 CSV 元数据失败: %w", err)
	}
	for _, day := range days {
		if day.ForwardAdjustmentFactor <= 0 {
			_ = tmp.Close()
			return 0, fmt.Errorf("%s 的前复权因子无效: %.16f", day.Date, day.ForwardAdjustmentFactor)
		}
		if day.ListedAShares <= 0 {
			_ = tmp.Close()
			return 0, fmt.Errorf("%s 的流通A股本无效: %d", day.Date, day.ListedAShares)
		}
		if day.ShareCapitalDate == "" {
			_ = tmp.Close()
			return 0, fmt.Errorf("%s 缺少流通股本生效日", day.Date)
		}
		dailyRecord := []string{
			"#DAY",
			"交易日期=" + day.Date,
			"前复权因子=" + strconv.FormatFloat(day.ForwardAdjustmentFactor, 'f', 10, 64),
			"流通A股本(股)=" + strconv.FormatInt(day.ListedAShares, 10),
			"流通股本生效日=" + day.ShareCapitalDate,
			"",
			"",
			"",
			"",
			"",
		}
		if err := writer.Write(dailyRecord); err != nil {
			_ = tmp.Close()
			return 0, fmt.Errorf("写入 %s 每日元数据失败: %w", day.Date, err)
		}
	}
	if err := writer.Write(header); err != nil {
		_ = tmp.Close()
		return 0, fmt.Errorf("写入 CSV 表头失败: %w", err)
	}

	for _, day := range days {
		for index, trade := range day.Trades {
			record, buildErr := record(day, index+1, trade)
			if buildErr != nil {
				_ = tmp.Close()
				return 0, buildErr
			}
			if err := writer.Write(record); err != nil {
				_ = tmp.Close()
				return 0, fmt.Errorf("写入 CSV 失败: %w", err)
			}
			rowCount++
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		_ = tmp.Close()
		return 0, fmt.Errorf("刷新 CSV 失败: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return 0, fmt.Errorf("保存 CSV 失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return 0, fmt.Errorf("关闭 CSV 失败: %w", err)
	}

	if err := os.Rename(tmpName, absPath); err != nil {
		// Windows cannot replace an existing target with Rename.
		if removeErr := os.Remove(absPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return 0, fmt.Errorf("替换已有 CSV 失败: %w", err)
		}
		if renameErr := os.Rename(tmpName, absPath); renameErr != nil {
			return 0, fmt.Errorf("保存 CSV 失败: %w", renameErr)
		}
	}
	return rowCount, nil
}

func record(day DailyTrades, sequence int, trade marketdata.Trade) ([]string, error) {
	date := day.Date
	if trade.Price <= 0 {
		return nil, fmt.Errorf("%s %s 的成交价格无效: %.3f", date, trade.Time.Format("15:04:05"), trade.Price)
	}
	if trade.VolumeShares < 0 {
		return nil, fmt.Errorf("%s %s 的成交量无效: %d", date, trade.Time.Format("15:04:05"), trade.VolumeShares)
	}
	if day.ForwardAdjustmentFactor <= 0 {
		return nil, fmt.Errorf("%s 的前复权因子无效: %.16f", date, day.ForwardAdjustmentFactor)
	}

	adjustedPrice := trade.Price / day.ForwardAdjustmentFactor
	if adjustedPrice <= 0 || math.IsNaN(adjustedPrice) || math.IsInf(adjustedPrice, 0) {
		return nil, fmt.Errorf("%s %s 的前复权成交价格无效", date, trade.Time.Format("15:04:05"))
	}
	price := strconv.FormatFloat(adjustedPrice, 'f', 3, 64)
	rawPrice := strconv.FormatFloat(trade.Price, 'f', 3, 64)
	volume := strconv.FormatInt(trade.VolumeShares, 10)
	amount := trade.Price * float64(trade.VolumeShares)
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return nil, fmt.Errorf("%s %s 的成交金额无效", date, trade.Time.Format("15:04:05"))
	}

	return []string{
		date,
		trade.Time.Format("15:04:05"),
		strconv.Itoa(sequence),
		rawPrice,
		price,
		volume,
		strconv.FormatFloat(amount, 'f', 3, 64),
		trade.SideName(),
		strconv.FormatInt(trade.Status, 10),
		trade.SessionName(),
	}, nil
}
