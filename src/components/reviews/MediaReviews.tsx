import { useEffect, useState } from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MediaType } from "@/lib/types";

type MediaReviewsProps = {
  movieId: number;
  mediaType: MediaType;
};

export function MediaReviews({ movieId, mediaType }: MediaReviewsProps) {
  const summary = useQuery(api.reviews.getSummary, { movieId, mediaType });
  const reviews = useQuery(api.reviews.getForMedia, { movieId, mediaType });

  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 md:px-12 md:pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Ratings & Reviews</h2>
          {summary ? (
            <p className="mt-1 text-sm text-zinc-400">
              {summary.reviewCount === 0
                ? "No reviews yet."
                : `${summary.averageRating.toFixed(1)} average from ${summary.reviewCount} review${
                    summary.reviewCount === 1 ? "" : "s"
                  }`}
            </p>
          ) : (
            <Skeleton className="mt-1 h-4 w-48" />
          )}
        </div>
      </div>

      <Authenticated>
        <ReviewForm movieId={movieId} mediaType={mediaType} />
      </Authenticated>

      <Unauthenticated>
        <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">
          <Link to="/sign-in" className="text-red-400 hover:underline">
            Sign in
          </Link>{" "}
          to rate and review this title.
        </div>
      </Unauthenticated>

      {reviews === undefined ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-zinc-500">Be the first to share your thoughts.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <article
              key={review._id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-3">
                {review.userImage ? (
                  <img
                    src={review.userImage}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
                    {review.userName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-medium">{review.userName}</p>
                  <p className="text-xs text-zinc-500">
                    {new Date(review.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <StarRating value={review.rating} size="sm" />
              </div>
              <p className="whitespace-pre-wrap text-zinc-200">{review.comment}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewForm({ movieId, mediaType }: MediaReviewsProps) {
  const viewerReview = useQuery(api.reviews.getViewerReview, { movieId, mediaType });
  const submitReview = useMutation(api.reviews.submit);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (viewerReview) {
      setRating(viewerReview.rating);
      setComment(viewerReview.comment);
    }
  }, [viewerReview]);

  return (
    <form
      className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void submitReview({ movieId, mediaType, rating, comment })
          .then(() => {
            toast.success(viewerReview ? "Review updated" : "Review posted");
          })
          .catch((error: unknown) => {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not save review");
          })
          .finally(() => setSubmitting(false));
      }}
    >
      <p className="mb-3 text-sm font-medium text-zinc-200">
        {viewerReview ? "Update your review" : "Rate this title"}
      </p>
      <StarRating value={rating} onChange={setRating} />
      <label htmlFor="review-comment" className="mt-4 block text-sm text-zinc-300">
        Comment
      </label>
      <textarea
        id="review-comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        required
        maxLength={1000}
        rows={4}
        placeholder="Share what you thought about this title..."
        className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
      />
      <Button
        type="submit"
        disabled={submitting || comment.trim().length === 0}
        className="mt-4 bg-red-600 hover:bg-red-700"
      >
        {submitting ? "Saving..." : viewerReview ? "Update Review" : "Post Review"}
      </Button>
    </form>
  );
}
