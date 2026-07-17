package news

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientResolvesSearchesFiltersAndDeduplicates(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/profile", func(writer http.ResponseWriter, request *http.Request) {
		if got := request.URL.Query().Get("secid"); got != "1.600000" {
			t.Fatalf("secid = %q", got)
		}
		fmt.Fprint(writer, `{"rc":0,"data":{"f57":"600000","f58":"浦发银行"}}`)
	})
	mux.HandleFunc("/eastmoney", func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("param") == "" {
			t.Fatal("missing EastMoney param")
		}
		fmt.Fprint(writer, `stockNews({"code":0,"msg":"OK","result":{"cmsArticleWebOld":[
			{"date":"2026-07-16 09:00:00","title":"<em>浦发银行</em>业绩增长","content":"浦发银行盈利增长","mediaName":"上海证券报","url":"http://example.com/growth"},
			{"date":"2026-07-16 08:00:00","title":"某公司减持600000股","content":"与银行无关","mediaName":"证券日报","url":"http://example.com/irrelevant"}
		]}})`)
	})
	mux.HandleFunc("/sina", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"code":0,"message":"success","data":{"list":[
			{"ctime":1784163600,"title":"浦发银行业绩增长","searchSummary":"浦发银行盈利大幅增长并实现突破","media_show":"财经资讯","url":"https://example.com/growth"},
			{"ctime":1784160000,"title":"浦发银行收到警示函","intro":"浦发银行因违规被处罚","media_show":"市场资讯","url":"https://example.com/warning"}
		]}}`)
	})
	mux.HandleFunc("/chinanews", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `<html><script>var docArr = [{"content_without_tag":"浦发银行参加金融论坛","primary_channel":"cj","pubtime":"2026-07-15 10:00:00","title":["金融论坛在沪举行"],"url":"http://www.chinanews.com.cn/cj/test.shtml"}];</script></html>`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewClientWithEndpoints(time.Second, server.URL+"/profile", server.URL+"/eastmoney", server.URL+"/sina", server.URL+"/chinanews")
	name, err := client.ResolveCompanyName(context.Background(), "sh600000")
	if err != nil {
		t.Fatal(err)
	}
	if name != "浦发银行" {
		t.Fatalf("name = %q", name)
	}

	articles, warnings, err := client.Search(context.Background(), "sh600000", name, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %v", warnings)
	}
	if len(articles) != 3 {
		t.Fatalf("len(articles) = %d, want 3: %#v", len(articles), articles)
	}

	byTitle := make(map[string]Article, len(articles))
	for _, article := range articles {
		byTitle[article.Title] = article
		if article.Symbol != "600000" || article.CompanyName != "浦发银行" {
			t.Fatalf("article identity = %#v", article)
		}
		if strings.Contains(article.Title, "某公司") {
			t.Fatalf("irrelevant result was not filtered: %#v", article)
		}
	}
	growth := byTitle["浦发银行业绩增长"]
	if !strings.Contains(growth.Portal, "东方财富") || !strings.Contains(growth.Portal, "新浪搜索") {
		t.Fatalf("deduplicated portals = %q", growth.Portal)
	}
	if growth.Sentiment != "正面" || growth.SentimentScore <= 0 {
		t.Fatalf("growth sentiment = %#v", growth)
	}
	warning := byTitle["浦发银行收到警示函"]
	if warning.Sentiment != "负面" || warning.SentimentScore >= 0 {
		t.Fatalf("warning sentiment = %#v", warning)
	}
	forum := byTitle["金融论坛在沪举行"]
	if forum.Relevance != 0.85 || forum.Sentiment != "中性" {
		t.Fatalf("forum result = %#v", forum)
	}
}

func TestResolveCompanyNameFallsBackToSuggestion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("input") == "600000" {
			fmt.Fprint(writer, `{"QuotationCodeTable":{"Data":[{"Code":"600000","Name":"浦发银行","QuoteID":"1.600000","Classify":"AStock"}],"Status":0,"Message":"成功"}}`)
			return
		}
		fmt.Fprint(writer, `{"rc":-1,"data":null}`)
	}))
	defer server.Close()
	client := NewClientWithEndpoints(time.Second, server.URL, server.URL, server.URL, server.URL)
	name, err := client.ResolveCompanyName(context.Background(), "sh600000")
	if err != nil {
		t.Fatal(err)
	}
	if name != "浦发银行" {
		t.Fatalf("name = %q", name)
	}
}

func TestSearchToleratesOneFailedPortal(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/eastmoney", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `stockNews({"code":0,"result":{"cmsArticleWebOld":[]}})`)
	})
	mux.HandleFunc("/sina", func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "temporarily unavailable", http.StatusServiceUnavailable)
	})
	mux.HandleFunc("/chinanews", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `<script>var docArr = [];</script>`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewClientWithEndpoints(time.Second, server.URL+"/profile", server.URL+"/eastmoney", server.URL+"/sina", server.URL+"/chinanews")
	articles, warnings, err := client.Search(context.Background(), "sh600000", "浦发银行", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(articles) != 0 || len(warnings) != 1 || !strings.Contains(warnings[0].Error(), "新浪") {
		t.Fatalf("articles=%#v warnings=%v", articles, warnings)
	}
}

func TestSearchFailsWhenAllPortalsFail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	client := NewClientWithEndpoints(time.Second, server.URL, server.URL, server.URL, server.URL)
	_, warnings, err := client.Search(context.Background(), "sh600000", "浦发银行", 10)
	if err == nil || len(warnings) != 3 {
		t.Fatalf("err=%v warnings=%v", err, warnings)
	}
}
