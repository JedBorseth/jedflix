export const RD_BLOCKED_FILENAME_PATTERN =
  /web-dl|webrip|bdrip|hdrip|dvdrip|BluRay\.x264|HDTV\.x264|HDTV\.XviD|WEB\.x264|WEB\.h264/i;

export function isRDBlockedFilename(title: string): boolean {
  return RD_BLOCKED_FILENAME_PATTERN.test(title);
}
