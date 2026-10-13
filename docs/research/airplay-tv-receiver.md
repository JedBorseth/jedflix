# AirPlay receiver inside JedFlix TV, and waking the TV

Investigated 2026-10-12. This updates the earlier foreground-listener proposal after the user made automatic wake and app launch a requirement. No receiver or wake implementation has been added.

## Finding

**Yes, embedding an AirPlay receiver in an Android TV app is technically feasible.** There is an existing Android implementation worth testing. However, making JedFlix appear in the AirPlay picker, bringing its player to the foreground, waking the physical TV, and continuing after the iPhone powers off are four separate capabilities. An AirPlay receiver does not automatically establish all four.

For the user's main goal—tap a movie in Safari, wake the TV, launch JedFlix TV, and let the phone power off—the strongest first prototype is a paired Android TV Remote connection from the existing LAN server, followed by a JedFlix playback deep link. Investigate AirPlay as an additional input route rather than assuming it is necessary for waking the TV.

## Concrete Android receiver candidate

[`jqssun/android-airplay-server`](https://github.com/jqssun/android-airplay-server) supports Android 7+ and Android TV. Its README advertises screen mirroring, audio, and video playback; it uses UxPlay C code, JNI, Android MediaCodec, and Media3 ExoPlayer. It is GPL-3.0 and does not support DRM content. Discovery requires sender and receiver on the same subnet. The repository is a credible implementation candidate, not evidence that every Safari stream or Android TV firmware works.

Source inspected at commit `c8defdd70d7e6a04f4f1b71d353653682d594106`:

- [`AirPlayVideoPlayer.kt`](https://github.com/jqssun/android-airplay-server/blob/c8defdd70d7e6a04f4f1b71d353653682d594106/app/src/main/kotlin/io/github/jqssun/airplay/renderer/AirPlayVideoPlayer.kt) receives a location URL and start position, constructs a Media3 media item, and starts ExoPlayer. This is actual URL playback, distinct from decoding the iPhone's mirrored screen.
- [`AirPlayService.kt`](https://github.com/jqssun/android-airplay-server/blob/c8defdd70d7e6a04f4f1b71d353653682d594106/app/src/main/kotlin/io/github/jqssun/airplay/service/AirPlayService.kt) runs a foreground service and holds a partial wake lock. `onVideoPlay` dispatches URL playback. Incoming connections can bring its activity forward, subject to a preference. The service returns `START_NOT_STICKY`, so automatic recovery from process termination is not guaranteed.
- [`AndroidManifest.xml`](https://github.com/jqssun/android-airplay-server/blob/c8defdd70d7e6a04f4f1b71d353653682d594106/app/src/main/AndroidManifest.xml) declares connected-device/media-playback foreground-service permissions, a boot receiver, wake-lock permission, and `SYSTEM_ALERT_WINDOW`.
- [`BootReceiver.kt`](https://github.com/jqssun/android-airplay-server/blob/c8defdd70d7e6a04f4f1b71d353653682d594106/app/src/main/kotlin/io/github/jqssun/airplay/BootReceiver.kt) can restart its listener after boot. This is not the same as waking a sleeping TV or surviving an app force-stop.

JedFlix TV already uses Media3. A possible integration seam is the receiver's video-play/scrub/rate/stop callbacks feeding JedFlix's player. Native library builds, discovery, authentication, service lifecycle, and playback-state responses remain substantive work. Review the project's GPL license before distributing an integrated APK; this is not a dependency that can be assumed to have a permissive license. [Receiver license](https://github.com/jqssun/android-airplay-server/blob/main/LICENSE).

## Safari compatibility and phone shutdown

Do not choose screen mirroring for independent TV playback: it requires the phone to keep supplying audio/video. URL playback is the relevant path, but this receiver is not proven to support JedFlix Safari/PWA direct Real Debrid streams. Upstream UxPlay's README currently limits its HLS video feature to YouTube's iOS application and explicitly says browser AirPlay video is not supported. The Android port's broader claims require testing rather than assuming identical behavior. [UxPlay README](https://github.com/FDH2/UxPlay).

The Android service clears video playback when its connection count reaches zero. It also documents that HLS locations may point to a local native playlist proxy valid only during the session. Consequently, the current source does not establish phone-off survival: an independent URL handoff needs deliberate session-detach behavior and upstream resources that remain available. Inspecting a URL callback alone is insufficient. [Service implementation](https://github.com/jqssun/android-airplay-server/blob/c8defdd70d7e6a04f4f1b71d353653682d594106/app/src/main/kotlin/io/github/jqssun/airplay/service/AirPlayService.kt).

The custom JedFlix playback command proposed earlier is easier to make independent: the TV receives a TMDB identity, resolves through its own account, and plays on its own. Once playback starts, the phone is outside that media path. This is a design inference, not a claim about a feature already delivered.

## Background listening and physical TV wake

A partial wake lock keeps CPU work running; it does not turn the display on. Android's `setTurnScreenOn(true)` can turn on the screen when an activity becomes visible and resumed. It does not itself deliver a network request, grant permission to launch from the background, or prove that an OEM television remains reachable in standby. [PowerManager reference](https://developer.android.com/reference/android/os/PowerManager#PARTIAL_WAKE_LOCK), [Activity reference](<https://developer.android.com/reference/android/app/Activity#setTurnScreenOn(boolean)>).

Android restricts background activity launches. User-granted overlay permission is one documented exception; a foreground service should not be treated as blanket permission to show an activity. Android 15+ also requires an existing visible overlay for the overlay-based foreground-service-start exception. An already running service and starting a new service are different cases. [Activity security](https://developer.android.com/guide/components/activities/secure-bal), [Foreground-service start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

The inspected receiver has launch-on-connect code and keep-screen-on behavior, but no `setTurnScreenOn` call. Its partial wake lock therefore is not proof that it wakes the physical TV. Network standby, firmware power management, HDMI-CEC, and whether the device is an integrated TV or a separately powered dongle need hardware checks. Deep standby and loss of mains power are not equivalent to an app being in the background.

## More direct route for broad Android TV coverage

Home Assistant's Android TV Remote implementation uses Android TV Remote Service, preinstalled on most Android TV devices. It supports power control and launching app-supported deep links. Its docs recommend deep links because launching arbitrary package IDs is currently unreliable. They also list exceptions: Fire TV lacks the service, some Xiaomi devices become unreachable when off, and some TCL TVs require Screenless Service enabled. Thus broad compatibility is plausible, universal standby wake is not. [Home Assistant Android TV Remote](https://www.home-assistant.io/integrations/androidtv_remote/).

The underlying [`androidtvremote2`](https://github.com/tronikos/androidtvremote2) library exposes key commands and application/deep-link launch commands. A concrete prototype is:

1. Pair the existing Linux server with the TV's system remote service once, using its displayed pairing code.
2. Add an authenticated **Play on TV** endpoint used by Safari/PWA.
3. Send `WAKEUP` through the paired remote connection, then launch an app-supported link such as `jedflix://play/movie/123` or a TV-episode equivalent.
4. Add the intent filter and `onNewIntent` handling in JedFlix TV; validate the media identity and dispatch through its existing `PlaybackResolver.autoStart`.
5. Let the TV resolve and play independently. Use a separate app acknowledgement to confirm actual playback; remote-protocol launch success is not proof that the media started.

The link format above is proposed, not an existing registered link. Relevant sibling files are `../jedflix-tv/app/src/main/AndroidManifest.xml`, `MainActivity.kt`, `ui/navigation/JedflixNavHost.kt`, and `data/playback/PlaybackResolver.kt`. A LAN control service requires a server or home bridge reachable from that TV's network; the phone itself need only reach the authenticated HTTPS endpoint.

Original Chromecast dongles without Google TV cannot host the JedFlix Android APK; Chromecast with Google TV is a different target. Support for original Cast-only devices would use a Cast receiver and is a separate product path. Built-in inexpensive Android TVs also vary in standby connectivity, so the first prototype must include representative real devices.

## Recommended decision

Prototype system-remote wake plus JedFlix deep-link playback first. It directly addresses wake, cold app launch, Safari/PWA control, and phone independence while preserving the TV's existing stream resolver. Retain an open-app command-listener fallback where wake/launch is unavailable.

If appearing in the native AirPlay picker is also desired, test the existing Android receiver APK with a Safari direct MP4 stream before integrating native code. Verify URL mode rather than mirroring, lock-screen behavior, full phone shutdown, background app launch, standby reachability, and TV wake separately. No receiver approach should be advertised as solving all of these until those tests pass.
