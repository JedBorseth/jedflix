package resolver

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/realdebrid"
)

// filePicker chooses the files to play from a torrent's file list.
type filePicker func(files []realdebrid.TorrentFile) ([]realdebrid.TorrentFile, error)

// torrentLease is a torrent in the user's Real Debrid account that a resolve
// is using. Torrents are kept after a successful play so Real Debrid keeps
// them cached; only a torrent this resolve added and could not use is removed.
type torrentLease struct {
	id    string
	added bool
	// info is the latest known state; downloaded torrents skip a poll.
	info  *realdebrid.TorrentInfo
	files []realdebrid.TorrentFile
}

func (s *Service) rdClient(token string) *realdebrid.Client {
	if s.newRD != nil {
		return s.newRD(token)
	}
	return realdebrid.NewClientWithToken(s.cfg, token)
}

// acquireTorrent reuses a torrent already in the account when its selected
// files cover what pick wants, and otherwise adds the magnet and selects them.
// On error, a torrent added here has already been cleaned up unless Real
// Debrid is still working on it.
func (s *Service) acquireTorrent(
	ctx context.Context,
	rd *realdebrid.Client,
	magnet string,
	timeout time.Duration,
	pick filePicker,
	report func(string),
) (*torrentLease, error) {
	if lease := findReusableTorrent(ctx, rd, infoHashFromMagnet(magnet), pick); lease != nil {
		if lease.info.Status == "waiting_files_selection" {
			report("Selecting files on Real Debrid…")
			if err := rd.SelectFiles(ctx, lease.id, fileIDs(lease.files)); err != nil {
				return nil, mapRDError(err)
			}
			lease.info = nil
		} else {
			report("Found in your Real Debrid account.")
		}
		return lease, nil
	}

	report("Adding magnet to Real Debrid…")
	id, err := rd.AddMagnet(ctx, magnet)
	if err != nil {
		return nil, mapRDError(err)
	}
	lease := &torrentLease{id: id, added: true}
	ok := false
	defer func() {
		if !ok {
			cleanupRDTorrent(rd, id)
		}
	}()

	report("Magnet added to Real Debrid. Waiting for file list…")
	info, err := rd.WaitForFileList(ctx, id, timeout)
	if err != nil {
		if ctx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid timed out while fetching torrent metadata. Try another source."}
		}
		return nil, mapRDError(err)
	}
	files, err := pick(info.Files)
	if err != nil {
		return nil, err
	}
	lease.files = files

	report(selectingMessage(len(files)))
	if err := rd.SelectFiles(ctx, id, fileIDs(files)); err != nil {
		return nil, mapRDError(err)
	}
	ok = true
	return lease, nil
}

// waitAndLink waits for the leased torrent and returns one link per file.
func (s *Service) waitAndLink(
	ctx context.Context,
	rd *realdebrid.Client,
	lease *torrentLease,
	timeout time.Duration,
	report func(string),
) ([]string, error) {
	var initial *realdebrid.TorrentInfo
	if lease.info != nil && lease.info.Status == "downloaded" {
		initial = lease.info
	}
	if initial == nil {
		report("Waiting for Real Debrid download…")
	}
	info, err := rd.WaitReady(ctx, lease.id, timeout, initial, report)
	if err != nil {
		// A pending download stays in Real Debrid after we stop waiting.
		timedOut := ctx.Err() != nil || strings.Contains(err.Error(), "timed out")
		if lease.added && !timedOut {
			cleanupRDTorrent(rd, lease.id)
		}
		if ctx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid torrent timed out."}
		}
		return nil, mapRDError(err)
	}
	links, ok := realdebrid.LinksForFiles(info, lease.files)
	if !ok {
		if lease.added {
			cleanupRDTorrent(rd, lease.id)
		}
		return nil, &ResolveError{
			Code:    "no_links",
			Message: "Real Debrid returned no links for the selected files.",
		}
	}
	return links, nil
}

// findReusableTorrent looks for the same hash in the account. A lookup failure
// is not fatal: the caller falls back to adding the magnet.
func findReusableTorrent(
	ctx context.Context,
	rd *realdebrid.Client,
	hash string,
	pick filePicker,
) *torrentLease {
	hash = strings.ToLower(strings.TrimSpace(hash))
	if hash == "" {
		return nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	torrents, err := rd.ListTorrents(lookupCtx)
	if err != nil {
		return nil
	}
	candidates := realdebrid.TorrentsByHash(torrents)[hash]
	// Finished torrents first, then ones still downloading.
	for _, wantDownloaded := range []bool{true, false} {
		for _, candidate := range candidates {
			if realdebrid.IsTerminalStatus(candidate.Status) || (candidate.Status == "downloaded") != wantDownloaded {
				continue
			}
			info, err := rd.GetTorrentInfo(lookupCtx, candidate.ID)
			if err != nil || info == nil || len(info.Files) == 0 {
				continue
			}
			files, err := pick(info.Files)
			if err != nil {
				continue
			}
			if info.Status != "waiting_files_selection" && !realdebrid.AllSelected(info, files) {
				// Selected for a different episode or file; add a fresh copy.
				continue
			}
			return &torrentLease{id: candidate.ID, info: info, files: files}
		}
	}
	return nil
}

func fileIDs(files []realdebrid.TorrentFile) []int {
	ids := make([]int, len(files))
	for i, file := range files {
		ids[i] = file.ID
	}
	return ids
}

func selectingMessage(count int) string {
	if count == 1 {
		return "Selecting file on Real Debrid…"
	}
	return "Selecting " + strconv.Itoa(count) + " files on Real Debrid…"
}
