"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAssetSubfolder } from "@/app/actions";
import type { HoldingFolder } from "@/lib/holdings-folders";
import { money, qty, TYPE_META } from "@/lib/format";
import AddAssetDialog, { type AssetFolderChoice, type CashAccount } from "./AddAssetDialog";

type ChildHolding = {
  id: number;
  name: string;
  symbol: string;
  type: keyof typeof TYPE_META;
  quantity: number;
  value: number;
};

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
  const router = useRouter();

  function createFolder() {
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

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Folders inside {parentAssetName}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Create a subfolder here, then add holdings of any category directly into it.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
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
          }}
          placeholder="New folder name"
          aria-label={`New folder inside ${parentAssetName}`}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={createFolder}
          disabled={creating || !name.trim()}
        >
          {creating ? "Creating…" : "Create folder"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

      {folders.length > 0 ? (
        <div className="space-y-3">
          {folders.map((folder) => {
            const holdings = childrenByFolder[folder.id] ?? [];
            const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
            const choices = folderChoices.filter((choice) => choice.id === folder.id);
            return (
              <div key={folder.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: folder.color }} />
                    <h3 className="truncate font-medium text-slate-900">{folder.name}</h3>
                    <span className="text-xs text-slate-400">
                      {holdings.length} holding{holdings.length === 1 ? "" : "s"} · {money(total)}
                    </span>
                  </div>
                  <AddAssetDialog
                    cashAccounts={cashAccounts}
                    folders={choices}
                    defaultFolderId={folder.id}
                    allowCreateFolder={false}
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
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
          No folders yet. Create one above to group related holdings under this asset.
        </p>
      )}
    </section>
  );
}
