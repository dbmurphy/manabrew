import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchForgeDeckCatalog,
  fetchForgeDeckList,
  type ForgeDeckCatalog,
} from "@/lib/forgeDeckCatalog";

interface ForgeDeckCatalogBrowserProps {
  onSelect: (text: string, name: string) => void;
}

export function ForgeDeckCatalogBrowser({ onSelect }: ForgeDeckCatalogBrowserProps) {
  const [catalog, setCatalog] = useState<ForgeDeckCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchForgeDeckCatalog(controller.signal)
      .then(setCatalog)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Catalog unavailable");
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);
  const matches = useMemo(
    () =>
      catalog?.decks.filter(([path, name]) =>
        `${name} ${path}`.toLowerCase().includes(query.trim().toLowerCase()),
      ) ?? [],
    [catalog, query],
  );
  async function select(path: string, name: string) {
    if (!catalog || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const text = await fetchForgeDeckList(catalog, path, controller.signal);
      if (!controller.signal.aborted) onSelect(text, name);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Deck unavailable");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="Forge deck catalog">
      <p className="text-xs text-muted-foreground">
        Search Forge's bundled deck lists. Loading a list requires internet access; card details are
        looked up when you confirm the import. Forge printing numbers are art indices, so imports
        use default printings and nonfoil finishes. Adventure setup rules are not imported.
      </p>
      <Input
        aria-label="Search Forge decks"
        placeholder="Deck name or folder"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
        disabled={loading}
      />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {catalog
          ? `${matches.length.toLocaleString()} matching lists`
          : error
            ? "Catalog unavailable"
            : "Loading catalog…"}
        {loading ? " · Loading deck…" : ""}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="max-h-[25dvh] space-y-1 overflow-y-auto">
        {matches.slice(page * 25, (page + 1) * 25).map(([path, name]) => (
          <Button
            key={path}
            variant="ghost"
            className="h-auto min-h-11 w-full flex-col items-start whitespace-normal py-2 text-left"
            disabled={loading}
            onClick={() => void select(path, name)}
          >
            <span>{name}</span>
            <span className="break-all text-xs font-normal text-muted-foreground">{path}</span>
          </Button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={page === 0 || loading}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs">
          {matches.length ? `${page + 1} / ${Math.ceil(matches.length / 25)}` : "0 / 0"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={(page + 1) * 25 >= matches.length || loading}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
