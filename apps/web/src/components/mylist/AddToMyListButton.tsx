import { Authenticated } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@/lib/types";
import { PlusIcon, CheckIcon } from "@radix-ui/react-icons";

type AddToMyListButtonProps = {
  movieId: number;
  mediaType: MediaType;
};

export function AddToMyListButton({ movieId, mediaType }: AddToMyListButtonProps) {
  return (
    <Authenticated>
      <AddToMyListButtonInner movieId={movieId} mediaType={mediaType} />
    </Authenticated>
  );
}

function AddToMyListButtonInner({ movieId, mediaType }: AddToMyListButtonProps) {
  const isSaved = useQuery(api.myList.isSaved, { movieId, mediaType });
  const toggleMyList = useMutation(api.myList.toggle);

  if (isSaved === undefined) {
    return (
      <Button size="lg" variant="outline" className="border-zinc-600" disabled>
        My List
      </Button>
    );
  }

  return (
    <Button
      size="lg"
      variant="outline"
      className="border-zinc-600"
      onClick={() => {
        void toggleMyList({ movieId, mediaType })
          .then((result) => {
            toast.success(result.saved ? "Added to My List" : "Removed from My List");
          })
          .catch((error: unknown) => {
            console.error(error);
            toast.error("Could not update My List");
          });
      }}
    >
      {isSaved ? (
        <>
          <CheckIcon className="mr-2 h-4 w-4" />
          In My List
        </>
      ) : (
        <>
          <PlusIcon className="mr-2 h-4 w-4" />
          My List
        </>
      )}
    </Button>
  );
}
