package tdx

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"stockticks/internal/marketdata"
)

func decodeHistoryTrades(body []byte, date string) ([]marketdata.Trade, error) {
	if len(body) < 6 {
		return nil, fmt.Errorf("通达信历史分笔响应过短: %d", len(body))
	}
	tradeDate, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		return nil, fmt.Errorf("解析交易日期失败: %w", err)
	}

	count := int(binary.LittleEndian.Uint16(body[:2]))
	body = body[6:]
	trades := make([]marketdata.Trade, 0, count)
	var lastPriceMilli int64
	for index := 0; index < count; index++ {
		if len(body) < 2 {
			return nil, fmt.Errorf("通达信第 %d 条记录缺少时间", index+1)
		}
		minuteOfDay := binary.LittleEndian.Uint16(body[:2])
		body = body[2:]

		var priceDelta, volumeLots, status int64
		body, priceDelta, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条价格失败: %w", index+1, err)
		}
		lastPriceMilli += priceDelta * 10
		body, volumeLots, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条成交量失败: %w", index+1, err)
		}
		body, status, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条买卖状态失败: %w", index+1, err)
		}
		body, _, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条保留字段失败: %w", index+1, err)
		}
		if minuteOfDay >= 24*60 {
			return nil, fmt.Errorf("第 %d 条记录的分钟值无效: %d", index+1, minuteOfDay)
		}
		if lastPriceMilli <= 0 || volumeLots < 0 {
			return nil, fmt.Errorf("第 %d 条记录包含无效价格或成交量", index+1)
		}

		trades = append(trades, marketdata.Trade{
			Time: time.Date(
				tradeDate.Year(), tradeDate.Month(), tradeDate.Day(),
				int(minuteOfDay/60), int(minuteOfDay%60), 0, 0, tradeDate.Location(),
			),
			Price:        float64(lastPriceMilli) / 1000,
			VolumeShares: volumeLots * 100,
			Status:       status,
		})
	}
	return trades, nil
}

func decodeCurrentTrades(body []byte, date string) ([]marketdata.Trade, error) {
	if len(body) < 2 {
		return nil, fmt.Errorf("通达信当日分笔响应过短: %d", len(body))
	}
	tradeDate, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		return nil, fmt.Errorf("解析交易日期失败: %w", err)
	}
	count := int(binary.LittleEndian.Uint16(body[:2]))
	body = body[2:]
	trades := make([]marketdata.Trade, 0, count)
	var lastPriceMilli int64
	for index := 0; index < count; index++ {
		if len(body) < 2 {
			return nil, fmt.Errorf("通达信第 %d 条当日记录缺少时间", index+1)
		}
		minuteOfDay := binary.LittleEndian.Uint16(body[:2])
		body = body[2:]

		var priceDelta, volumeLots, status int64
		body, priceDelta, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条当日价格失败: %w", index+1, err)
		}
		lastPriceMilli += priceDelta * 10
		body, volumeLots, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条当日成交量失败: %w", index+1, err)
		}
		// The current-day format contains an additional aggregate trade-count
		// field that the historical format does not expose.
		body, _, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条当日成交笔数失败: %w", index+1, err)
		}
		body, status, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条当日买卖状态失败: %w", index+1, err)
		}
		body, _, err = cutSignedVarint(body)
		if err != nil {
			return nil, fmt.Errorf("解析第 %d 条当日保留字段失败: %w", index+1, err)
		}
		if minuteOfDay >= 24*60 || lastPriceMilli <= 0 || volumeLots < 0 {
			return nil, fmt.Errorf("第 %d 条当日记录包含无效字段", index+1)
		}
		trades = append(trades, marketdata.Trade{
			Time: time.Date(
				tradeDate.Year(), tradeDate.Month(), tradeDate.Day(),
				int(minuteOfDay/60), int(minuteOfDay%60), 0, 0, tradeDate.Location(),
			),
			Price:        float64(lastPriceMilli) / 1000,
			VolumeShares: volumeLots * 100,
			Status:       status,
		})
	}
	return trades, nil
}

func cutSignedVarint(data []byte) ([]byte, int64, error) {
	for index, value := range data {
		if value&0x80 != 0 {
			continue
		}
		encoded := data[:index+1]
		result := int64(encoded[0] & 0x3F)
		for offset := 1; offset < len(encoded); offset++ {
			result += int64(encoded[offset]&0x7F) << uint(6+(offset-1)*7)
		}
		if encoded[0]&0x40 != 0 {
			result = -result
		}
		return data[index+1:], result, nil
	}
	return nil, 0, errors.New("未终止的变长整数")
}
