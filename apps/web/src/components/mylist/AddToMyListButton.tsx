import { Authenticated, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@jedflix/shared";
import { isBookMediaType } from "@jedflix/shared";
import { PlusIcon, CheckIcon } from "@radix-ui/react-icons";

type AddToMyListButtonProps = {
  mediaType: MediaType;
  movieId?: number;
  workId?: string;
};

export function AddToMyListButton(props: AddToMyListButtonProps) {
  return (
    <Authenticated>
      <AddToMyListButtonInner {...props} />
    </Authenticated>
  );
}

function AddToMyListButtonInner({ movieId, workId, mediaType }: AddToMyListButtonProps) {
  const identityArgs = isBookMediaType(mediaType)
    ? { mediaType, workId }
    : { mediaType, movieId };

  const isSaved = useQuery(api.myList.isSaved, identityArgs);
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
        void toggleMyList(identityArgs)
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
