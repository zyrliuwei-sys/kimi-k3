"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export default function CreditsPage() {
  const t = useTranslations("dashboard.credits");
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<CreditRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((res) => {
        if (res?.code === 0) {
          setBalance(res.data.balance);
          if (Array.isArray(res.data.history)) setHistory(res.data.history);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return history;
    return history.filter((r) => r.transactionType === tab);
  }, [history, tab]);

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
          <p className="text-3xl font-bold">{loaded ? balance ?? 0 : "…"}</p>
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
          {!loaded ? (
            <p className="text-muted-foreground text-sm">…</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("no_records")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("transaction_no")}</TableHead>
                    <TableHead>{t("description_col")}</TableHead>
                    <TableHead>{t("type")}</TableHead>
                    <TableHead>{t("scene")}</TableHead>
                    <TableHead className="text-right">{t("credits")}</TableHead>
                    <TableHead className="text-right">{t("remaining")}</TableHead>
                    <TableHead>{t("expires_at")}</TableHead>
                    <TableHead>{t("date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const isConsume = r.transactionType === "consume";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.transactionNo}</TableCell>
                        <TableCell>{r.description || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={isConsume ? "secondary" : "default"}>
                            {r.transactionType}
                          </Badge>
                        </TableCell>
                        <TableCell>{r.transactionScene || "—"}</TableCell>
                        <TableCell className={cn("text-right font-medium", isConsume && "text-muted-foreground")}>
                          {isConsume ? "-" : "+"}
                          {r.credits}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {r.remainingCredits}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
