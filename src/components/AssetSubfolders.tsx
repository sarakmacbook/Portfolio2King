"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAssetSubfolder } from "@/app/actions";
import type { HoldingFolder } from "@/lib/holdings-folders";
import { money, qty, TYPE_META } from "@/lib/format";
import { type PriceProvider } from "@/lib/market-prices";
import ExchangeIcon from "./ExchangeIcon";
import AddAssetDialog, { type AssetFolderChoice, type CashAccount } from "./AddAssetDialog";

type ChildHolding = {
  id: number;
  name: string;
  symbol: string;
  type: keyof typeof TYPE_META;
  quantity: number;
  value: number;
};

/**
 * "Folders inside [holding]" on an asset page, in the same chip-strip style as
 * the Holdings folder bar: one chip per subfolder (icon, name, holding count)
 * that filters the folder cards below, with **All** showing every subfolder at
 * once. A solid **＋ New folder** button in the section header opens an inline
 * name field, so creating a subfolder is always one visible click away.
 */
export default function AssetSubfolders({
  parentAssetId,
  parentAssetName,
  folders,
  childrenByFolder,
  folderChoices,
  cashAccounts,
}: {
  parentAssetId: number;
  parentAssetName: string;
  folders: HoldingFolder[];
  childrenByFolder: Record<string, ChildHolding[]>;
  folderChoices: AssetFolderChoice[];
  cashAccounts: CashAccount[];
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [creating, startCreating] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  /** Chip filter: "all" or one subfolder id. */
  const [selected, setSelected] = useState<string>("all");
  const router = useRouter();

  function createFolder() {
    if (creating || !name.trim()) return;
    setError("");
    startCreating(async () => {
      const result = await createAssetSubfolder(parentAssetId, name);
      if (!result.ok) {
        setError(result.error ?? "Could not create the folder.");
        return;
      }
      setName("");
      router.refresh();
    });
  }

  const holdingsIn = (folderId: string) => childrenByFolder[folderId] ?? [];
  const totalHoldings = folders.reduce((sum, folder) => sum + holdingsIn(folder.id).length, 0);
  const active = folders.some((folder) => folder.id === selected) ? selected : "all";
  const visible = active === "all" ? folders : folders.filter((folder) => folder.id === active);

  const chipClass = (isActive: boolean) =>
    `group flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
      isActive
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
    }`;

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Folders inside {parentAssetName}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Create a subfolder here, then add holdings of any category directly into it. Pick a
            chip to see just that folder.
          </p>
        </div>
        {!showCreate && (
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              setError("");
              setShowCreate(true);
            }}
            disabled={creating}
            title="Create a subfolder inside this holding"
          >
            ＋ New folder
          </button>
        )}
      </div>

      {folders.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSelected("all")}
          className={chipClass(active === "all")}
          aria-pressed={active === "all"}
        >
          All
          <span className={active === "all" ? "opacity-70" : "text-slate-400"}>{totalHoldings}</span>
        </button>
        {folders.map((folder) => {
          const count = holdingsIn(folder.id).length;
          const total = holdingsIn(folder.id).reduce((sum, holding) => sum + holding.value, 0);
          const isActive = active === folder.id;
          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelected(isActive ? "all" : folder.id)}
              className={chipClass(isActive)}
              aria-pressed={isActive}
              title={`${folder.name} · ${money(total)}`}
            >
              <ExchangeIcon
                provider={folder.icon === "exchange" ? (folder.glyph as PriceProvider) : undefined}
                glyph={folder.icon === "emoji" ? folder.glyph : undefined}
                label={folder.name.slice(0, 1)}
                color={folder.color}
                className="h-4 w-4 rounded"
              />
              <span className="max-w-28 truncate">{folder.name}</span>
              <span className={isActive ? "opacity-70" : "text-slate-400"}>{count}</span>
            </button>
          );
        })}
      </div>
      )}

      {showCreate && (
        <div className="rounded-xl border border-indigo-200 bg-slate-50/60 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input min-w-0 flex-1"
              value={name}
              maxLength={28}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createFolder();
                }
                if (event.key === "Escape") setShowCreate(false);
              }}
              placeholder="New folder name"
              aria-label={`New folder inside ${parentAssetName}`}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={createFolder}
                disabled={creating || !name.trim()}
              >
                {creating ? "Creating…" : "Create folder"}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setShowCreate(false);
                  setError("");
                }}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
        </div>
      )}

      {folders.length === 0 && !showCreate && (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
          No folders yet. Use ＋ New folder above to group related holdings under this asset.
        </p>
      )}

      {visible.map((folder) => {
        const holdings = holdingsIn(folder.id);
        const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
        const choices = folderChoices.filter((choice) => choice.id === folder.id);
        return (
          <div key={folder.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <ExchangeIcon
                  provider={folder.icon === "exchange" ? (folder.glyph as PriceProvider) : undefined}
                  glyph={folder.icon === "emoji" ? folder.glyph : undefined}
                  label={folder.name.slice(0, 1)}
                  color={folder.color}
                  className="h-5 w-5 rounded-md"
                />
                <h3 className="truncate font-medium text-slate-900">{folder.name}</h3>
                <span className="text-xs text-slate-400">
                  {holdings.length} holding{holdings.length === 1 ? "" : "s"} · {money(total)}
                </span>
              </div>
              <AddAssetDialog
                cashAccounts={cashAccounts}
                folders={choices}
                defaultFolderId={folder.id}
                allowCreateFolder
                newFolderParentAssetId={parentAssetId}
                label="＋ Add asset here"
                className="btn-ghost text-xs"
              />
            </div>
            {holdings.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {holdings.map((holding) => (
                  <li key={holding.id}>
                    <Link
                      href={`/assets/${holding.id}`}
                      className="flex items-center justify-between gap-3 py-2 text-sm hover:text-indigo-600"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{holding.name}</span>
                        {holding.symbol && holding.symbol !== holding.name && (
                          <span className="ml-2 text-xs text-slate-400">{holding.symbol}</span>
                        )}
                        <span className="ml-2 text-xs text-slate-400">{TYPE_META[holding.type].label}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="block font-medium">{money(holding.value)}</span>
                        {holding.type !== "cash" && (
                          <span className="text-xs text-slate-400">{qty(holding.quantity)} units</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-400">This folder is empty. Add a holding here to get started.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
