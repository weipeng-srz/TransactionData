// Package companydata fetches daily adjustment factors and historical share
// capital metadata used to enrich the transaction CSV.
package companydata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	defaultSinaBaseURL     = "https://finance.sina.com.cn/realstock/company"
	defaultEastMoneyAPIURL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
	maxResponseBytes       = 4 << 20
)

// DailyInfo contains values that are effective for one trading date.
type DailyInfo struct {
	// ForwardAdjustmentFactor follows Sina's qfq factor convention:
	// forward-adjusted price = unadjusted price / factor.
	ForwardAdjustmentFactor float64
	ListedAShares           int64
	ShareCapitalDate        string
	SecurityName            string
}

type Client struct {
	httpClient      *http.Client
	sinaBaseURL     string
	eastMoneyAPIURL string
}

func NewClient(timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	return &Client{
		httpClient:      &http.Client{Timeout: timeout},
		sinaBaseURL:     defaultSinaBaseURL,
		eastMoneyAPIURL: defaultEastMoneyAPIURL,
	}
}

// NewClientWithEndpoints is useful for deterministic tests and compatible
// private mirrors.
func NewClientWithEndpoints(timeout time.Duration, sinaBaseURL, eastMoneyAPIURL string) *Client {
	client := NewClient(timeout)
	client.sinaBaseURL = strings.TrimRight(sinaBaseURL, "/")
	client.eastMoneyAPIURL = eastMoneyAPIURL
	return client
}

// DailyInfos maps each requested trading date to the applicable forward
// adjustment factor and historical listed A-share capital.
func (c *Client) DailyInfos(ctx context.Context, symbol string, dates []string) (map[string]DailyInfo, error) {
	requested, err := normalizedDates(dates)
	if err != nil {
		return nil, err
	}
	if len(requested) == 0 {
		return map[string]DailyInfo{}, nil
	}

	factors, err := c.fetchForwardFactors(ctx, symbol, requested[len(requested)-1])
	if err != nil {
		return nil, err
	}
	capital, securityName, err := c.fetchShareCapital(ctx, symbol)
	if err != nil {
		return nil, err
	}

	result := make(map[string]DailyInfo, len(requested))
	for _, date := range requested {
		factor, ok := factorForDate(factors, date)
		if !ok {
			return nil, fmt.Errorf("新浪复权因子没有覆盖交易日 %s", date)
		}
		shares, effectiveDate, ok := shareCapitalForDate(capital, date)
		if !ok {
			return nil, fmt.Errorf("东方财富股本结构没有覆盖交易日 %s", date)
		}
		result[date] = DailyInfo{
			ForwardAdjustmentFactor: factor,
			ListedAShares:           shares,
			ShareCapitalDate:        effectiveDate,
			SecurityName:            securityName,
		}
	}
	return result, nil
}

type factorEvent struct {
	Date   string
	Factor float64
}

func (c *Client) fetchForwardFactors(ctx context.Context, symbol, latestDate string) ([]factorEvent, error) {
	if !validSymbol(symbol) {
		return nil, fmt.Errorf("复权因子不支持股票代码 %q", symbol)
	}
	endpoint := fmt.Sprintf("%s/%s/qfq.js?d=%s", c.sinaBaseURL, symbol, url.QueryEscape(latestDate))
	body, err := c.get(ctx, endpoint, "https://finance.sina.com.cn/")
	if err != nil {
		return nil, fmt.Errorf("获取新浪前复权因子失败: %w", err)
	}
	start := strings.IndexByte(string(body), '{')
	end := strings.LastIndexByte(string(body), '}')
	if start < 0 || end <= start {
		return nil, fmt.Errorf("解析新浪前复权因子失败: 响应不是预期的 JSONP")
	}
	var payload struct {
		Data []struct {
			Date   string `json:"d"`
			Factor string `json:"f"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body[start:end+1], &payload); err != nil {
		return nil, fmt.Errorf("解析新浪前复权因子失败: %w", err)
	}
	events := make([]factorEvent, 0, len(payload.Data))
	for _, item := range payload.Data {
		if !validDate(item.Date) {
			continue
		}
		factor, err := strconv.ParseFloat(item.Factor, 64)
		if err != nil || factor <= 0 || math.IsNaN(factor) || math.IsInf(factor, 0) {
			continue
		}
		events = append(events, factorEvent{Date: item.Date, Factor: factor})
	}
	if len(events) == 0 {
		return nil, fmt.Errorf("新浪没有返回可用的前复权因子")
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Date > events[j].Date })
	return events, nil
}

type shareCapitalEvent struct {
	Date          string
	ListedAShares int64
}

func (c *Client) fetchShareCapital(ctx context.Context, symbol string) ([]shareCapitalEvent, string, error) {
	secuCode, err := eastMoneySecuCode(symbol)
	if err != nil {
		return nil, "", err
	}
	values := url.Values{}
	values.Set("reportName", "RPT_F10_EH_EQUITY")
	values.Set("columns", "SECUCODE,SECURITY_NAME_ABBR,END_DATE,LISTED_A_SHARES")
	values.Set("filter", fmt.Sprintf("(SECUCODE=\"%s\")", secuCode))
	values.Set("pageNumber", "1")
	values.Set("pageSize", "500")
	body, err := c.get(ctx, c.eastMoneyAPIURL+"?"+values.Encode(), "https://data.eastmoney.com/")
	if err != nil {
		return nil, "", fmt.Errorf("获取东方财富股本结构失败: %w", err)
	}
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Result  *struct {
			Data []struct {
				SecurityName  string   `json:"SECURITY_NAME_ABBR"`
				EndDate       string   `json:"END_DATE"`
				ListedAShares *float64 `json:"LISTED_A_SHARES"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "", fmt.Errorf("解析东方财富股本结构失败: %w", err)
	}
	if !payload.Success || payload.Result == nil {
		if payload.Message == "" {
			payload.Message = "接口没有返回结果"
		}
		return nil, "", fmt.Errorf("东方财富股本结构接口返回失败: %s", payload.Message)
	}
	events := make([]shareCapitalEvent, 0, len(payload.Result.Data))
	securityName := ""
	for _, item := range payload.Result.Data {
		if securityName == "" {
			securityName = strings.TrimSpace(item.SecurityName)
		}
		date := datePart(item.EndDate)
		if !validDate(date) || item.ListedAShares == nil || *item.ListedAShares <= 0 {
			continue
		}
		shares := int64(math.Round(*item.ListedAShares))
		events = append(events, shareCapitalEvent{Date: date, ListedAShares: shares})
	}
	if len(events) == 0 {
		return nil, "", fmt.Errorf("东方财富没有返回可用的流通A股本")
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Date > events[j].Date })
	return events, securityName, nil
}

func (c *Client) get(ctx context.Context, endpoint, referer string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (compatible; stock-ticks/1.0)")
	request.Header.Set("Accept", "application/json,text/javascript,*/*;q=0.8")
	request.Header.Set("Referer", referer)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("响应超过 %d 字节安全上限", maxResponseBytes)
	}
	return body, nil
}

func normalizedDates(dates []string) ([]string, error) {
	set := make(map[string]struct{}, len(dates))
	for _, date := range dates {
		if !validDate(date) {
			return nil, fmt.Errorf("无效的交易日期 %q", date)
		}
		set[date] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for date := range set {
		result = append(result, date)
	}
	sort.Strings(result)
	return result, nil
}

func factorForDate(events []factorEvent, date string) (float64, bool) {
	for _, event := range events {
		if event.Date <= date {
			return event.Factor, true
		}
	}
	return 0, false
}

func shareCapitalForDate(events []shareCapitalEvent, date string) (int64, string, bool) {
	for _, event := range events {
		if event.Date <= date {
			return event.ListedAShares, event.Date, true
		}
	}
	return 0, "", false
}

func eastMoneySecuCode(symbol string) (string, error) {
	if !validSymbol(symbol) {
		return "", fmt.Errorf("股本结构不支持股票代码 %q", symbol)
	}
	return symbol[2:] + "." + strings.ToUpper(symbol[:2]), nil
}

func validSymbol(symbol string) bool {
	if len(symbol) != 8 || (symbol[:2] != "sh" && symbol[:2] != "sz") {
		return false
	}
	for _, character := range symbol[2:] {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func validDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func datePart(value string) string {
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}
