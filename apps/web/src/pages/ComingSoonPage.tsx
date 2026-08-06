
export function ComingSoonPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="pt-navbar mx-auto flex max-w-3xl flex-col px-4 pb-chrome md:px-12">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-zinc-400">{description}</p>
        <p className="mt-8 rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-500">
          Coming soon
        </p>
      </main>
    </div>
  );
}
