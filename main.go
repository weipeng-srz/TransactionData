package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"stockticks/internal/companydata"
	"stockticks/internal/exportcsv"
	"stockticks/internal/marketdata"
	"stockticks/internal/stock"
	"stockticks/internal/tdx"
)

const (
	defaultTradingDays = 90
	maxTradingDays     = 250
	maxLookbackDays    = 400
)

type marketClient interface {
	DayTrades(ctx context.Context, symbol, date string) ([]marketdata.Trade, error)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr, time.Now()); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		if errors.Is(err, context.Canceled) {
			fmt.Fprintln(os.Stderr, "\n操作已取消。")
			os.Exit(130)
		}
		fmt.Fprintln(os.Stderr, "错误："+err.Error())
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer, now time.Time) error {
	flags := flag.NewFlagSet("stock-ticks", flag.ContinueOnError)
	flags.SetOutput(stdout)
	code := flags.String("code", "", "股票代码，如 600000、sz000001 或 000001.SZ")
	output := flags.String("output", "data.csv", "CSV 输出路径")
	days := flags.Int("days", defaultTradingDays, "导出的完整交易日数量")
	timeout := flags.Duration("timeout", 8*time.Second, "单次网络操作超时")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "用法：stock-ticks [选项] [股票代码]")
		fmt.Fprintln(flags.Output(), "\n下载沪深 A 股最近若干完整交易日的通达信 Level-1 历史分笔成交。")
		fmt.Fprintln(flags.Output(), "\n选项：")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("只能输入一个股票代码")
	}
	if *days < 1 || *days > maxTradingDays {
		return fmt.Errorf("days 必须在 1 到 %d 之间", maxTradingDays)
	}
	if *timeout <= 0 {
		return fmt.Errorf("timeout 必须大于 0")
	}
	if *code == "" && flags.NArg() == 1 {
		*code = flags.Arg(0)
	}
	if *code == "" {
		fmt.Fprint(stdout, "请输入沪深股票代码（如 600000、000001.SZ）：")
		reader := bufio.NewReader(stdin)
		line, err := reader.ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("读取股票代码失败: %w", err)
		}
		*code = strings.TrimSpace(line)
	}

	symbol, err := stock.NormalizeSymbol(*code)
	if err != nil {
		return err
	}
	if strings.HasPrefix(symbol, "bj") {
		return fmt.Errorf("免费通达信历史分笔目前只支持沪深市场，暂不支持北交所代码 %s", symbol)
	}

	client := tdx.NewClient(*timeout)
	defer client.Close()
	fmt.Fprintln(stdout, "数据口径：通达信免费 Level-1 历史分笔（非 Level-2 逐笔委托）。")
	fmt.Fprintln(stdout, "正在连接通达信行情服务器...")
	if err := client.Connect(ctx); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "已连接 %s，正在查找并下载 %s 最近 %d 个完整交易日...\n", client.Host(), symbol, *days)
	found, err := findTradingDays(ctx, client, symbol, *days, now, func(day exportcsv.DailyTrades) {
		fmt.Fprintf(stdout, "  %s：%d 条\n", day.Date, len(day.Trades))
	})
	if err != nil {
		return err
	}

	// findTradingDays returns newest first; CSV should be chronological.
	for left, right := 0, len(found)-1; left < right; left, right = left+1, right-1 {
		found[left], found[right] = found[right], found[left]
	}

	dates := make([]string, len(found))
	for index, day := range found {
		dates[index] = day.Date
	}
	fmt.Fprintln(stdout, "正在换算每日前复权价格并获取最新流通A股本...")
	infoClient := companydata.NewClient(*timeout)
	dailyInfos, err := infoClient.DailyInfos(ctx, symbol, dates)
	if err != nil {
		return fmt.Errorf("补充复权因子或流通股本失败: %w", err)
	}
	for index := range found {
		info, ok := dailyInfos[found[index].Date]
		if !ok {
			return fmt.Errorf("交易日 %s 缺少复权因子或流通股本", found[index].Date)
		}
		found[index].ForwardAdjustmentFactor = info.ForwardAdjustmentFactor
		found[index].ListedAShares = info.ListedAShares
		found[index].ShareCapitalDate = info.ShareCapitalDate
	}
	latestInfo := dailyInfos[found[len(found)-1].Date]
	metadata := exportcsv.FileMetadata{
		ListedAShares:    latestInfo.ListedAShares,
		ShareCapitalDate: latestInfo.ShareCapitalDate,
		SecurityName:     latestInfo.SecurityName,
	}

	rowCount, err := exportcsv.Write(*output, symbol, metadata, found)
	if err != nil {
		return err
	}
	absOutput, err := filepath.Abs(*output)
	if err != nil {
		absOutput = *output
	}
	fmt.Fprintf(stdout, "完成：共导出 %d 条成交明细到 %s\n", rowCount, absOutput)
	return nil
}

func findTradingDays(
	ctx context.Context,
	client marketClient,
	symbol string,
	wanted int,
	now time.Time,
	onFound func(exportcsv.DailyTrades),
) ([]exportcsv.DailyTrades, error) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return nil, fmt.Errorf("加载中国时区失败: %w", err)
	}
	chinaNow := now.In(location)
	candidate := time.Date(chinaNow.Year(), chinaNow.Month(), chinaNow.Day(), 0, 0, 0, 0, location)
	// Before 16:00, today's current-day feed is still changing. After 16:00 it
	// can be included as the latest completed day.
	if chinaNow.Hour() < 16 {
		candidate = candidate.AddDate(0, 0, -1)
	}

	found := make([]exportcsv.DailyTrades, 0, wanted)
	for checked := 0; checked < maxLookbackDays && len(found) < wanted; checked++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		date := candidate.Format("2006-01-02")
		trades, err := client.DayTrades(ctx, symbol, date)
		if err != nil {
			return nil, fmt.Errorf("下载或检查 %s 的分笔成交失败: %w", date, err)
		}
		if len(trades) > 0 {
			day := exportcsv.DailyTrades{Date: date, Trades: trades}
			found = append(found, day)
			if onFound != nil {
				onFound(day)
			}
		}
		candidate = candidate.AddDate(0, 0, -1)
	}
	if len(found) == 0 {
		return nil, fmt.Errorf("最近 %d 天没有查到 %s 的通达信历史分笔，请检查股票代码或服务器状态", maxLookbackDays, symbol)
	}
	if len(found) < wanted {
		return nil, fmt.Errorf("通达信服务器在最近 %d 天只返回了 %d 个交易日的数据，无法完整导出 %d 个交易日", maxLookbackDays, len(found), wanted)
	}
	return found, nil
}
