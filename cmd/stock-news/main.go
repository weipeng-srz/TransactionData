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

	"github.com/weipeng-srz/TransactionData/internal/news"
	"github.com/weipeng-srz/TransactionData/internal/stock"
)

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
	flags := flag.NewFlagSet("stock-news", flag.ContinueOnError)
	flags.SetOutput(stdout)
	code := flags.String("code", "", "股票代码，如 600000、sz000001 或 000001.SZ")
	name := flags.String("name", "", "证券简称（可选；行情接口不可用时可手工指定）")
	output := flags.String("output", "news.csv", "CSV 输出路径")
	limit := flags.Int("limit", 20, "每个检索入口最多读取的新闻数")
	timeout := flags.Duration("timeout", 12*time.Second, "单次网络操作超时")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "用法：stock-news [选项] [股票代码]")
		fmt.Fprintln(flags.Output(), "\n从东方财富、新浪搜索和中国新闻网检索股票相关新闻，去重并进行基础情绪分析。")
		fmt.Fprintln(flags.Output(), "\n选项：")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("只能输入一个股票代码")
	}
	if *limit < 1 || *limit > 100 {
		return fmt.Errorf("limit 必须在 1 到 100 之间")
	}
	if *timeout <= 0 {
		return fmt.Errorf("timeout 必须大于 0")
	}
	if *code == "" && flags.NArg() == 1 {
		*code = flags.Arg(0)
	}
	if *code == "" {
		fmt.Fprint(stdout, "请输入股票代码（如 600000、000001.SZ）：")
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
	client := news.NewClient(*timeout)
	companyName := strings.TrimSpace(*name)
	if companyName == "" {
		fmt.Fprintf(stdout, "正在查询 %s 的证券简称...\n", stock.DisplayCode(symbol))
		companyName, err = client.ResolveCompanyName(ctx, symbol)
		if err != nil {
			fmt.Fprintf(stderr, "警告：%v；将使用股票代码检索，建议用 -name 指定证券简称以提高准确率。\n", err)
		}
	}
	if companyName != "" {
		fmt.Fprintf(stdout, "检索对象：%s（%s）\n", companyName, stock.DisplayCode(symbol))
	} else {
		fmt.Fprintf(stdout, "检索对象：%s\n", stock.DisplayCode(symbol))
	}
	fmt.Fprintln(stdout, "正在并行检索东方财富、新浪搜索和中国新闻网...")
	articles, warnings, err := client.Search(ctx, symbol, companyName, *limit)
	for _, warning := range warnings {
		fmt.Fprintln(stderr, "警告："+warning.Error())
	}
	if err != nil {
		return err
	}
	if err := news.WriteCSV(*output, articles, now); err != nil {
		return err
	}

	positive, neutral, negative := 0, 0, 0
	for _, article := range articles {
		switch article.Sentiment {
		case "正面":
			positive++
		case "负面":
			negative++
		default:
			neutral++
		}
	}
	absOutput, pathErr := filepath.Abs(*output)
	if pathErr != nil {
		absOutput = *output
	}
	fmt.Fprintf(stdout, "完成：共保存 %d 条相关新闻（正面 %d / 中性 %d / 负面 %d）到 %s\n", len(articles), positive, neutral, negative, absOutput)
	return nil
}
