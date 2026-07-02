export function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mkv")) {
    return "video/x-matroska";
  }
  if (lower.endsWith(".webm")) {
    return "video/webm";
  }
  if (lower.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }
  return "video/mp4";
}

export function buildDirectStreamHints(filename: string) {
  return {
    notWebReady: false,
    proxyHeaders: {
      response: {
        "content-type": guessContentType(filename),
      },
    },
  };
}
