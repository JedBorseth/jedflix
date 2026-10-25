import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResolveProgressHint } from "./ResolveProgressHint";

test("shows live download progress and offers another stream", () => {
  const chooseAnother = mock(() => {});
  const { rerender } = render(
    <ResolveProgressHint
      active
      progress="Downloading on Real Debrid… 24% (downloading)"
      onChooseAnotherStream={chooseAnother}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "24",
  );
  expect(screen.getByText(/This one isn’t ready yet/)).toBeInTheDocument();
  expect(screen.getByText(/safely close this window/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try another stream" }));
  expect(chooseAnother).toHaveBeenCalledTimes(1);

  rerender(
    <ResolveProgressHint
      active
      progress="Downloading on Real Debrid… 68% (downloading)"
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "68",
  );
  expect(screen.getByText("68%")).toBeInTheDocument();

  rerender(
    <ResolveProgressHint active progress="Unrestricting Real Debrid link…" />,
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText(/safely close/)).not.toBeInTheDocument();
});

test("distinguishes a download at zero from waiting for an unknown percentage", () => {
  const { rerender } = render(
    <ResolveProgressHint
      active
      progress="Waiting for Real Debrid… (downloading)"
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  rerender(
    <ResolveProgressHint active progress="Waiting for Real Debrid… (queued)" />,
  );
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(
    screen.getByText("Waiting for the download to start"),
  ).toBeInTheDocument();
  rerender(
    <ResolveProgressHint
      active={false}
      progress="Downloading on Real Debrid… 68% (downloading)"
    />,
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
