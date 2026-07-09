import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type NativeStreamPlayerProps = {
  url: string;
  title?: string;
  onPlaybackError: (message: string) => void;
  onBack: () => void;
  onProgress?: (seconds: number) => void;
};

function buildVideoSource(url: string): VideoSource {
  const lower = url.toLowerCase();
  const contentType = lower.includes(".m3u8") ? "hls" : "progressive";
  return { uri: url, contentType };
}

export function NativeStreamPlayer({
  url,
  title,
  onPlaybackError,
  onBack,
  onProgress,
}: NativeStreamPlayerProps) {
  const source = buildVideoSource(url);
  const reportedError = useRef(false);
  const [showLoader, setShowLoader] = useState(true);

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    if (onProgress) {
      instance.timeUpdateEventInterval = 15;
    }
  });

  useEffect(() => {
    reportedError.current = false;
    setShowLoader(true);

    const playTimer = setTimeout(() => {
      player.play();
    }, 0);

    const statusSubscription = player.addListener("statusChange", ({ status, error }) => {
      if (status === "readyToPlay") {
        setShowLoader(false);
      }
      if (status === "error" && !reportedError.current) {
        reportedError.current = true;
        setShowLoader(false);
        onPlaybackError(error?.message ?? "This stream could not be played on your device.");
      }
    });

    const playingSubscription = player.addListener("playingChange", ({ isPlaying }) => {
      if (isPlaying) {
        setShowLoader(false);
      }
    });

    const progressSubscription =
      onProgress &&
      player.addListener("timeUpdate", ({ currentTime }) => {
        if (currentTime > 0) {
          setShowLoader(false);
          onProgress(Math.floor(currentTime));
        }
      });

    return () => {
      clearTimeout(playTimer);
      statusSubscription.remove();
      playingSubscription.remove();
      progressSubscription?.remove();
    };
  }, [player, onPlaybackError, onProgress, url]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
      <Pressable onPress={onBack} style={styles.backPressable}>
        <Text style={styles.backButton}>← Streams</Text>
      </Pressable>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
      </View>
      <VideoView
        style={styles.video}
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        onFirstFrameRender={() => setShowLoader(false)}
      />
      {showLoader ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#e50914" size="large" />
          <Text style={styles.loadingText}>Loading stream...</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    zIndex: 2,
    gap: 4,
  },
  backPressable: { alignSelf: "flex-start" },
  backButton: { color: "#e50914", fontSize: 16, fontWeight: "600" },
  title: { color: "#d4d4d8", fontSize: 12 },
  video: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  loadingText: { color: "#fff" },
});
