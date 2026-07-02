import { mutation } from "./_generated/server";

const seedMovieData = [
  {
    title: "Neon Horizon",
    description:
      "A reclusive pilot discovers a hidden city floating above the clouds and must decide whether to expose it to the world.",
    posterUrl: "https://picsum.photos/seed/neon-horizon/300/450",
    backdropUrl: "https://picsum.photos/seed/neon-horizon-bg/1920/1080",
    genre: "Sci-Fi",
    year: 2024,
    durationMinutes: 128,
    rating: "PG-13",
    featured: true,
  },
  {
    title: "Midnight Express",
    description:
      "Two strangers share a late-night train ride that turns into a race against time when a mysterious package goes missing.",
    posterUrl: "https://picsum.photos/seed/midnight-express/300/450",
    backdropUrl: "https://picsum.photos/seed/midnight-express-bg/1920/1080",
    genre: "Thriller",
    year: 2023,
    durationMinutes: 112,
    rating: "R",
  },
  {
    title: "The Last Lighthouse",
    description:
      "On a remote island, a keeper records voices from the sea that reveal long-buried family secrets.",
    posterUrl: "https://picsum.photos/seed/last-lighthouse/300/450",
    backdropUrl: "https://picsum.photos/seed/last-lighthouse-bg/1920/1080",
    genre: "Drama",
    year: 2022,
    durationMinutes: 104,
    rating: "PG-13",
  },
  {
    title: "Starlight Runners",
    description:
      "Street racers in a solar-powered metropolis compete for a chance to leave Earth on humanity's first colony ship.",
    posterUrl: "https://picsum.photos/seed/starlight-runners/300/450",
    backdropUrl: "https://picsum.photos/seed/starlight-runners-bg/1920/1080",
    genre: "Action",
    year: 2025,
    durationMinutes: 118,
    rating: "PG-13",
  },
  {
    title: "Paper Planets",
    description:
      "An origami artist's creations come to life and build a miniature civilization in her studio apartment.",
    posterUrl: "https://picsum.photos/seed/paper-planets/300/450",
    backdropUrl: "https://picsum.photos/seed/paper-planets-bg/1920/1080",
    genre: "Animation",
    year: 2021,
    durationMinutes: 92,
    rating: "G",
  },
  {
    title: "Echoes of Winter",
    description:
      "A violinist returns to her hometown and confronts the orchestra director who ended her career a decade ago.",
    posterUrl: "https://picsum.photos/seed/echoes-winter/300/450",
    backdropUrl: "https://picsum.photos/seed/echoes-winter-bg/1920/1080",
    genre: "Drama",
    year: 2020,
    durationMinutes: 98,
    rating: "PG-13",
  },
  {
    title: "Codebreakers",
    description:
      "A team of hackers is recruited to stop an AI that has locked every bank in the country overnight.",
    posterUrl: "https://picsum.photos/seed/codebreakers/300/450",
    backdropUrl: "https://picsum.photos/seed/codebreakers-bg/1920/1080",
    genre: "Thriller",
    year: 2024,
    durationMinutes: 121,
    rating: "R",
  },
  {
    title: "Garden of Glass",
    description:
      "Botanists on Mars cultivate a greenhouse that may hold the key to terraforming the red planet.",
    posterUrl: "https://picsum.photos/seed/garden-glass/300/450",
    backdropUrl: "https://picsum.photos/seed/garden-glass-bg/1920/1080",
    genre: "Sci-Fi",
    year: 2023,
    durationMinutes: 115,
    rating: "PG-13",
  },
  {
    title: "Laugh Track",
    description:
      "A washed-up sitcom writer pitches one last show to a streaming giant with only 48 hours on the clock.",
    posterUrl: "https://picsum.photos/seed/laugh-track/300/450",
    backdropUrl: "https://picsum.photos/seed/laugh-track-bg/1920/1080",
    genre: "Comedy",
    year: 2022,
    durationMinutes: 96,
    rating: "PG-13",
  },
  {
    title: "Desert Crown",
    description:
      "Nomads protect an ancient relic as rival kingdoms march across the dunes to claim it.",
    posterUrl: "https://picsum.photos/seed/desert-crown/300/450",
    backdropUrl: "https://picsum.photos/seed/desert-crown-bg/1920/1080",
    genre: "Action",
    year: 2021,
    durationMinutes: 132,
    rating: "PG-13",
  },
  {
    title: "Whisper in the Pines",
    description:
      "Campers hear voices in an old growth forest and realize the trees are trying to warn them.",
    posterUrl: "https://picsum.photos/seed/whisper-pines/300/450",
    backdropUrl: "https://picsum.photos/seed/whisper-pines-bg/1920/1080",
    genre: "Horror",
    year: 2023,
    durationMinutes: 89,
    rating: "R",
  },
  {
    title: "Double Feature",
    description:
      "Twin comedians swap lives for a month and accidentally become the most famous duo on late-night TV.",
    posterUrl: "https://picsum.photos/seed/double-feature/300/450",
    backdropUrl: "https://picsum.photos/seed/double-feature-bg/1920/1080",
    genre: "Comedy",
    year: 2024,
    durationMinutes: 101,
    rating: "PG-13",
  },
  {
    title: "Painted Skies",
    description:
      "A muralist travels South America documenting stories that appear in her work as living scenes.",
    posterUrl: "https://picsum.photos/seed/painted-skies/300/450",
    backdropUrl: "https://picsum.photos/seed/painted-skies-bg/1920/1080",
    genre: "Drama",
    year: 2019,
    durationMinutes: 107,
    rating: "PG",
  },
  {
    title: "Shadow Protocol",
    description:
      "An undercover agent infiltrates a global syndicate only to find her handler is the syndicate's leader.",
    posterUrl: "https://picsum.photos/seed/shadow-protocol/300/450",
    backdropUrl: "https://picsum.photos/seed/shadow-protocol-bg/1920/1080",
    genre: "Thriller",
    year: 2025,
    durationMinutes: 126,
    rating: "R",
  },
  {
    title: "Tiny Giants",
    description:
      "Insects the size of buildings defend a city from an invasion of microscopic robots.",
    posterUrl: "https://picsum.photos/seed/tiny-giants/300/450",
    backdropUrl: "https://picsum.photos/seed/tiny-giants-bg/1920/1080",
    genre: "Animation",
    year: 2022,
    durationMinutes: 88,
    rating: "PG",
  },
  {
    title: "Iron Valley",
    description:
      "Steelworkers in a dying factory town build a robot to compete in a national fighting league.",
    posterUrl: "https://picsum.photos/seed/iron-valley/300/450",
    backdropUrl: "https://picsum.photos/seed/iron-valley-bg/1920/1080",
    genre: "Action",
    year: 2020,
    durationMinutes: 119,
    rating: "PG-13",
  },
  {
    title: "The Hollow Room",
    description:
      "A family moves into a smart home that predicts their needs a little too accurately.",
    posterUrl: "https://picsum.photos/seed/hollow-room/300/450",
    backdropUrl: "https://picsum.photos/seed/hollow-room-bg/1920/1080",
    genre: "Horror",
    year: 2024,
    durationMinutes: 94,
    rating: "R",
  },
  {
    title: "Orbit Nine",
    description:
      "A maintenance crew on a space station must reroute power before a solar flare destroys their orbit.",
    posterUrl: "https://picsum.photos/seed/orbit-nine/300/450",
    backdropUrl: "https://picsum.photos/seed/orbit-nine-bg/1920/1080",
    genre: "Sci-Fi",
    year: 2025,
    durationMinutes: 109,
    rating: "PG-13",
  },
];

export const seedMovies = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("movies").first();
    if (existing !== null) {
      return { inserted: 0, message: "Movies already seeded" };
    }

    for (const movie of seedMovieData) {
      await ctx.db.insert("movies", movie);
    }

    return { inserted: seedMovieData.length, message: "Seeded movies" };
  },
});
