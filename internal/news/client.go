package news

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"stockticks/internal/stock"
)

const (
	defaultProfileURL   = "https://push2.eastmoney.com/api/qt/stock/get"
	defaultSuggestURL   = "https://searchapi.eastmoney.com/api/suggest/get"
	defaultEastMoneyURL = "https://search-api-web.eastmoney.com/search/jsonp"
	defaultSinaURL      = "https://search.sina.com.cn/api/news"
	defaultChinaNewsURL = "https://sou.chinanews.com.cn/search.do"
	maxResponseBytes    = 8 << 20
)

var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

// Client accesses the public search pages used by the standalone collector.
type Client struct {
	httpClient   *http.Client
	profileURL   string
	suggestURL   string
	eastMoneyURL string
	sinaURL      string
	chinaNewsURL string
}

func NewClient(timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	return &Client{
		httpClient:   &http.Client{Timeout: timeout},
		profileURL:   defaultProfileURL,
		suggestURL:   defaultSuggestURL,
		eastMoneyURL: defaultEastMoneyURL,
		sinaURL:      defaultSinaURL,
		chinaNewsURL: defaultChinaNewsURL,
	}
}

// NewClientWithEndpoints provides deterministic endpoints for tests and
// compatible private mirrors.
func NewClientWithEndpoints(timeout time.Duration, profileURL, eastMoneyURL, sinaURL, chinaNewsURL string) *Client {
	client := NewClient(timeout)
	client.profileURL = profileURL
	client.suggestURL = profileURL
	client.eastMoneyURL = eastMoneyURL
	client.sinaURL = sinaURL
	client.chinaNewsURL = chinaNewsURL
	return client
}

// ResolveCompanyName resolves the security abbreviation used as the primary
// search term. Searching by name avoids treating share counts such as 600000
// as matches for stock 600000.
func (c *Client) ResolveCompanyName(ctx context.Context, symbol string) (string, error) {
	name, profileErr := c.resolveCompanyNameFromProfile(ctx, symbol)
	if profileErr == nil {
		return name, nil
	}
	name, suggestErr := c.resolveCompanyNameFromSuggest(ctx, symbol)
	if suggestErr == nil {
		return name, nil
	}
	return "", fmt.Errorf("查询证券简称失败: %w", errors.Join(profileErr, suggestErr))
}

func (c *Client) resolveCompanyNameFromProfile(ctx context.Context, symbol string) (string, error) {
	marketID := "0"
	if strings.HasPrefix(symbol, "sh") {
		marketID = "1"
	}
	values := url.Values{}
	values.Set("secid", marketID+"."+stock.DisplayCode(symbol))
	values.Set("fields", "f57,f58")
	body, err := c.get(ctx, addQuery(c.profileURL, values), "https://quote.eastmoney.com/")
	if err != nil {
		return "", err
	}
	var payload struct {
		RC   int `json:"rc"`
		Data *struct {
			Code string `json:"f57"`
			Name string `json:"f58"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("解析证券简称失败: %w", err)
	}
	if payload.RC != 0 || payload.Data == nil || strings.TrimSpace(payload.Data.Name) == "" {
		return "", fmt.Errorf("行情接口没有返回 %s 的证券简称", stock.DisplayCode(symbol))
	}
	if payload.Data.Code != "" && payload.Data.Code != stock.DisplayCode(symbol) {
		return "", fmt.Errorf("行情接口返回了不匹配的证券代码 %s", payload.Data.Code)
	}
	return cleanText(payload.Data.Name), nil
}

func (c *Client) resolveCompanyNameFromSuggest(ctx context.Context, symbol string) (string, error) {
	values := url.Values{}
	values.Set("input", stock.DisplayCode(symbol))
	values.Set("type", "14")
	values.Set("count", "10")
	body, err := c.get(ctx, addQuery(c.suggestURL, values), "https://so.eastmoney.com/")
	if err != nil {
		return "", err
	}
	var payload struct {
		Table struct {
			Status  int    `json:"Status"`
			Message string `json:"Message"`
			Data    []struct {
				Code     string `json:"Code"`
				Name     string `json:"Name"`
				QuoteID  string `json:"QuoteID"`
				Classify string `json:"Classify"`
			} `json:"Data"`
		} `json:"QuotationCodeTable"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("解析证券搜索建议失败: %w", err)
	}
	if payload.Table.Status != 0 {
		return "", fmt.Errorf("证券搜索建议接口返回失败: %s", payload.Table.Message)
	}
	marketID := "0"
	if strings.HasPrefix(symbol, "sh") {
		marketID = "1"
	}
	expectedQuoteID := marketID + "." + stock.DisplayCode(symbol)
	for _, item := range payload.Table.Data {
		if item.Code != stock.DisplayCode(symbol) || (item.QuoteID != "" && item.QuoteID != expectedQuoteID) {
			continue
		}
		name := cleanText(item.Name)
		if name != "" {
			return name, nil
		}
	}
	return "", fmt.Errorf("证券搜索建议没有返回 %s 的简称", stock.DisplayCode(symbol))
}

type sourceResult struct {
	name     string
	articles []Article
	err      error
}

// Search concurrently queries finance, stock, and general-news portals. A
// failure from one portal is returned as a warning as long as another portal
// completed successfully.
func (c *Client) Search(ctx context.Context, symbol, companyName string, perSourceLimit int) ([]Article, []error, error) {
	if perSourceLimit < 1 {
		return nil, nil, fmt.Errorf("每个来源的结果上限必须大于 0")
	}
	if perSourceLimit > 100 {
		perSourceLimit = 100
	}
	query := strings.TrimSpace(companyName)
	if query == "" {
		query = stock.DisplayCode(symbol) + " 股票"
	}

	sources := []struct {
		name string
		fn   func(context.Context, string, int) ([]Article, error)
	}{
		{name: "东方财富", fn: c.searchEastMoney},
		{name: "新浪搜索", fn: c.searchSina},
		{name: "中国新闻网", fn: c.searchChinaNews},
	}
	results := make(chan sourceResult, len(sources))
	for _, source := range sources {
		source := source
		go func() {
			articles, err := source.fn(ctx, query, perSourceLimit)
			results <- sourceResult{name: source.name, articles: articles, err: err}
		}()
	}

	warnings := make([]error, 0)
	collected := make([]Article, 0, len(sources)*perSourceLimit)
	successes := 0
	for range sources {
		result := <-results
		if result.err != nil {
			warnings = append(warnings, fmt.Errorf("%s检索失败: %w", result.name, result.err))
			continue
		}
		successes++
		collected = append(collected, result.articles...)
	}
	if err := ctx.Err(); err != nil {
		return nil, warnings, err
	}
	if successes == 0 {
		return nil, warnings, fmt.Errorf("所有新闻来源均检索失败: %w", errors.Join(warnings...))
	}

	code := stock.DisplayCode(symbol)
	filtered := make([]Article, 0, len(collected))
	for _, article := range collected {
		relevance := relevanceScore(article, code, companyName)
		if relevance == 0 {
			continue
		}
		article.Symbol = code
		article.CompanyName = companyName
		article.Relevance = relevance
		sentiment := analyzeSentiment(article.Title, article.Summary)
		article.Sentiment = sentiment.Label
		article.SentimentScore = sentiment.Score
		article.PositiveTerms = sentiment.PositiveTerms
		article.NegativeTerms = sentiment.NegativeTerms
		filtered = append(filtered, article)
	}
	filtered = deduplicate(filtered)
	sort.SliceStable(filtered, func(i, j int) bool {
		if filtered[i].PublishedAt.Equal(filtered[j].PublishedAt) {
			return filtered[i].Relevance > filtered[j].Relevance
		}
		if filtered[i].PublishedAt.IsZero() {
			return false
		}
		if filtered[j].PublishedAt.IsZero() {
			return true
		}
		return filtered[i].PublishedAt.After(filtered[j].PublishedAt)
	})
	return filtered, warnings, nil
}

func (c *Client) searchEastMoney(ctx context.Context, query string, limit int) ([]Article, error) {
	params := map[string]any{
		"uid":           "",
		"keyword":       query,
		"type":          []string{"cmsArticleWebOld"},
		"client":        "web",
		"clientType":    "web",
		"clientVersion": "curr",
		"param": map[string]any{
			"cmsArticleWebOld": map[string]any{
				"searchScope": "default",
				"sort":        "default",
				"pageIndex":   1,
				"pageSize":    limit,
				"preTag":      "",
				"postTag":     "",
			},
		},
	}
	encoded, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	values := url.Values{}
	values.Set("cb", "stockNews")
	values.Set("param", string(encoded))
	body, err := c.get(ctx, addQuery(c.eastMoneyURL, values), "https://so.eastmoney.com/")
	if err != nil {
		return nil, err
	}
	start := bytes.IndexByte(body, '{')
	end := bytes.LastIndexByte(body, '}')
	if start < 0 || end <= start {
		return nil, fmt.Errorf("响应不是预期的 JSONP")
	}
	var payload struct {
		Code   int    `json:"code"`
		Msg    string `json:"msg"`
		Result struct {
			Items []struct {
				Date    string `json:"date"`
				Title   string `json:"title"`
				Content string `json:"content"`
				Media   string `json:"mediaName"`
				URL     string `json:"url"`
			} `json:"cmsArticleWebOld"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body[start:end+1], &payload); err != nil {
		return nil, fmt.Errorf("解析 JSONP 失败: %w", err)
	}
	if payload.Code != 0 {
		return nil, fmt.Errorf("接口返回失败: %s", payload.Msg)
	}
	articles := make([]Article, 0, min(limit, len(payload.Result.Items)))
	for _, item := range payload.Result.Items {
		article := Article{
			Portal:      "东方财富",
			Channel:     "财经/股票",
			Media:       cleanText(item.Media),
			PublishedAt: parseChinaTime(item.Date),
			Title:       cleanText(item.Title),
			Summary:     cleanText(item.Content),
			URL:         normalizeURL(item.URL),
		}
		if article.Title == "" || article.URL == "" {
			continue
		}
		articles = append(articles, article)
		if len(articles) == limit {
			break
		}
	}
	return articles, nil
}

func (c *Client) searchSina(ctx context.Context, query string, limit int) ([]Article, error) {
	values := url.Values{}
	values.Set("q", query)
	body, err := c.get(ctx, addQuery(c.sinaURL, values), "https://search.sina.com.cn/")
	if err != nil {
		return nil, err
	}
	var payload struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			List []struct {
				CTime         int64  `json:"ctime"`
				DataTime      string `json:"dataTime"`
				Title         string `json:"title"`
				Intro         string `json:"intro"`
				SearchSummary string `json:"searchSummary"`
				Media         string `json:"media_show"`
				URL           string `json:"url"`
			} `json:"list"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析 JSON 失败: %w", err)
	}
	if payload.Code != 0 {
		return nil, fmt.Errorf("接口返回失败: %s", payload.Message)
	}
	articles := make([]Article, 0, min(limit, len(payload.Data.List)))
	for _, item := range payload.Data.List {
		summary := item.SearchSummary
		if strings.TrimSpace(summary) == "" {
			summary = item.Intro
		}
		publishedAt := time.Time{}
		if item.CTime > 0 {
			publishedAt = time.Unix(item.CTime, 0).In(chinaLocation())
		} else {
			publishedAt = parseChinaTime(item.DataTime)
		}
		article := Article{
			Portal:      "新浪搜索",
			Channel:     "新闻/财经",
			Media:       cleanText(item.Media),
			PublishedAt: publishedAt,
			Title:       cleanText(item.Title),
			Summary:     cleanText(summary),
			URL:         normalizeURL(item.URL),
		}
		if article.Title == "" || article.URL == "" {
			continue
		}
		articles = append(articles, article)
		if len(articles) == limit {
			break
		}
	}
	return articles, nil
}

func (c *Client) searchChinaNews(ctx context.Context, query string, limit int) ([]Article, error) {
	values := url.Values{}
	values.Set("q", query)
	body, err := c.get(ctx, addQuery(c.chinaNewsURL, values), "https://sou.chinanews.com.cn/")
	if err != nil {
		return nil, err
	}
	prefix := []byte("var docArr = ")
	start := bytes.Index(body, prefix)
	if start < 0 {
		return nil, fmt.Errorf("页面中没有找到新闻结果数据")
	}
	var items []struct {
		Content flexibleText `json:"content_without_tag"`
		Channel string       `json:"primary_channel"`
		PubTime string       `json:"pubtime"`
		Title   flexibleText `json:"title"`
		URL     string       `json:"url"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body[start+len(prefix):]))
	if err := decoder.Decode(&items); err != nil {
		return nil, fmt.Errorf("解析页面新闻数据失败: %w", err)
	}
	articles := make([]Article, 0, min(limit, len(items)))
	for _, item := range items {
		article := Article{
			Portal:      "中国新闻网",
			Channel:     chinaNewsChannel(item.Channel),
			Media:       "中国新闻网",
			PublishedAt: parseChinaTime(item.PubTime),
			Title:       cleanText(string(item.Title)),
			Summary:     cleanText(string(item.Content)),
			URL:         normalizeURL(item.URL),
		}
		if article.Title == "" || article.URL == "" {
			continue
		}
		articles = append(articles, article)
		if len(articles) == limit {
			break
		}
	}
	return articles, nil
}

type flexibleText string

func (value *flexibleText) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*value = flexibleText(single)
		return nil
	}
	var list []string
	if err := json.Unmarshal(data, &list); err == nil {
		*value = flexibleText(strings.Join(list, " "))
		return nil
	}
	// Search pages occasionally use an unexpected shape for highlighted
	// fields. Ignore that one field instead of discarding the entire portal.
	*value = ""
	return nil
}

func (c *Client) get(ctx context.Context, endpoint, referer string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (compatible; stock-news/1.0; +local-research-tool)")
	request.Header.Set("Accept", "application/json,text/html,application/xhtml+xml,*/*;q=0.8")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
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

func addQuery(endpoint string, values url.Values) string {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	query := parsed.Query()
	for key, items := range values {
		for _, item := range items {
			query.Set(key, item)
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func cleanText(value string) string {
	value = htmlTagPattern.ReplaceAllString(value, "")
	value = html.UnescapeString(value)
	return strings.Join(strings.Fields(value), " ")
}

func normalizeURL(value string) string {
	value = strings.TrimSpace(html.UnescapeString(value))
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	parsed.Fragment = ""
	return parsed.String()
}

func parseChinaTime(value string) time.Time {
	value = strings.TrimSpace(value)
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02"} {
		parsed, err := time.ParseInLocation(layout, value, chinaLocation())
		if err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func chinaLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*60*60)
	}
	return location
}

func chinaNewsChannel(code string) string {
	switch code {
	case "cj":
		return "财经"
	case "gn":
		return "国内"
	case "gj":
		return "国际"
	case "sh":
		return "社会"
	case "stock":
		return "股票"
	default:
		if code == "" {
			return "新闻"
		}
		return "新闻/" + code
	}
}

func relevanceScore(article Article, code, companyName string) float64 {
	title := foldForMatch(article.Title)
	summary := foldForMatch(article.Summary)
	name := foldForMatch(companyName)
	if name != "" {
		if strings.Contains(title, name) {
			return 1
		}
		if strings.Contains(summary, name) {
			return 0.85
		}
		return 0
	}

	rawTitle := strings.ToLower(article.Title)
	rawSummary := strings.ToLower(article.Summary)
	patterns := []string{code + ".sh", code + ".sz", code + ".bj", "sh" + code, "sz" + code, "bj" + code, "(" + code + ")", "（" + code + "）"}
	for _, pattern := range patterns {
		if strings.Contains(rawTitle, pattern) {
			return 0.95
		}
		if strings.Contains(rawSummary, pattern) {
			return 0.8
		}
	}
	if strings.Contains(rawTitle, code) && containsAny(rawTitle, "股票", "证券", "股份", "公司") {
		return 0.7
	}
	return 0
}

func foldForMatch(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, cleanText(value))
}

func containsAny(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, candidate) {
			return true
		}
	}
	return false
}

func deduplicate(articles []Article) []Article {
	byKey := make(map[string]int, len(articles))
	result := make([]Article, 0, len(articles))
	for _, article := range articles {
		key := foldForMatch(article.Title)
		if key == "" {
			key = article.URL
		}
		index, exists := byKey[key]
		if !exists {
			byKey[key] = len(result)
			result = append(result, article)
			continue
		}
		existing := result[index]
		portals := joinUnique(existing.Portal, article.Portal)
		channels := joinUnique(existing.Channel, article.Channel)
		if len([]rune(article.Summary)) > len([]rune(existing.Summary)) {
			existing = article
		}
		existing.Portal = portals
		existing.Channel = channels
		result[index] = existing
	}
	return result
}

func joinUnique(left, right string) string {
	if left == "" {
		return right
	}
	if right == "" || left == right || strings.Contains("；"+left+"；", "；"+right+"；") {
		return left
	}
	return left + "；" + right
}
