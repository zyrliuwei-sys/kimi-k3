"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/data-table";
import { cn } from "@/lib/utils";

type Order = {
  id: string;
  orderNo: string;
  status: string;
  amount: number;
  currency: string;
  paymentProvider: string;
  paymentType?: string | null;
  productName?: string | null;
  planName?: string | null;
  invoiceUrl?: string | null;
  paidAt?: string | null;
  createdAt: string;
};

const TABS = ["all", "one-time", "subscription", "renew"] as const;
type Tab = (typeof TABS)[number];

const PAGE_SIZE = 20;

function formatAmount(amount: number, currency: string) {
  const normalized = (currency || "usd").toUpperCase();
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: normalized,
  }).format(amount / 100);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s === "paid" || s === "succeeded" || s === "active") return "default";
  if (s === "failed" || s === "canceled") return "destructive";
  return "secondary";
}

export default function PaymentsPage() {
  const t = useTranslations("dashboard.payments");
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const fetchOrders = useCallback(async (p: number, tb: Tab, s: string) => {
    const params = new URLSearchParams({
      page: String(p),
      pageSize: String(PAGE_SIZE),
    });
    if (tb !== "all") params.set("paymentType", tb);
    if (s) params.set("search", s);
    const res = await fetch(`/api/user/orders?${params}`).then((r) => r.json()).catch(() => null);
    if (res?.code === 0) {
      setOrders(res.data.items);
      setTotal(res.data.total);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchOrders(page, tab, search), 300);
    return () => clearTimeout(timer);
  }, [page, tab, search, fetchOrders]);

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  const columns: Column<Order>[] = [
    {
      header: t("order_no"),
      cell: (o) => <span className="font-mono text-xs">{o.orderNo}</span>,
    },
    {
      header: t("product"),
      cell: (o) => <span>{o.planName || o.productName || "—"}</span>,
    },
    {
      header: t("amount"),
      cell: (o) => (
        <span className="font-medium">{formatAmount(o.amount, o.currency)}</span>
      ),
    },
    {
      header: t("status"),
      cell: (o) => <Badge variant={statusVariant(o.status)}>{o.status}</Badge>,
    },
    {
      header: t("type"),
      cell: (o) => o.paymentType || "—",
    },
    {
      header: t("provider"),
      cell: (o) => <span className="capitalize">{o.paymentProvider}</span>,
    },
    {
      header: t("date"),
      cell: (o) => (
        <span className="text-muted-foreground text-sm">
          {new Date(o.paidAt || o.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      header: t("invoice"),
      className: "w-[60px]",
      cell: (o) =>
        o.invoiceUrl ? (
          <a
            href={o.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            aria-label={t("invoice")}
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

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
            {t(`tab_${tb.replace("-", "_")}` as "tab_all" | "tab_one_time" | "tab_subscription" | "tab_renew")}
          </button>
        ))}
      </div>

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={orders}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(o) => o.id}
            emptyText={t("no_payments")}
            search={search}
            onSearchChange={setSearch}
          />
        </CardContent>
      </Card>
    </div>
  );
}
