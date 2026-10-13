# Play on JedFlix TV from iPhone Safari or the PWA

Investigated 2026-10-12. Scope: launch playback in the existing JedFlix Android TV app. AirPlay is outside this proposal.

## Recommendation

Add a **Play on TV** button to movie detail pages and to individual TV episodes. The iPhone sends a playback command through JedFlix's HTTPS backend to a paired Android TV app. The TV resolves and plays the selected title with its own existing playback pipeline. Start with the TV app open and listening; treat launching an app that is closed as a separate capability requiring investigation and device testing.

This architecture works with Safari and an installed PWA because the phone only makes ordinary authenticated HTTPS requests. It does not depend on Google's browser Cast sender SDK, which Google explicitly does not support on iOS Chrome. Google provides a separate native iOS SDK. [Google Web Sender setup](https://developers.google.com/cast/docs/web_sender), [Google iOS Sender setup](https://developers.google.com/cast/docs/ios_sender).

## Answers to the user's questions

- **Can Safari or a PWA send a movie to a listening TV app?** Yes. Build a paired command endpoint and a receiver in the TV app. A custom JedFlix receiver is needed; simply sharing a network does not add this functionality to the existing app.
- **Does the phone need to stay on?** After the TV acknowledges that playback has started, the phone can lock or power off: the TV has the media identity, its own credentials, and its own playback connection. This is an architectural conclusion about the proposed receiver, not a claim that the current app already implements it. Do not use phone screen mirroring or a stream served by the phone.
- **Do both devices have to be on the same network?** Not with the HTTPS backend relay. Both need access to that backend. Pairing identifies the destination; network proximity is not the authorization mechanism.
- **Can the command launch JedFlix TV when it is closed or wake the TV?** That is not established by this investigation. A foreground listener receives commands while running; it does not prove cold launch, operation after force-stop, or wake from standby. These require a separately supported Android TV mechanism and hardware validation. Android restricts background activity launches even when a background service is running. [Android activity launch restrictions](https://developer.android.com/guide/components/activities/background-starts).

## Existing integration points

The sibling repository is `../jedflix-tv`. Its current one-time Real Debrid pairing flow is implemented by `app/src/main/java/com/jedflix/tv/data/rdpairing/RdKeyPairingClient.kt` and the JedFlix web Go backend at `/backend/api/v1/tv/rd-key/`. This is a useful convention for adding persistent device pairing, but it is not an existing remote-control channel.

`app/src/main/java/com/jedflix/tv/ui/navigation/JedflixNavHost.kt` already starts playback through `app/src/main/java/com/jedflix/tv/data/playback/PlaybackResolver.kt` and `autoStart`. Reuse that path with a TMDB media ID, media type, and season/episode when applicable. The app's manifest and navigation currently do not provide a dedicated Cast receiver or remote-playback deep-link entry point.

On the web, `apps/web/src/pages/MovieDetailPage.tsx` and the episode picker are the places to expose the action. The current web stream pipeline in `apps/web/src/lib/realDebrid.ts`, `packages/stream-client/src/client.ts`, and `apps/backend/internal/resolver/resolver.go` resolves streams server-side and returns direct Real Debrid URLs. Prefer sending media identity to the TV over sending an expiring resolved URL; let the TV retain its existing resolver and player. Keep catalog metadata in TMDB and only persist user/device/command data.

## Concrete first implementation

1. Add persistent TV pairing using a short-lived code shown by the TV, approved by the signed-in phone user. Give each TV a revocable device credential and display name. Never treat knowledge of a device ID as authorization.
2. Add an authenticated HTTPS endpoint to list paired TVs and enqueue commands containing a unique command ID, media type, TMDB ID, optional season/episode, optional resume position, and expiry.
3. Add a lifecycle-aware receiver to the TV app. While the app is open, use polling or long polling against the backend; acknowledge each command and deduplicate retries. Dispatch accepted commands into the existing navigation/playback path.
4. On the phone, choose a paired TV and show **Sent**, **Opening on TV**, **Playing**, or a useful failure. Do not report success solely because the backend accepted the request. An offline device or expired command should fail predictably instead of unexpectedly playing hours later.
5. After the TV starts, playback remains on the TV. Any later pause, seek, or stop controls can use the same paired command channel. Watch-progress updates originate from the TV, so progress does not depend on the phone remaining connected.

This is a proposed implementation, not code delivered by this investigation. The initial release should require the user to open JedFlix TV. Reuse the TV app’s existing automatic stream selection, fallback, and episode behavior. Background listening and cold launch need separate TV tests before being advertised.

## Cold launch and alternative approaches

Google's documented sender/receiver model is a separate integration. Its Default Media Receiver can load a media URL without a custom receiver, but that would play through Google's receiver rather than JedFlix TV. It does not meet the user's current preference to use the Android TV app. [Google receiver overview](https://developers.google.com/cast/docs/web_receiver).

For an official Chromecast-style integration from an iPhone, investigate a native iOS sender together with Android TV Cast Connect receiver support. Safari/PWA cannot simply substitute for the native sender SDK. This is a separate implementation from the HTTPS command listener. [Google iOS Sender setup](https://developers.google.com/cast/docs/ios_sender), [Google Web Sender setup](https://developers.google.com/cast/docs/web_sender), [Android TV Cast Connect](https://developers.google.com/cast/docs/android_tv_receiver).

A server on the TV's LAN might instead send Cast-protocol commands and launch a Cast Connect-enabled app. Do not rule that out categorically, but it needs a working proof of discovery, pairing/authorization, application launch, and supported-device behavior. The current backend has not demonstrated that path. A cloud command to a foreground listener is not evidence that the server can cold-launch an arbitrary Android app.

Direct phone-to-TV HTTP control would require a listener exposed on the LAN and an assessment of Safari/PWA secure-origin and local-network access behavior. The HTTPS relay avoids depending on that browser/network route and avoids exposing a TV control port. No universal browser device-discovery API should be assumed: the Remote Playback specification leaves discovery and transport support to browser implementations. [W3C Remote Playback specification](https://www.w3.org/TR/remote-playback/).

## Validation needed before shipping

Test pairing and revocation, sending while the TV app is open, offline/expired commands, retry deduplication, movie and episode IDs, resume behavior, and a real iPhone Safari/PWA session. Once playback starts, lock the phone and then power it off to verify the TV continues. Test background and cold-launch behavior separately; do not infer either from successful foreground polling.

Real Debrid account/network behavior also needs real-device verification. The documented API exposes account/IP errors and a distinct remote-traffic option, but does not establish that every generated URL is portable across network changes. Do not enable remote traffic automatically or forward the user's API key to an unrelated receiver. [Real Debrid API documentation](https://api.real-debrid.com/).
