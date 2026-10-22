// @vitest-environment happy-dom
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { PartyProvider } from "@/components/party/PartyProvider";
import { PartyPanel } from "@/components/party/PartyPanel";
import {
  useParty,
  type PartyContextValue,
} from "@/components/party/partyContext";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { PartyJoinPage } from "@/pages/PartyJoinPage";
import {
  clearGuestPartyToken,
  getGuestPartyToken,
  partyErrorMessage,
} from "@/lib/partyClient";

const state = vi.hoisted(() => ({
  authenticated: false,
  authLoading: false,
  queries: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  player: {
    current: null as { id: string } | null,
    queue: [] as { id: string }[],
    queueIndex: 0,
    playing: false,
    loading: false,
    error: null as string | null,
    currentTime: 0,
    playTrack: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    seek: vi.fn(),
    clear: vi.fn(),
    syncPartyQueue: vi.fn(),
  },
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: state.authLoading,
  }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.queries.get(getFunctionName(ref)),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (!state.mutations.has(name))
      state.mutations.set(
        name,
        vi.fn(async () => ({ code: "ABC234" })),
      );
    return state.mutations.get(name);
  },
}));
vi.mock("@/components/player/music/MusicPlayerContext", () => ({
  useMusicPlayer: () => state.player,
}));
vi.mock("@/components/party/PartySpotifyControls", () => ({
  PartySpotifyControls: () => <div>Spotify settings</div>,
}));
vi.mock("@/hooks/useUserSettings", () => ({
  useUserSettings: () => ({ onboardingCompleted: false }),
}));

const track = {
  id: "one",
  title: "One",
  artists: ["Artist"],
  albumName: "Album",
  imageUrl: "",
  durationMs: 200000,
};
function partyFixture(overrides = {}) {
  return {
    partyId: "party",
    code: "ABC234",
    isHost: false,
    track,
    queue: [track],
    queueIndex: 0,
    isPlaying: false,
    positionMs: 30000,
    positionUpdatedAt: Date.now(),
    revision: 1,
    updatedBy: "member:host",
    members: [],
    spotifyTargets: [],
    ...overrides,
  };
}
let context: PartyContextValue;
function Harness() {
  context = useParty();
  return <button onClick={() => context.setPanelOpen(true)}>Open party</button>;
}
function app(path = "/music", child = <Harness />) {
  return (
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <PartyProvider>{child}</PartyProvider>
      </MemoryRouter>
    </StrictMode>
  );
}

beforeEach(() => {
  clearGuestPartyToken();
  window.localStorage.clear();
  state.authenticated = false;
  state.authLoading = false;
  state.queries.clear();
  state.mutations.clear();
  state.queries.set("party:getState", null);
  state.queries.set("party:getGuestState", null);
  state.player.current = null;
  state.player.queue = [];
  state.player.playing = false;
  state.player.loading = false;
  state.player.error = null;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a fresh invite automatically joins once and skips setup", async () => {
  render(
    app(
      "/party/ABC234",
      <Routes>
        <Route
          path="/party/:code"
          element={
            <OnboardingGate>
              <PartyJoinPage />
            </OnboardingGate>
          }
        />
        <Route path="/music" element={<p>Music browse</p>} />
      </Routes>,
    ),
  );
  await screen.findByText("Music browse");
  const join = state.mutations.get("party:joinGuest")!;
  expect(join).toHaveBeenCalledTimes(1);
  expect(join.mock.calls[0][0]).toMatchObject({
    code: "ABC234",
    guestToken: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(window.localStorage.getItem("jedflix.userSettings")).toBeNull();
});

test("invalid invites show a clean error and can be retried", async () => {
  state.mutations.set(
    "party:joinGuest",
    vi
      .fn()
      .mockRejectedValueOnce(new ConvexError("No active party with that code"))
      .mockResolvedValue({ code: "ABC234" }),
  );
  render(
    app(
      "/party/ABC234",
      <Routes>
        <Route path="/party/:code" element={<PartyJoinPage />} />
        <Route path="/music" element={<p>Music browse</p>} />
      </Routes>,
    ),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "No active party with that code",
  );
  fireEvent.click(screen.getByRole("button", { name: "Join party" }));
  await screen.findByText("Music browse");
});

test("rejoining a paused party does not broadcast a resume", () => {
  getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  render(app());
  expect(state.player.playTrack).toHaveBeenCalled();
  expect(state.player.pause).toHaveBeenCalled();
  expect(state.mutations.get("party:setPlaying")).not.toHaveBeenCalledWith(
    expect.objectContaining({ isPlaying: true }),
  );
});

test("an ended party clears guest audio and returns to the join page", async () => {
  getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  const child = (
    <Routes>
      <Route path="/music" element={<Harness />} />
      <Route path="/party" element={<p>Party ended screen</p>} />
    </Routes>
  );
  const view = render(app("/music", child));
  state.queries.set("party:getGuestState", null);
  view.rerender(app("/music", child));
  await screen.findByText("Party ended screen");
  expect(state.player.clear).toHaveBeenCalled();
});

test("guest playback controls carry the private credential", () => {
  const token = getGuestPartyToken(true);
  const fixture = partyFixture({ isPlaying: true });
  state.queries.set("party:getGuestState", fixture);
  state.player.current = track;
  state.player.queue = [track];
  state.player.playing = true;
  const view = render(app());
  state.player.playing = false;
  view.rerender(app());
  expect(state.mutations.get("party:setPlaying")).toHaveBeenCalledWith(
    expect.objectContaining({ guestToken: token, isPlaying: false }),
  );
});

test("guests browse music without setup, and other media routes stay in music", async () => {
  getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  render(
    app(
      "/movies",
      <Routes>
        <Route
          path="/movies"
          element={
            <OnboardingGate>
              <p>Movies</p>
            </OnboardingGate>
          }
        />
        <Route
          path="/music"
          element={
            <OnboardingGate>
              <p>Music browse</p>
            </OnboardingGate>
          }
        />
      </Routes>,
    ),
  );
  await screen.findByText("Music browse");
  expect(screen.queryByText("Movies")).toBeNull();
});

test("host QR contains the direct join link and guests cannot see host tools", async () => {
  state.authenticated = true;
  state.queries.set("party:getState", partyFixture({ isHost: true }));
  render(
    app(
      "/music",
      <>
        <Harness />
        <PartyPanel />
      </>,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open party" }));
  fireEvent.click(await screen.findByRole("button", { name: "Show QR code" }));
  expect(
    screen.getByText("Scan to join instantly. No account or setup needed."),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /party\/ABC234/ }).getAttribute("href"),
  ).toBe(`${window.location.origin}/party/ABC234`);
  fireEvent.click(screen.getByRole("button", { name: "Back to party" }));
  expect(
    screen.getByRole("button", { name: "End party for everyone" }),
  ).toBeTruthy();
});

test("a guest can leave without signing in and the credential is cleared", async () => {
  getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  render(app());
  await act(async () => context.leaveParty());
  expect(state.mutations.get("party:leaveGuest")).toHaveBeenCalledTimes(1);
  expect(getGuestPartyToken()).toBeNull();
  expect(state.player.clear).toHaveBeenCalled();
});

test("guest queue additions publish without resuming paused playback", () => {
  const token = getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  state.player.current = track;
  state.player.queue = [track];
  const view = render(app());
  const next = { ...track, id: "two", title: "Two" };
  state.player.queue = [track, next];
  view.rerender(app());
  expect(state.mutations.get("party:setQueue")).toHaveBeenCalledWith(
    expect.objectContaining({ guestToken: token, tracks: [track, next] }),
  );
  expect(state.mutations.get("party:setTrack")).not.toHaveBeenCalled();
  expect(state.mutations.get("party:setPlaying")).not.toHaveBeenCalled();
});

test("a queue edit from another device mirrors locally without restarting audio", () => {
  getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  state.player.current = track;
  state.player.queue = [track];
  const view = render(app());
  const next = { ...track, id: "two", title: "Two" };
  state.queries.set(
    "party:getGuestState",
    partyFixture({ queue: [track, next] }),
  );
  view.rerender(app());
  expect(state.player.syncPartyQueue).toHaveBeenCalledWith([track, next]);
  expect(state.player.playTrack).not.toHaveBeenCalled();
  expect(state.mutations.get("party:setQueue")).not.toHaveBeenCalled();
});

test("guest panel offers Leave and hides account and host controls", async () => {
  getGuestPartyToken(true);
  state.queries.set("party:getGuestState", partyFixture());
  render(
    app(
      "/music",
      <>
        <Harness />
        <PartyPanel />
      </>,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open party" }));
  expect(
    await screen.findByRole("button", { name: "Leave party" }),
  ).toBeTruthy();
  expect(screen.queryByText("Spotify settings")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show QR code" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start a party" })).toBeNull();
});

test("server errors remain readable across separate Convex client bundles", () => {
  const error = Object.assign(new Error("Server wrapper"), {
    name: "ConvexError",
    data: "No active party with that code",
  });
  expect(partyErrorMessage(error)).toBe("No active party with that code");
  expect(partyErrorMessage(new Error("Internal server stack"))).not.toContain(
    "Internal server stack",
  );
});

test("guest audio catches up to the party clock after a slow initial load", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  getGuestPartyToken(true);
  state.queries.set(
    "party:getGuestState",
    partyFixture({ isPlaying: true, positionMs: 0 }),
  );
  state.player.loading = true;
  const view = render(app());
  vi.setSystemTime(125000);
  state.player.current = track;
  state.player.queue = [track];
  state.player.loading = false;
  state.player.playing = true;
  view.rerender(app());
  expect(state.player.seek).toHaveBeenCalledWith(25);
  expect(state.mutations.get("party:setPosition")).not.toHaveBeenCalled();
});

test("tapping Play after an autoplay block restores the current party position", () => {
  getGuestPartyToken(true);
  state.queries.set(
    "party:getGuestState",
    partyFixture({ isPlaying: true, positionMs: 30000 }),
  );
  state.player.current = track;
  state.player.queue = [track];
  state.player.error = "Tap Play to start audio on this device.";
  const view = render(app());
  expect(state.player.seek).not.toHaveBeenCalled();
  state.player.error = null;
  state.player.playing = true;
  view.rerender(app());
  expect(state.player.seek).toHaveBeenCalledWith(expect.any(Number));
  expect(state.player.seek.mock.calls.at(-1)?.[0]).toBeGreaterThanOrEqual(30);
});
