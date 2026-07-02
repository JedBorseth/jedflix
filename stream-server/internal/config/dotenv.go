package config

import (
	"bufio"
	"os"
	"strings"
)

// LoadEnvFiles loads KEY=VALUE pairs from common env file locations.
// Later files do not override variables already set in the environment.
func LoadEnvFiles() {
	candidates := []string{
		".env",
		".env.local",
		"../.env.local",
		"../.env",
		"stream-server/.env",
		"stream-server/.env.local",
	}
	for _, path := range candidates {
		loadEnvFile(path)
	}
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, value)
	}
}
