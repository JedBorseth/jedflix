/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as env from "../env.js";
import type * as http from "../http.js";
import type * as jedsPicks from "../jedsPicks.js";
import type * as likedSongs from "../likedSongs.js";
import type * as musicInteractions from "../musicInteractions.js";
import type * as musicTrack from "../musicTrack.js";
import type * as myList from "../myList.js";
import type * as party from "../party.js";
import type * as partyModel from "../partyModel.js";
import type * as partySync from "../partySync.js";
import type * as playlists from "../playlists.js";
import type * as reviews from "../reviews.js";
import type * as spotify from "../spotify.js";
import type * as spotifyApi from "../spotifyApi.js";
import type * as spotifyImport from "../spotifyImport.js";
import type * as userSettings from "../userSettings.js";
import type * as users from "../users.js";
import type * as watchHistory from "../watchHistory.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  env: typeof env;
  http: typeof http;
  jedsPicks: typeof jedsPicks;
  likedSongs: typeof likedSongs;
  musicInteractions: typeof musicInteractions;
  musicTrack: typeof musicTrack;
  myList: typeof myList;
  party: typeof party;
  partyModel: typeof partyModel;
  partySync: typeof partySync;
  playlists: typeof playlists;
  reviews: typeof reviews;
  spotify: typeof spotify;
  spotifyApi: typeof spotifyApi;
  spotifyImport: typeof spotifyImport;
  userSettings: typeof userSettings;
  users: typeof users;
  watchHistory: typeof watchHistory;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
