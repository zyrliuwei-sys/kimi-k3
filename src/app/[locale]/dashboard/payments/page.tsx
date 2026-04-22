"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    fetch("/api/user/orders")
      .then((r) => r.json())
      .then((res) => {
        if (res?.code === 0 && Array.isArray(res.data)) setOrders(res.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return orders;
    return orders.filter((o) => (o.paymentType || "") === tab);
  }, [orders, tab]);

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
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <p className="text-muted-foreground text-sm">…</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("no_payments")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("order_no")}</TableHead>
                    <TableHead>{t("product")}</TableHead>
                    <TableHead>{t("amount")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("type")}</TableHead>
                    <TableHead>{t("provider")}</TableHead>
                    <TableHead>{t("date")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                      <TableCell>{o.planName || o.productName || "—"}</TableCell>
                      <TableCell className="font-medium">
                        {formatAmount(o.amount, o.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                      </TableCell>
                      <TableCell>{o.paymentType || "—"}</TableCell>
                      <TableCell className="capitalize">{o.paymentProvider}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(o.paidAt || o.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {o.invoiceUrl ? (
                          <a
                            href={o.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            aria-label={t("invoice")}
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
