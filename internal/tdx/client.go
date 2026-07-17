// Package tdx implements the small subset of the TDX 7709 protocol needed to
// retrieve Level-1 historical transaction rows. It intentionally does not
// present these rows as exchange Level-2 orders.
package tdx

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"stockticks/internal/marketdata"
)

const (
	historyTradeCommand uint16 = 0x0FB5
	currentTradeCommand uint16 = 0x0FC5
	pageSize                   = 2000
	currentPageSize            = 900
	maxRecordsPerDay           = 64000
)

// Public quote hosts can change without notice. The client tries each host and
// keeps the first one that completes the TDX bootstrap handshake.
var defaultHosts = []string{
	"110.41.147.114:7709",
	"110.41.2.72:7709",
	"124.70.176.52:7709",
	"123.60.186.45:7709",
	"124.70.199.56:7709",
	"124.71.85.110:7709",
	"139.9.51.18:7709",
	"119.97.185.59:7709",
	"218.6.170.47:7709",
}

type Client struct {
	mu      sync.Mutex
	conn    net.Conn
	host    string
	hosts   []string
	timeout time.Duration
	seq     uint16
}

func NewClient(timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	return &Client{
		hosts:   append([]string(nil), defaultHosts...),
		timeout: timeout,
	}
}

// NewClientWithHosts is primarily useful for deterministic tests and private
// compatible quote servers.
func NewClientWithHosts(timeout time.Duration, hosts []string) *Client {
	client := NewClient(timeout)
	client.hosts = append([]string(nil), hosts...)
	return client
}

func (c *Client) Host() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.host
}

func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connectLocked(ctx)
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closeLocked()
}

// DayTrades downloads all historical transaction pages for one date. TDX
// returns the newest page first, so pages are reversed before returning.
func (c *Client) DayTrades(ctx context.Context, symbol, date string) ([]marketdata.Trade, error) {
	if strings.HasPrefix(strings.ToLower(symbol), "bj") {
		return nil, fmt.Errorf("通达信免费历史分笔暂不可靠支持北交所代码 %s", symbol)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if c.conn == nil {
			if err := c.connectLocked(ctx); err != nil {
				lastErr = err
				continue
			}
		}

		trades, err := c.dayTradesLocked(ctx, symbol, date)
		if err == nil {
			return trades, nil
		}
		lastErr = err
		_ = c.closeLocked()
	}
	return nil, fmt.Errorf("下载 %s 的通达信历史分笔失败（已重试3次）: %w", date, lastErr)
}

func (c *Client) dayTradesLocked(ctx context.Context, symbol, date string) ([]marketdata.Trade, error) {
	market, code, err := splitSymbol(symbol)
	if err != nil {
		return nil, err
	}
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return nil, err
	}
	if date == time.Now().In(location).Format("2006-01-02") {
		return c.currentDayTradesLocked(ctx, market, code, date)
	}

	pages := make([][]marketdata.Trade, 0, 4)
	total := 0
	for start := 0; start < maxRecordsPerDay; start += pageSize {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		request, err := historyTradeRequest(date, market, code, uint16(start), pageSize)
		if err != nil {
			return nil, err
		}
		if err := c.writePacketLocked(ctx, request); err != nil {
			return nil, err
		}
		packet, err := c.readPacketLocked(ctx)
		if err != nil {
			return nil, err
		}
		if packet.command != historyTradeCommand {
			return nil, fmt.Errorf("收到意外的通达信响应类型 0x%04X", packet.command)
		}
		page, err := decodeHistoryTrades(packet.body, date)
		if err != nil {
			return nil, err
		}
		if len(page) == 0 {
			break
		}
		pages = append(pages, page)
		total += len(page)
		if len(page) < pageSize {
			break
		}
	}
	if total >= maxRecordsPerDay {
		return nil, fmt.Errorf("%s 的记录数达到安全上限 %d，拒绝输出可能不完整的数据", date, maxRecordsPerDay)
	}

	all := make([]marketdata.Trade, 0, total)
	for i := len(pages) - 1; i >= 0; i-- {
		all = append(all, pages[i]...)
	}
	return all, nil
}

func (c *Client) currentDayTradesLocked(ctx context.Context, market byte, code, date string) ([]marketdata.Trade, error) {
	pages := make([][]marketdata.Trade, 0, 6)
	total := 0
	for start := 0; start < maxRecordsPerDay; start += currentPageSize {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		request := currentTradeRequest(market, code, uint16(start), currentPageSize)
		if err := c.writePacketLocked(ctx, request); err != nil {
			return nil, err
		}
		packet, err := c.readPacketLocked(ctx)
		if err != nil {
			return nil, err
		}
		if packet.command != currentTradeCommand {
			return nil, fmt.Errorf("收到意外的通达信响应类型 0x%04X", packet.command)
		}
		page, err := decodeCurrentTrades(packet.body, date)
		if err != nil {
			return nil, err
		}
		if len(page) == 0 {
			break
		}
		pages = append(pages, page)
		total += len(page)
		if len(page) < currentPageSize {
			break
		}
	}
	if total >= maxRecordsPerDay {
		return nil, fmt.Errorf("%s 的记录数达到安全上限 %d，拒绝输出可能不完整的数据", date, maxRecordsPerDay)
	}
	all := make([]marketdata.Trade, 0, total)
	for i := len(pages) - 1; i >= 0; i-- {
		all = append(all, pages[i]...)
	}
	return all, nil
}

func (c *Client) connectLocked(ctx context.Context) error {
	if c.conn != nil {
		return nil
	}
	if len(c.hosts) == 0 {
		return errors.New("没有配置通达信行情服务器")
	}

	var failures []string
	for _, host := range c.hosts {
		if err := ctx.Err(); err != nil {
			return err
		}
		dialer := net.Dialer{Timeout: c.timeout}
		conn, err := dialer.DialContext(ctx, "tcp", host)
		if err != nil {
			failures = append(failures, host+": "+err.Error())
			continue
		}
		c.conn = conn
		c.host = host
		c.seq = 0
		if err := c.bootstrapLocked(ctx); err == nil {
			return nil
		} else {
			failures = append(failures, host+": "+err.Error())
		}
		_ = c.closeLocked()
	}
	return fmt.Errorf("无法连接通达信行情服务器: %s", strings.Join(failures, "; "))
}

func (c *Client) closeLocked() error {
	if c.conn == nil {
		c.host = ""
		return nil
	}
	err := c.conn.Close()
	c.conn = nil
	c.host = ""
	return err
}

func (c *Client) bootstrapLocked(ctx context.Context) error {
	steps := []struct {
		packet  []byte
		service uint16
		command uint16
	}{
		{pingRequest(c.nextSequence()), 0x0000, 0x0015},
		{authRequest(c.nextSequence()), 0x1894, 0x000D},
		{stageRequest(c.nextSequence()), 0x1899, 0x0FDB},
	}
	for _, step := range steps {
		if err := c.writePacketLocked(ctx, step.packet); err != nil {
			return err
		}
		response, err := c.readPacketLocked(ctx)
		if err != nil {
			return err
		}
		if response.service != step.service || response.command != step.command {
			return fmt.Errorf("通达信握手响应不匹配：service=0x%04X command=0x%04X", response.service, response.command)
		}
	}
	return nil
}

func (c *Client) nextSequence() uint16 {
	sequence := c.seq
	c.seq++
	return sequence
}

func (c *Client) writePacketLocked(ctx context.Context, packet []byte) error {
	if c.conn == nil {
		return errors.New("通达信连接未建立")
	}
	if err := c.setDeadlineLocked(ctx); err != nil {
		return err
	}
	for len(packet) > 0 {
		n, err := c.conn.Write(packet)
		if err != nil {
			return fmt.Errorf("写入通达信请求失败: %w", err)
		}
		packet = packet[n:]
	}
	return nil
}

type responsePacket struct {
	service uint16
	command uint16
	body    []byte
}

func (c *Client) readPacketLocked(ctx context.Context) (*responsePacket, error) {
	if err := c.setDeadlineLocked(ctx); err != nil {
		return nil, err
	}
	header := make([]byte, 16)
	if _, err := io.ReadFull(c.conn, header); err != nil {
		return nil, fmt.Errorf("读取通达信响应头失败: %w", err)
	}
	if !bytes.Equal(header[:4], []byte{0xB1, 0xCB, 0x74, 0x00}) {
		return nil, fmt.Errorf("通达信响应标识无效: % X", header[:4])
	}
	service := binary.BigEndian.Uint16(header[6:8])
	command := binary.LittleEndian.Uint16(header[10:12])
	compressedLength := int(binary.LittleEndian.Uint16(header[12:14]))
	rawLength := int(binary.LittleEndian.Uint16(header[14:16]))
	payloadLength := compressedLength
	if payloadLength == 0 {
		payloadLength = rawLength
	}
	if payloadLength < 0 || payloadLength > 64<<20 {
		return nil, fmt.Errorf("通达信响应长度异常: %d", payloadLength)
	}
	body := make([]byte, payloadLength)
	if _, err := io.ReadFull(c.conn, body); err != nil {
		return nil, fmt.Errorf("读取通达信响应正文失败: %w", err)
	}
	if compressedLength > 0 && compressedLength != rawLength {
		reader, err := zlib.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("创建通达信解压器失败: %w", err)
		}
		decoded, readErr := io.ReadAll(io.LimitReader(reader, 64<<20))
		closeErr := reader.Close()
		if readErr != nil {
			return nil, fmt.Errorf("解压通达信响应失败: %w", readErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("关闭通达信解压器失败: %w", closeErr)
		}
		body = decoded
	}
	return &responsePacket{service: service, command: command, body: body}, nil
}

func (c *Client) setDeadlineLocked(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	deadline := time.Now().Add(c.timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	return c.conn.SetDeadline(deadline)
}

func splitSymbol(symbol string) (market byte, code string, err error) {
	normalized := strings.ToLower(strings.TrimSpace(symbol))
	if len(normalized) != 8 {
		return 0, "", fmt.Errorf("无效的通达信股票代码 %q", symbol)
	}
	switch normalized[:2] {
	case "sz":
		market = 0
	case "sh":
		market = 1
	case "bj":
		return 0, "", fmt.Errorf("通达信免费历史分笔暂不可靠支持北交所代码 %s", symbol)
	default:
		return 0, "", fmt.Errorf("未知的交易所前缀 %q", normalized[:2])
	}
	code = normalized[2:]
	for _, character := range code {
		if character < '0' || character > '9' {
			return 0, "", fmt.Errorf("无效的股票代码 %q", symbol)
		}
	}
	return market, code, nil
}

func historyTradeRequest(date string, market byte, code string, start uint16, count int) ([]byte, error) {
	tradeDate, err := parseDateNumber(date)
	if err != nil {
		return nil, err
	}
	if count < 1 || count > pageSize {
		return nil, fmt.Errorf("通达信单页记录数必须在 1 到 %d 之间", pageSize)
	}
	body := make([]byte, 16)
	binary.LittleEndian.PutUint32(body[0:4], tradeDate)
	body[4] = market
	copy(body[6:12], code)
	binary.LittleEndian.PutUint16(body[12:14], start)
	binary.LittleEndian.PutUint16(body[14:16], uint16(count))
	return directFrame(0, historyTradeCommand, body), nil
}

func currentTradeRequest(market byte, code string, start uint16, count int) []byte {
	body := make([]byte, 12)
	binary.LittleEndian.PutUint16(body[0:2], uint16(market))
	copy(body[2:8], code)
	binary.LittleEndian.PutUint16(body[8:10], start)
	binary.LittleEndian.PutUint16(body[10:12], uint16(count))
	return directFrame(0x03000802, currentTradeCommand, body)
}

func directFrame(messageID uint32, command uint16, body []byte) []byte {
	packet := make([]byte, 12+len(body))
	packet[0] = 0x0C
	binary.LittleEndian.PutUint32(packet[1:5], messageID)
	packet[5] = 0x01
	binary.LittleEndian.PutUint16(packet[6:8], uint16(len(body)+2))
	binary.LittleEndian.PutUint16(packet[8:10], uint16(len(body)+2))
	binary.LittleEndian.PutUint16(packet[10:12], command)
	copy(packet[12:], body)
	return packet
}

func pingRequest(sequence uint16) []byte {
	packet := make([]byte, 12)
	packet[0] = 0x0C
	binary.LittleEndian.PutUint16(packet[4:6], sequence)
	binary.LittleEndian.PutUint16(packet[6:8], 2)
	binary.LittleEndian.PutUint16(packet[8:10], 2)
	binary.LittleEndian.PutUint16(packet[10:12], 0x0015)
	return packet
}

func authRequest(sequence uint16) []byte {
	packet := make([]byte, 13)
	packet[0] = 0x0C
	packet[1] = 0x02
	binary.BigEndian.PutUint16(packet[2:4], 0x1894)
	binary.BigEndian.PutUint16(packet[4:6], sequence)
	binary.LittleEndian.PutUint16(packet[6:8], 3)
	binary.LittleEndian.PutUint16(packet[8:10], 3)
	binary.LittleEndian.PutUint16(packet[10:12], 0x000D)
	packet[12] = 0x01
	return packet
}

func stageRequest(sequence uint16) []byte {
	payload := []byte{
		0x74, 0x64, 0x78, 0x6C, 0x65, 0x76, 0x65, 0x6C,
		0x00, 0x00, 0x00, 0xE1, 0x7A, 0xF4, 0x40, 0x4C,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x05,
	}
	packet := make([]byte, 12+len(payload))
	packet[0] = 0x0C
	packet[1] = 0x03
	binary.BigEndian.PutUint16(packet[2:4], 0x1899)
	binary.BigEndian.PutUint16(packet[4:6], sequence)
	binary.LittleEndian.PutUint16(packet[6:8], uint16(len(payload)+2))
	binary.LittleEndian.PutUint16(packet[8:10], uint16(len(payload)+2))
	binary.LittleEndian.PutUint16(packet[10:12], 0x0FDB)
	copy(packet[12:], payload)
	return packet
}

func parseDateNumber(date string) (uint32, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(date), "-", "")
	if len(normalized) != 8 {
		return 0, fmt.Errorf("日期必须使用 YYYY-MM-DD 格式: %q", date)
	}
	var value uint32
	for _, character := range normalized {
		if character < '0' || character > '9' {
			return 0, fmt.Errorf("日期必须使用 YYYY-MM-DD 格式: %q", date)
		}
		value = value*10 + uint32(character-'0')
	}
	return value, nil
}
