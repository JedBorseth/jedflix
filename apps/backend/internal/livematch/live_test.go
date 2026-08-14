package livematch

import "testing"

func TestLooksLikeLiveRecording(t *testing.T) {
	live := []string{
		"2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
		"Live at the Masonic Temple, October 2nd, 2005, Detroit, MI",
		"Doolittle Live: Brixton Academy",
		"Doolittle Live",
		"Bone Machine (Live)",
		"Bone Machine [Live]",
		"Seven Nation Army - Live",
		"Seven Nation Army – Live",
		"Live at Brixton",
		"from the bootleg series",
	}
	for _, title := range live {
		if !LooksLikeLiveRecording(title) {
			t.Errorf("expected live: %q", title)
		}
	}

	studio := []string{
		"Doolittle",
		"OK Computer",
		"Live Through This",
		"Live and Let Die",
		"Alive",
		"Livin' On A Prayer",
		"People Have the Power",
		"",
	}
	for _, title := range studio {
		if LooksLikeLiveRecording(title) {
			t.Errorf("expected studio: %q", title)
		}
	}
}
