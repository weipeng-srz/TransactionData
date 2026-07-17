package stock

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	prefixFirstPattern = regexp.MustCompile(`(?i)^(sh|sz|bj)[.]?([0-9]{6})$`)
	prefixLastPattern  = regexp.MustCompile(`(?i)^([0-9]{6})[.](sh|sz|bj)$`)
	barePattern        = regexp.MustCompile(`^[0-9]{6}$`)
)

// NormalizeSymbol converts common A-share symbol formats to the format used by
// Sina, for example 600000 -> sh600000 and 000001.SZ -> sz000001.
func NormalizeSymbol(input string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(input))
	value = strings.ReplaceAll(value, " ", "")
	if value == "" {
		return "", fmt.Errorf("股票代码不能为空")
	}

	if matches := prefixFirstPattern.FindStringSubmatch(value); matches != nil {
		return matches[1] + matches[2], nil
	}
	if matches := prefixLastPattern.FindStringSubmatch(value); matches != nil {
		return matches[2] + matches[1], nil
	}
	if !barePattern.MatchString(value) {
		return "", fmt.Errorf("无效的股票代码 %q：请输入 6 位代码，或使用 sh600000、000001.SZ 等格式", input)
	}

	market, err := inferMarket(value)
	if err != nil {
		return "", err
	}
	return market + value, nil
}

func inferMarket(code string) (string, error) {
	switch {
	case strings.HasPrefix(code, "92"), strings.HasPrefix(code, "4"), strings.HasPrefix(code, "8"):
		return "bj", nil
	case strings.HasPrefix(code, "5"), strings.HasPrefix(code, "6"), strings.HasPrefix(code, "9"):
		return "sh", nil
	case strings.HasPrefix(code, "0"), strings.HasPrefix(code, "1"), strings.HasPrefix(code, "2"), strings.HasPrefix(code, "3"):
		return "sz", nil
	default:
		return "", fmt.Errorf("无法根据代码 %q 判断交易所，请显式输入 sh、sz 或 bj 前缀", code)
	}
}

// DisplayCode returns the six-digit security code without the market prefix.
func DisplayCode(symbol string) string {
	if len(symbol) > 2 {
		return symbol[2:]
	}
	return symbol
}
