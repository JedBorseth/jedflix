package config

import (
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAbbHTTPClientIgnoresEnvironmentProxy(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "direct")
	}))
	t.Cleanup(origin.Close)

	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	t.Setenv("http_proxy", "http://127.0.0.1:1")
	t.Setenv("https_proxy", "http://127.0.0.1:1")

	client := Config{}.AbbHTTPClient()
	resp, err := client.Get(origin.URL)
	if err != nil {
		t.Fatalf("ABB client must not use HTTP_PROXY; got %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "direct" {
		t.Fatalf("got %q", body)
	}
}

func TestAbbHTTPClientUsesHTTPProxy(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "origin")
	}))
	t.Cleanup(origin.Close)

	proxied := false
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied = true
		if r.Method != http.MethodGet {
			t.Errorf("method %s", r.Method)
		}
		resp, err := http.DefaultClient.Get(r.URL.String())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}))
	t.Cleanup(proxy.Close)

	client := Config{AbbProxy: proxy.URL}.AbbHTTPClient()
	resp, err := client.Get(origin.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "origin" {
		t.Fatalf("got %q", body)
	}
	if !proxied {
		t.Fatal("request did not go through ABB_PROXY")
	}
}

func TestAbbHTTPClientUsesSOCKS5Proxy(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "socks-ok")
	}))
	t.Cleanup(origin.Close)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go serveTestSOCKS5(t, ln)

	client := Config{AbbProxy: "socks5://" + ln.Addr().String()}.AbbHTTPClient()
	resp, err := client.Get(origin.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "socks-ok" {
		t.Fatalf("got %q", body)
	}
}

func TestAbbProxyScheme(t *testing.T) {
	if got := (Config{AbbProxy: "socks5://abb-warp:40000"}).AbbProxyScheme(); got != "socks5" {
		t.Fatalf("got %q", got)
	}
	if got := (Config{}).AbbProxyScheme(); got != "" {
		t.Fatalf("empty proxy scheme %q", got)
	}
}

func serveTestSOCKS5(t *testing.T, ln net.Listener) {
	t.Helper()
	for {
		conn, err := ln.Accept()
		if err != nil {
			if !strings.Contains(err.Error(), "use of closed") {
				t.Logf("socks accept: %v", err)
			}
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			_ = c.SetDeadline(time.Now().Add(5 * time.Second))
			head := make([]byte, 2)
			if _, err := io.ReadFull(c, head); err != nil {
				return
			}
			methods := make([]byte, int(head[1]))
			if _, err := io.ReadFull(c, methods); err != nil {
				return
			}
			if _, err := c.Write([]byte{0x05, 0x00}); err != nil {
				return
			}
			req := make([]byte, 4)
			if _, err := io.ReadFull(c, req); err != nil {
				return
			}
			var host string
			switch req[3] {
			case 0x01:
				addr := make([]byte, 4)
				if _, err := io.ReadFull(c, addr); err != nil {
					return
				}
				host = net.IP(addr).String()
			case 0x03:
				lenBuf := make([]byte, 1)
				if _, err := io.ReadFull(c, lenBuf); err != nil {
					return
				}
				name := make([]byte, int(lenBuf[0]))
				if _, err := io.ReadFull(c, name); err != nil {
					return
				}
				host = string(name)
			case 0x04:
				addr := make([]byte, 16)
				if _, err := io.ReadFull(c, addr); err != nil {
					return
				}
				host = net.IP(addr).String()
			default:
				return
			}
			portBuf := make([]byte, 2)
			if _, err := io.ReadFull(c, portBuf); err != nil {
				return
			}
			port := binary.BigEndian.Uint16(portBuf)
			target, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(int(port))), 3*time.Second)
			if err != nil {
				_, _ = c.Write([]byte{0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
				return
			}
			defer target.Close()
			if _, err := c.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
				return
			}
			go func() { _, _ = io.Copy(target, c) }()
			_, _ = io.Copy(c, target)
		}(conn)
	}
}
