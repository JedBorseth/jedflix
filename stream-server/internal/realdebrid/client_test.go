package realdebrid

import "testing"

func TestIsInfringingError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "legal reasons status",
			err:  &APIError{Path: "/torrents/addMagnet", StatusCode: 451, Body: `{"error":"infringing_file","error_code":35}`},
			want: true,
		},
		{
			name: "error code with spacing",
			err:  &APIError{Path: "/unrestrict/link", StatusCode: 400, Body: `{"error_code": 35}`},
			want: true,
		},
		{
			name: "unrelated real debrid api error",
			err:  &APIError{Path: "/torrents/addMagnet", StatusCode: 503, Body: `{"error":"temporarily_unavailable"}`},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsInfringingError(tt.err); got != tt.want {
				t.Fatalf("IsInfringingError() = %v, want %v", got, tt.want)
			}
		})
	}
}
