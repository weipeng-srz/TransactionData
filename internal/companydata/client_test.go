package companydata

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDailyInfosMapsFactorAndShareCapitalByEffectiveDate(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sina/sz000001/qfq.js", func(writer http.ResponseWriter, request *http.Request) {
		if got := request.URL.Query().Get("d"); got != "2026-07-10" {
			t.Fatalf("qfq date = %q", got)
		}
		fmt.Fprint(writer, `var sz000001qfq={"data":[{"d":"2026-07-08","f":"1.0000000000"},{"d":"2026-06-01","f":"1.0125000000"},{"d":"1900-01-01","f":"9.0000000000"}]}`)
	})
	mux.HandleFunc("/eastmoney", func(writer http.ResponseWriter, request *http.Request) {
		if got := request.URL.Query().Get("filter"); got != `(SECUCODE="000001.SZ")` {
			t.Fatalf("filter = %q", got)
		}
		if got := request.URL.Query().Get("columns"); got != "SECUCODE,SECURITY_NAME_ABBR,END_DATE,LISTED_A_SHARES" {
			t.Fatalf("columns = %q", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"success":true,"result":{"data":[{"SECURITY_NAME_ABBR":"平安银行","END_DATE":"2026-07-09 00:00:00","LISTED_A_SHARES":2000000000},{"SECURITY_NAME_ABBR":"平安银行","END_DATE":"2026-05-01 00:00:00","LISTED_A_SHARES":1900000000}]}}`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewClientWithEndpoints(2*time.Second, server.URL+"/sina", server.URL+"/eastmoney")
	infos, err := client.DailyInfos(context.Background(), "sz000001", []string{"2026-07-10", "2026-07-07"})
	if err != nil {
		t.Fatal(err)
	}
	if got := infos["2026-07-10"]; got.ForwardAdjustmentFactor != 1 || got.ListedAShares != 2_000_000_000 || got.ShareCapitalDate != "2026-07-09" || got.SecurityName != "平安银行" {
		t.Fatalf("2026-07-10 info = %#v", got)
	}
	if got := infos["2026-07-07"]; got.ForwardAdjustmentFactor != 1.0125 || got.ListedAShares != 1_900_000_000 || got.ShareCapitalDate != "2026-05-01" {
		t.Fatalf("2026-07-07 info = %#v", got)
	}
}

func TestDailyInfosRejectsMissingCoverage(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sina/sz000001/qfq.js", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `var x={"data":[{"d":"2026-01-01","f":"1"}]}`)
	})
	mux.HandleFunc("/eastmoney", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"success":true,"result":{"data":[{"END_DATE":"2026-07-01 00:00:00","LISTED_A_SHARES":100}]}}`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewClientWithEndpoints(time.Second, server.URL+"/sina", server.URL+"/eastmoney")
	if _, err := client.DailyInfos(context.Background(), "sz000001", []string{"2025-12-31"}); err == nil {
		t.Fatal("DailyInfos() expected missing factor coverage error")
	}
}
