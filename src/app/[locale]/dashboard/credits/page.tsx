"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/data-table";
import { cn } from "@/lib/utils";

type CreditRow = {
  id: string;
  transactionNo: string;
  transactionType: string;
  transactionScene?: string | null;
  credits: number;
  remainingCredits: number;
  description?: string | null;
  status: string;
  expiresAt?: string | null;
  createdAt: string;
};

const TABS = ["all", "grant", "consume"] as const;
type Tab = (typeof TABS)[number];

const PAGE_SIZE = 20;

export default function CreditsPage() {
  const t = useTranslations("dashboard.credits");
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [rows, setRows] = useState<CreditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((res) => {
        if (res?.code === 0) setBalance(res.data.balance);
        setBalanceLoaded(true);
      })
      .catch(() => setBalanceLoaded(true));
  }, []);

  const fetchCredits = useCallback(async (p: number, tb: Tab, s: string) => {
    const params = new URLSearchParams({
      page: String(p),
      pageSize: String(PAGE_SIZE),
    });
    if (tb !== "all") params.set("transactionType", tb);
    if (s) params.set("search", s);
    const res = await fetch(`/api/user/credits?${params}`).then((r) => r.json()).catch(() => null);
    if (res?.code === 0) {
      setRows(res.data.items);
      setTotal(res.data.total);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchCredits(page, tab, search), 300);
    return () => clearTimeout(timer);
  }, [page, tab, search, fetchCredits]);

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  const columns: Column<CreditRow>[] = [
    {
      header: t("transaction_no"),
      cell: (r) => <span className="font-mono text-xs">{r.transactionNo}</span>,
    },
    {
      header: t("description_col"),
      cell: (r) => <span>{r.description || "—"}</span>,
    },
    {
      header: t("type"),
      cell: (r) => (
        <Badge variant={r.transactionType === "consume" ? "secondary" : "default"}>
          {r.transactionType}
        </Badge>
      ),
    },
    {
      header: t("scene"),
      cell: (r) => r.transactionScene || "—",
    },
    {
      header: t("credits"),
      className: "text-right",
      cell: (r) => (
        <span
          className={cn(
            "font-medium tabular-nums",
            r.transactionType === "consume" && "text-muted-foreground",
          )}
        >
          {r.transactionType === "consume" ? "-" : "+"}
          {r.credits}
        </span>
      ),
    },
    {
      header: t("remaining"),
      className: "text-right",
      cell: (r) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {r.remainingCredits}
        </span>
      ),
    },
    {
      header: t("expires_at"),
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      header: t("date"),
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("balance")}</CardTitle>
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
            >
              <Coins className="size-4" />
              {t("purchase")}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{balanceLoaded ? balance ?? 0 : "…"}</p>
        </CardContent>
      </Card>

      <div className="flex gap-1 border-b border-border overflow-x-auto overflow-y-hidden">
        {TABS.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={cn(
              "px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              tab === tb
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tab_${tb}` as "tab_all" | "tab_grant" | "tab_consume")}
          </button>
        ))}
      </div>

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(r) => r.id}
            emptyText={t("no_records")}
            search={search}
            onSearchChange={setSearch}
          />
        </CardContent>
      </Card>
    </div>
  );
}
