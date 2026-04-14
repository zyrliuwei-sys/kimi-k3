"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "@/core/auth/client";
import { CreditCard, Key, TrendingUp, Activity } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardPage() {
  const t = useTranslations();
  const { data: session } = useSession();
  const [credits, setCredits] = useState<number | null>(null);
  const [apiKeys, setApiKeys] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setCredits(res.data.balance);
      })
      .catch(() => {});

    fetch("/api/apikeys")
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setApiKeys(res.data.length);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("dashboard.welcome", { name: session?.user?.name || session?.user?.email || "" })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.billing.credits")}</CardTitle>
            <CreditCard className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{credits ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("dashboard.billing.credits_description")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.api_keys.title")}</CardTitle>
            <Key className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{apiKeys ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Active keys
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Plan</CardTitle>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Free</div>
            <p className="text-xs text-muted-foreground mt-1">
              Current subscription
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Usage</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground mt-1">
              API calls this month
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Getting Started</CardTitle>
          <CardDescription>Build your product on top of this engine</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            <p className="text-sm">{t("dashboard.placeholder")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
